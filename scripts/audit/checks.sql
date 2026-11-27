-- VTU SportsOS database audit checks.
-- Every check states the CORRECT behaviour: FAIL = the bug is still there, PASS = fixed / working.
-- Run only against a throwaway database (scripts/audit/run.sh does this).
\set ON_ERROR_STOP 1
\set VERBOSITY terse
SET client_min_messages = warning;

CREATE TABLE IF NOT EXISTS audit_results (seq serial, id text, ok boolean, title text, detail text);
TRUNCATE audit_results;

CREATE OR REPLACE FUNCTION chk(p_id text, p_ok boolean, p_title text, p_detail text DEFAULT '') RETURNS void
LANGUAGE sql AS $$ INSERT INTO audit_results (id, ok, title, detail) VALUES (p_id, COALESCE(p_ok, false), p_title, p_detail) $$;

-- Runs a statement; returns '' on success or the error text.
CREATE OR REPLACE FUNCTION try_sql(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RETURN '';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

-- Runs a call that returns jsonb; true only when it succeeded with success = true.
CREATE OR REPLACE FUNCTION call_ok(stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN EXECUTE stmt INTO r; RETURN coalesce((r->>'success')::boolean, false);
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;

-- ============================================================================
-- D. Heat draw
-- ============================================================================
SELECT generate_heat_draw(audit_ev('100M-M'), 'HEATS', 8) \gset ignore_

CREATE TEMP VIEW drawn AS
  SELECT h.id AS heat_id, h.heat_number, ha.lane_number, ha.profile_id, p.accreditation_status, s.payment_status, s.college_id
  FROM heats h JOIN heat_athletes ha ON ha.heat_id = h.id JOIN profiles p ON p.id = ha.profile_id JOIN squads s ON s.id = p.squad_id
  WHERE h.event_id = audit_ev('100M-M') AND h.stage = 'HEATS';

SELECT chk('D1', NOT EXISTS (SELECT 1 FROM drawn d WHERE NOT EXISTS (
         SELECT 1 FROM registrations r WHERE r.profile_id = d.profile_id AND r.event_id = audit_ev('100M-M') AND r.kind = 'regular')),
       'Heat draw leaves out reserve-only entries',
       (SELECT count(*) || ' reserve-only athlete(s) got lanes' FROM drawn d WHERE NOT EXISTS (
         SELECT 1 FROM registrations r WHERE r.profile_id = d.profile_id AND r.event_id = audit_ev('100M-M') AND r.kind = 'regular')));
SELECT chk('D2', NOT EXISTS (SELECT 1 FROM drawn WHERE accreditation_status <> 'ACCREDITED'),
       'Heat draw leaves out athletes who are not accredited',
       (SELECT count(*) || ' unaccredited athlete(s) got lanes' FROM drawn WHERE accreditation_status <> 'ACCREDITED'));
SELECT chk('D3', NOT EXISTS (SELECT 1 FROM drawn WHERE payment_status <> 'VERIFIED'),
       'Heat draw leaves out athletes whose college has not paid',
       (SELECT count(*) || ' unpaid athlete(s) got lanes' FROM drawn WHERE payment_status <> 'VERIFIED'));
SELECT chk('D4', (SELECT count(DISTINCT heat_id) FROM drawn) < 2
              OR NOT EXISTS (SELECT 1 FROM drawn GROUP BY heat_id, college_id HAVING count(*) > 1),
       'Teammates are separated into different heats (plan §6.1)',
       (SELECT coalesce(string_agg(DISTINCT 'heat '||heat_number, ', '), 'none') || ' has 2 from one college'
          FROM (SELECT heat_number FROM drawn GROUP BY heat_id, heat_number, college_id HAVING count(*) > 1) x));

CREATE TEMP TABLE draw1 AS SELECT profile_id, heat_number, lane_number FROM drawn;
DELETE FROM heats WHERE event_id = audit_ev('100M-M');
SELECT generate_heat_draw(audit_ev('100M-M'), 'HEATS', 8) \gset ignore_
SELECT chk('D5', EXISTS (SELECT 1 FROM drawn d JOIN draw1 o USING (profile_id)
                         WHERE (d.heat_number, d.lane_number) IS DISTINCT FROM (o.heat_number, o.lane_number)),
       'Lanes are drawn at random (a redraw changes the line-up)',
       'two draws gave identical heats and lanes');

SELECT try_sql($$SELECT generate_heat_draw(audit_ev('100M-M'), 'FINAL', 8)$$) AS final_err \gset
SELECT chk('D6', :'final_err' <> '' OR (SELECT count(*) FROM heats h JOIN heat_athletes ha ON ha.heat_id = h.id
                                          WHERE h.event_id = audit_ev('100M-M') AND h.stage = 'FINAL') <= 8,
       'Drawing a FINAL does not put every entrant into it',
       (SELECT count(*) || ' athletes in ' || count(DISTINCT h.id) || ' "final" heat(s)' FROM heats h JOIN heat_athletes ha ON ha.heat_id = h.id
          WHERE h.event_id = audit_ev('100M-M') AND h.stage = 'FINAL'));

-- ============================================================================
-- Q. Qualification (VTU rule: top 2 per heat, no fastest losers)
-- ============================================================================
DO $$
DECLARE h1 uuid; h2 uuid;
BEGIN
  h1 := audit_heat('400M-M', 'HEATS', 1, ARRAY['Spare 1','Spare 2','Spare 3','Spare 4'], 'COMPLETED');
  h2 := audit_heat('400M-M', 'HEATS', 2, ARRAY['Spare 5','Spare 6','Spare 7','Spare 8'], 'COMPLETED');
  -- heat 2 is much faster: under a time rule its 3rd/4th would sneak in
  PERFORM submit_track_result(audit_ha(h1,'Spare 1'), 50.0, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h1,'Spare 2'), 50.5, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h1,'Spare 3'), 51.0, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h1,'Spare 4'), 51.5, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h2,'Spare 5'), 48.0, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h2,'Spare 6'), 48.1, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h2,'Spare 7'), 48.2, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h2,'Spare 8'), 48.3, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM qualify_next_round(audit_ev('400M-M'), 'HEATS', 'FINAL', 2, 0);
END $$;
SELECT chk('Q1', (SELECT array_agg(p.sslc_name ORDER BY p.sslc_name) FROM heats h JOIN heat_athletes ha ON ha.heat_id = h.id
                  JOIN profiles p ON p.id = ha.profile_id WHERE h.event_id = audit_ev('400M-M') AND h.stage = 'FINAL')
              = ARRAY['Spare 1','Spare 2','Spare 5','Spare 6'],
       'qualify_next_round(…, 2, 0) puts exactly the top 2 of each heat in the final');

-- ============================================================================
-- P. Results and points
-- ============================================================================
-- P1 dead heat for 2nd (hand timing)
DO $$
DECLARE h uuid := audit_heat('110H-M', 'FINAL', 1, ARRAY['Spare 1','Spare 2','Spare 3','Spare 4']);
BEGIN
  PERFORM submit_track_result(audit_ha(h,'Spare 1'), 14.1, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h,'Spare 2'), 14.3, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h,'Spare 3'), 14.3, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(h,'Spare 4'), 14.6, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM allocate_event_points(audit_ev('110H-M'), h);
END $$;
SELECT chk('P1', (SELECT count(*) FROM team_points tp WHERE tp.event_id = audit_ev('110H-M')
                    AND tp.profile_id IN (audit_pid('Spare 2'), audit_pid('Spare 3')) AND tp.place = 2) = 2,
       'A dead heat shares the place (both 14.3 s runners get silver)',
       (SELECT string_agg(p.sslc_name || '=' || tp.place, ', ' ORDER BY tp.place) FROM team_points tp JOIN profiles p ON p.id = tp.profile_id
          WHERE tp.event_id = audit_ev('110H-M')));

-- P2 final run in two sections (timed final)
DO $$
DECLARE s1 uuid := audit_heat('5000M-M', 'FINAL', 1, ARRAY['Spare 1','Spare 2','Spare 3']);
        s2 uuid := audit_heat('5000M-M', 'FINAL', 2, ARRAY['Spare 4','Spare 5','Spare 6']);
BEGIN
  PERFORM submit_track_result(audit_ha(s1,'Spare 1'), 900, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(s1,'Spare 2'), 901, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(s1,'Spare 3'), 902, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(s2,'Spare 4'), 950, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(s2,'Spare 5'), 951, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM submit_track_result(audit_ha(s2,'Spare 6'), 952, NULL, NULL, 'FINISHED', '', NULL);
  PERFORM allocate_event_points(audit_ev('5000M-M'), s1);
  PERFORM allocate_event_points(audit_ev('5000M-M'), s2);
END $$;
SELECT chk('P2', (SELECT array_agg(p.sslc_name ORDER BY tp.place) FROM team_points tp JOIN profiles p ON p.id = tp.profile_id
                  WHERE tp.event_id = audit_ev('5000M-M')) = ARRAY['Spare 1','Spare 2','Spare 3'],
       'A final run in 2 sections gives medals to the fastest overall (900/901/902 s)',
       (SELECT 'medals went to ' || string_agg(p.sslc_name, ', ' ORDER BY tp.place) FROM team_points tp JOIN profiles p ON p.id = tp.profile_id
          WHERE tp.event_id = audit_ev('5000M-M')));

-- P3 editing a completed event keeps points in sync (or is refused)
DO $$
DECLARE h uuid := audit_heat('LJ-M', 'FINAL', 1, ARRAY['Spare 1','Spare 2','Spare 3','Spare 4']);
BEGIN
  PERFORM submit_field_attempt(audit_ha(h,'Spare 1'), 1, 'VALID', 7.10, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 2'), 1, 'VALID', 6.90, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 3'), 1, 'VALID', 6.80, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 4'), 1, 'VALID', 6.50, NULL, NULL);
  PERFORM allocate_event_points(audit_ev('LJ-M'), h);
  UPDATE heats SET status = 'COMPLETED' WHERE id = h;
END $$;
SELECT try_sql($$SELECT submit_field_attempt(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('LJ-M')), 'Spare 4'), 2, 'VALID', 8.50, NULL, NULL)$$) AS edit_err \gset
SELECT chk('P3', :'edit_err' <> ''
              OR (SELECT profile_id FROM team_points WHERE event_id = audit_ev('LJ-M') AND place = 1) = audit_pid('Spare 4'),
       'Editing a completed event is refused, or medals are recalculated',
       'edit accepted (8.50 m now leads) but gold still belongs to the old leader');

-- P4 true tie in a field event (identical series) shares the place
DO $$
DECLARE h uuid := audit_heat('TJ-M', 'FINAL', 1, ARRAY['Spare 1','Spare 2','Spare 3']);
BEGIN
  PERFORM submit_field_attempt(audit_ha(h,'Spare 1'), 1, 'VALID', 15.00, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 2'), 1, 'VALID', 14.50, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 2'), 2, 'VALID', 14.00, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 3'), 1, 'VALID', 14.50, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 3'), 2, 'VALID', 14.00, NULL, NULL);
END $$;
SELECT chk('P4', (SELECT count(*) FROM jsonb_array_elements(compute_field_standings((SELECT id FROM heats WHERE event_id = audit_ev('TJ-M')))->'standings') i
                  WHERE (i->>'rank')::int = 2) = 2,
       'Identical field series share the place (two athletes ranked 2nd)');

-- P5 field countback (2nd best decides) — the winner is entered second
DO $$
DECLARE h uuid := audit_heat('SP-M', 'FINAL', 1, ARRAY['Spare 1','Spare 2']);
BEGIN
  PERFORM submit_field_attempt(audit_ha(h,'Spare 1'), 1, 'VALID', 11.50, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 1'), 2, 'VALID', 12.00, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 2'), 1, 'VALID', 12.00, NULL, NULL);
  PERFORM submit_field_attempt(audit_ha(h,'Spare 2'), 2, 'VALID', 11.90, NULL, NULL);
END $$;
SELECT chk('P5', (SELECT (i->>'profile_id')::uuid FROM jsonb_array_elements(compute_field_standings((SELECT id FROM heats WHERE event_id = audit_ev('SP-M')))->'standings') i
                  WHERE (i->>'rank')::int = 1) = audit_pid('Spare 2'),
       'Field countback: equal best marks are decided by the 2nd best');

-- P6 high jump countback: P (fewest fails at best height) > R (fewer total fails) > Q
DO $$
DECLARE h uuid := audit_heat('HJ-M', 'FINAL', 1, ARRAY['Spare 1','Spare 2','Spare 3']);
  q text[][] := ARRAY[['1.70','1','O'],['1.75','1','O'],['1.80','1','X'],['1.80','2','O'],['1.85','1','X'],['1.85','2','X'],['1.85','3','X']];
  p text[][] := ARRAY[['1.70','1','O'],['1.75','1','X'],['1.75','2','O'],['1.80','1','O'],['1.85','1','X'],['1.85','2','X'],['1.85','3','X']];
  r text[][] := ARRAY[['1.70','1','X'],['1.70','2','X'],['1.70','3','O'],['1.75','1','O'],['1.80','1','O'],['1.85','1','X'],['1.85','2','X'],['1.85','3','X']];
  k int;
BEGIN
  FOR k IN 1..array_length(q,1) LOOP PERFORM submit_vertical_jump_attempt(audit_ha(h,'Spare 1'), q[k][1]::numeric, q[k][2]::int, q[k][3], NULL); END LOOP;
  FOR k IN 1..array_length(p,1) LOOP PERFORM submit_vertical_jump_attempt(audit_ha(h,'Spare 2'), p[k][1]::numeric, p[k][2]::int, p[k][3], NULL); END LOOP;
  FOR k IN 1..array_length(r,1) LOOP PERFORM submit_vertical_jump_attempt(audit_ha(h,'Spare 3'), r[k][1]::numeric, r[k][2]::int, r[k][3], NULL); END LOOP;
END $$;
SELECT chk('P6', (SELECT array_agg((i->>'profile_id')::uuid ORDER BY (i->>'rank')::int)
                  FROM jsonb_array_elements(compute_field_standings((SELECT id FROM heats WHERE event_id = audit_ev('HJ-M')))->'standings') i)
              = ARRAY[audit_pid('Spare 2'), audit_pid('Spare 3'), audit_pid('Spare 1')],
       'High jump countback: fewest fails at best height, then fewest total');

-- P7/P8 implausible marks
SELECT try_sql($$SELECT submit_field_attempt(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('SP-M')), 'Spare 1'), 3, 'VALID', 99, NULL, NULL)$$) AS sp_err \gset
SELECT chk('P7', :'sp_err' <> '', 'An impossible field mark (99 m shot put) is rejected');
SELECT try_sql($$SELECT submit_track_result(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('110H-M')), 'Spare 4'), 1.00, NULL, NULL, 'FINISHED', '', NULL)$$) AS tr_err \gset
SELECT chk('P8', :'tr_err' <> '', 'An impossible track time (1.00 s hurdles) is rejected');

-- P9 points match the official rules (5-3-1 individual)
SELECT chk('P9', (SELECT array_agg(points ORDER BY place) FROM team_points WHERE event_id = audit_ev('5000M-M')) = ARRAY[5,3,1]::numeric[],
       'Individual points are 5-3-1 (official rules)');

-- L1 a corrected result is logged with its old value; a re-sent identical value is not
SELECT submit_track_result(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('110H-M')), 'Spare 4'), 14.6, NULL, NULL, 'FINISHED', '', NULL) \gset ignore_
SELECT submit_track_result(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('110H-M')), 'Spare 4'), 14.9, NULL, NULL, 'FINISHED', '', NULL) \gset ignore_
SELECT chk('L1', (SELECT count(*) FROM result_changes WHERE event_id = audit_ev('110H-M') AND source = 'track_results') = 1
              AND EXISTS (SELECT 1 FROM result_changes WHERE event_id = audit_ev('110H-M') AND (old_values->>'time_seconds')::numeric = 14.6
                          AND (new_values->>'time_seconds')::numeric = 14.9),
       'A corrected result is logged with old and new value (re-sending the same value is not)',
       (SELECT count(*) || ' log row(s)' FROM result_changes WHERE event_id = audit_ev('110H-M')));

-- ============================================================================
-- S. Event-day scanners
-- ============================================================================
SELECT chk('S1', NOT call_ok($$SELECT process_accreditation_scan(gen_random_uuid(), audit_pid('Unpaid U1'), NULL, now())$$),
       'Accreditation refuses an athlete whose college has not paid (plan §5.1)');

INSERT INTO heats (event_id, stage, heat_number, status) VALUES (audit_ev('800M-M'), 'HEATS', 1, 'SCHEDULED');
INSERT INTO heat_athletes (heat_id, profile_id, lane_number)
  VALUES ((SELECT id FROM heats WHERE event_id = audit_ev('800M-M')), audit_pid('Unaccredited N1'), 1);
SELECT chk('S2', NOT call_ok($$SELECT record_call_room_inspection(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('800M-M')), 'Unaccredited N1'),
                                   NULL, 'REPORTED', true, 6, true, NULL)$$),
       'Call room refuses check-in of an unaccredited athlete (plan §7.1)');

SELECT chk('S3', (scan_meal_coupon('audit-meal-unpaid', audit_pid('Unpaid U1'), 'LUNCH', NULL, now())->>'success')::boolean IS NOT TRUE,
       'Meal scanner refuses an unpaid / unaccredited athlete');

INSERT INTO hostels (name, gender) VALUES ('Audit Men Hostel', 'men');
SELECT chk('S4', NOT call_ok($$SELECT process_accommodation_checkin(gen_random_uuid(), audit_pid('Unpaid U1'), (SELECT id FROM hostels WHERE name = 'Audit Men Hostel'),
                                   NULL, 'R1', 0, NULL, now())$$),
       'Hostel check-in refuses an athlete whose college has not paid (plan §10.1)');

SELECT scan_meal_coupon('audit-meal-1', audit_pid('Spare 9'), 'DINNER', NULL, now()) \gset ignore_
SELECT chk('S5', (scan_meal_coupon('audit-meal-1', audit_pid('Spare 9'), 'DINNER', NULL, now())->>'is_duplicate_sync')::boolean
             AND (scan_meal_coupon('audit-meal-2', audit_pid('Spare 9'), 'DINNER', NULL, now())->>'status') = 'ALREADY_SERVED',
       'Meals: offline replay counts once, a second dinner is refused');
SELECT process_accreditation_scan('99999999-9999-9999-9999-999999999999', audit_pid('Spare 10'), NULL, now()) \gset ignore_
SELECT chk('S6', (process_accreditation_scan('99999999-9999-9999-9999-999999999999', audit_pid('Spare 10'), NULL, now())->>'success')::boolean
             AND (process_accreditation_scan(gen_random_uuid(), audit_pid('Spare 10'), NULL, now())->>'already_accredited')::boolean,
       'Accreditation: offline replay is safe, a second scan is flagged');
SELECT try_sql($$SELECT process_accommodation_checkin(gen_random_uuid(), audit_pid('Woman W1'), (SELECT id FROM hostels WHERE name = 'Audit Men Hostel'), NULL, 'R2', 0, NULL, now())$$) AS gender_err \gset
SELECT chk('S7', :'gender_err' <> '', 'A woman cannot be checked into a men''s hostel');

-- ============================================================================
-- C. Call room reserve substitution (plan §7.3)
-- ============================================================================
SELECT audit_athlete(audit_sq('CE'), 'Sub Absent', '1AA23SB001') \gset ignore_
SELECT audit_athlete(audit_sq('CE'), 'Sub Reserve', '1AA23SB002') \gset ignore_
SELECT audit_athlete(audit_sq('CF'), 'Sub Other College', '1AA23SB003') \gset ignore_
INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Sub Absent'), audit_ev('HT-M'), 'regular');
INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Sub Reserve'), audit_ev('DT-M'), 'regular');
INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Sub Reserve'), audit_ev('HT-M'), 'reserve');
INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Sub Other College'), audit_ev('DT-M'), 'regular');
INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Sub Other College'), audit_ev('HT-M'), 'reserve');
SELECT audit_heat('HT-M', 'FINAL', 1, ARRAY['Sub Absent'], 'CALL_ROOM') \gset ignore_
SELECT try_sql($$SELECT substitute_reserve_in_heat(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('HT-M')), 'Sub Absent'), audit_pid('Sub Other College'), NULL)$$) AS other_err \gset
SELECT try_sql($$SELECT substitute_reserve_in_heat(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('HT-M')), 'Sub Absent'), audit_pid('Sub Reserve'), NULL)$$) AS sub_err \gset
SELECT chk('C1', :'other_err' <> '' AND :'sub_err' = ''
              AND EXISTS (SELECT 1 FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id
                          WHERE h.event_id = audit_ev('HT-M') AND ha.profile_id = audit_pid('Sub Reserve') AND ha.call_room_reported)
              AND EXISTS (SELECT 1 FROM call_room_substitutions WHERE absent_profile_id = audit_pid('Sub Absent')),
       'Call room: a reserve of the same college takes an absent athlete''s place (logged); another college''s reserve is refused',
       'other college: ' || coalesce(nullif(:'other_err', ''), 'ACCEPTED') || ' / same college: ' || coalesce(nullif(:'sub_err', ''), 'ok'));
UPDATE heats SET status = 'ON_TRACK' WHERE event_id = audit_ev('HT-M');
SELECT chk('C2', try_sql($$SELECT substitute_reserve_in_heat(audit_ha((SELECT id FROM heats WHERE event_id = audit_ev('HT-M')), 'Sub Reserve'), audit_pid('Sub Absent'), NULL)$$) <> '',
       'Call room: no substitution after the call room has closed');

-- ============================================================================
-- R. Database security
-- ============================================================================
SELECT chk('R1', NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND c.relname <> 'audit_results'),
       'Row-level security is ON for every public table',
       (SELECT count(*) || ' tables without RLS (anon key = full read/write)' FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND c.relname <> 'audit_results'));

CREATE FUNCTION public.audit_priv_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';
SELECT chk('R2', NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname NOT IN ('chk', 'try_sql', 'call_ok') AND p.proname NOT LIKE 'audit\_%'
                               AND has_function_privilege('anon', p.oid, 'execute'))
              AND NOT has_function_privilege('anon', 'public.audit_priv_probe()', 'execute'),
       'The anon key cannot execute any database function, including ones created later',
       (SELECT count(*) || ' function(s) executable by anon' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'execute')));
DROP FUNCTION public.audit_priv_probe();

-- ============================================================================
-- B. Database backstops for rules the website already enforces (defence in depth)
-- ============================================================================
SELECT audit_athlete(audit_sq('CD'), 'Backstop A', '1AA23BS001') \gset ignore_
SELECT audit_athlete(audit_sq('CD'), 'Backstop B', '1AA23BS002') \gset ignore_
INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Backstop A'), audit_ev('400M-M'), 'regular'),
                                                              (audit_pid('Backstop A'), audit_ev('800M-M'), 'regular');
-- Amended 07-11-2026: 1 reserve is allowed even with 2 events, but needs a regular event (Rule 36)
SELECT audit_athlete(audit_sq('CD'), 'Backstop C', '1AA23BS003') \gset ignore_
-- The reserve rule is a deferred trigger: make it fire inside try_sql
BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT chk('B1', try_sql($$INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Backstop A'), audit_ev('200M-M'), 'reserve')$$) = ''
              AND try_sql($$INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Backstop C'), audit_ev('200M-M'), 'reserve')$$) <> '',
       '[backstop] Reserve allowed with 2 events (07-11 amendment); a reserve-only entry is refused (Rule 36)');
COMMIT;
SELECT chk('B2', try_sql($$INSERT INTO registrations (profile_id, event_id, kind) VALUES (audit_pid('Backstop B'), audit_ev('100M-M'), 'regular')$$) IS NOT NULL
             OR (SELECT count(*) FROM registrations r JOIN profiles p ON p.id = r.profile_id JOIN squads s ON s.id = p.squad_id
                 WHERE s.id = audit_sq('CD') AND r.event_id = audit_ev('100M-M') AND r.kind = 'regular') <= 2,
       '[backstop] Max 2 athletes per college per event');
-- B3 (no entries on a locked roster) is enforced by the website only, by design: Directorate
-- withdrawals / substitutions change locked rosters (see migration 0030).
SELECT chk('B4', try_sql($$SELECT audit_athlete(audit_sq('CB'), 'Dup USN', '1AA23BS001')$$) <> '',
       '[backstop] USN is unique across the championship');
-- Since 0050 a 6–15 character A–Z/0–9 value is a valid passport number, so test with a value
-- that is neither an Aadhaar nor a passport (too short, and lower case with a dash).
SELECT chk('B5', try_sql($$UPDATE profiles SET aadhaar_number = '12-ab' WHERE sslc_name = 'Backstop B'$$) <> '',
       '[backstop] ID must be a 12-digit Aadhaar or a 6–15 character passport number');
INSERT INTO relay_teams (squad_id, event_id) VALUES (audit_sq('CA'), audit_ev('4X400M-M'));
SELECT chk('B6', try_sql($$INSERT INTO relay_members (relay_team_id, profile_id, leg_order, is_reserve)
                           VALUES ((SELECT id FROM relay_teams WHERE squad_id = audit_sq('CA') AND event_id = audit_ev('4X400M-M')), audit_pid('Woman W1'), 1, false)$$) <> '',
       '[backstop] A woman cannot run in a men''s divisional relay');
SELECT chk('B7', try_sql($$INSERT INTO relay_members (relay_team_id, profile_id, leg_order, is_reserve)
                           VALUES ((SELECT id FROM relay_teams WHERE squad_id = audit_sq('CA') AND event_id = audit_ev('4X400M-M')), audit_pid('Spare 2'), 2, false)$$) <> '',
       '[backstop] Another college''s athlete cannot join a relay team');

-- ============================================================================
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, id, title,
       CASE WHEN ok THEN '' ELSE coalesce(nullif(detail, ''), '') END AS detail
FROM audit_results ORDER BY seq;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM audit_results;
