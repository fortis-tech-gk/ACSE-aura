-- =============================================================================
-- 0055: Re-sync functions after migrations 0001-0018 were re-run on production (26 Nov 2026)
--
-- Production transactions 14577-14598 (after 0053/0054) re-created functions from the oldest
-- migrations, so production ran e.g. points 0013, standings 0012, field ranking 0010, accreditation
-- scan 0006, payment trigger 0018, and gained 3 old overloads that make
-- generate_heat_draw(event, stage, lanes) ambiguous ("function ... is not unique").
-- See docs/audit/e2e-audit-2026-11-26.md, findings C1, C2, H1.
--
-- This file puts back the LATEST definition of each function, exactly as staging has it
-- (generated from staging pg_get_functiondef on 26 Nov 2026; staging matches the newest migration for
-- every function), drops the 3 stale overloads and aligns the withdrawn-status check with the code
-- ('WITHDrAWN', as written by every function and route).
--
-- Safe to re-run. Changes no data. On staging it is a no-op apart from re-creating the same functions.
-- Run with:  psql "$DB" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0055_resync_functions_after_rerun.sql
-- The check at the end aborts the whole transaction if any function differs from staging.
-- =============================================================================

-- 1. Stale overloads left by the re-run (callers pass the newer argument lists)
DROP FUNCTION IF EXISTS public.generate_heat_draw(uuid, text, integer);
DROP FUNCTION IF EXISTS public.scan_meal_coupon(text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.substitute_athlete(uuid, text, text, integer, text, date, date, text, uuid);

-- 2. Latest definitions (CREATE OR REPLACE keeps the existing grants and triggers)
-- advance_heat_to_track(p_heat_id uuid, p_official_id uuid)
CREATE OR REPLACE FUNCTION public.advance_heat_to_track(p_heat_id uuid, p_official_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_heat RECORD;
  v_dns_count INTEGER := 0;
  v_reported_count INTEGER := 0;
  r_unreported RECORD;
BEGIN
  SELECT h.id, h.status INTO r_heat FROM heats h WHERE h.id = p_heat_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Heat not found.';
  END IF;

  SELECT COUNT(*) INTO v_reported_count
  FROM heat_athletes WHERE heat_id = p_heat_id AND call_room_reported = TRUE;

  -- Everyone who has not reported (and is not already scratched / disqualified) is DNS
  FOR r_unreported IN
    SELECT ha.id
    FROM heat_athletes ha
    LEFT JOIN call_room_inspections cri ON ha.id = cri.heat_athlete_id
    WHERE ha.heat_id = p_heat_id
      AND ha.call_room_reported = FALSE
      AND (cri.reported_status IS NULL OR cri.reported_status = 'REPORTED')
  LOOP
    INSERT INTO call_room_inspections (heat_athlete_id, inspected_by, reported_status, notes, inspected_at)
    VALUES (r_unreported.id, p_official_id, 'DNS', 'Did not report to the call room before it closed.', timezone('utc'::text, now()))
    ON CONFLICT (heat_athlete_id) DO UPDATE SET
      reported_status = 'DNS',
      notes = 'Did not report to the call room before it closed.',
      inspected_at = timezone('utc'::text, now());
    v_dns_count := v_dns_count + 1;
  END LOOP;

  UPDATE heats
  SET status = 'ON_TRACK',
      call_room_closed_at = timezone('utc'::text, now())
  WHERE id = p_heat_id;

  RETURN jsonb_build_object(
    'success', true,
    'heat_id', p_heat_id,
    'status', 'ON_TRACK',
    'reported_athletes', v_reported_count,
    'dns_athletes', v_dns_count
  );
END;
$function$;

-- allocate_event_points(p_event_id uuid, p_heat_id uuid)
CREATE OR REPLACE FUNCTION public.allocate_event_points(p_event_id uuid, p_heat_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_event RECORD;
  v_pts NUMERIC[];
  v_is_relay BOOLEAN;
  v_is_mixed BOOLEAN;
  v_count INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('allocate_event_points_' || p_event_id::text));

  SELECT id, name, code, category INTO r_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- A combined event is one competition: points come from any of its heats
  IF r_event.category = 'combined' THEN
    IF NOT EXISTS (SELECT 1 FROM heats WHERE id = p_heat_id AND event_id = p_event_id) THEN
      RAISE EXCEPTION 'Heat does not belong to %.', r_event.name;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM heats WHERE id = p_heat_id AND event_id = p_event_id AND stage = 'FINAL') THEN
    RAISE EXCEPTION 'Points are awarded only from a FINAL of %.', r_event.name;
  END IF;

  v_is_mixed := upper(r_event.code) = '4X400M-MIX';
  v_is_relay := r_event.category = 'relay';
  IF v_is_relay OR r_event.category = 'combined' THEN
    v_pts := ARRAY[10.0, 6.0, 2.0];             -- relays (incl. Mixed Relay) and combined events
  ELSE
    v_pts := ARRAY[5.0, 3.0, 1.0];
  END IF;

  DELETE FROM team_points WHERE event_id = p_event_id;

  IF r_event.category = 'combined' THEN
    WITH st AS (
      SELECT (i->>'rank')::INTEGER AS place, (i->>'profile_id')::UUID AS profile_id
      FROM jsonb_array_elements(compute_combined_standings(p_event_id)->'standings') AS i
      WHERE (i->>'classified')::BOOLEAN AND (i->>'total')::INTEGER > 0
    ), placed AS (
      SELECT st.*, COUNT(*) OVER (PARTITION BY place) AS tied FROM st
    )
    INSERT INTO team_points (event_id, heat_id, college_id, squad_id, profile_id, place, points)
    SELECT p_event_id, p_heat_id, s.college_id, s.id, pl.profile_id, pl.place,
           (SELECT COALESCE(SUM(v_pts[k]), 0) FROM generate_series(pl.place, pl.place + pl.tied::INT - 1) k
             WHERE k <= array_length(v_pts, 1)) / pl.tied
    FROM placed pl
    JOIN profiles p ON p.id = pl.profile_id
    JOIN squads s ON s.id = p.squad_id
    WHERE pl.place <= 3;
  ELSIF r_event.category LIKE 'field%' THEN
    WITH st AS (
      SELECT (i->>'rank')::INTEGER AS place, (i->>'profile_id')::UUID AS profile_id
      FROM jsonb_array_elements(compute_field_standings(p_heat_id)->'standings') AS i
      WHERE (i->>'best_mark') IS NOT NULL
    ), placed AS (
      SELECT st.*, COUNT(*) OVER (PARTITION BY place) AS tied FROM st
    )
    INSERT INTO team_points (event_id, heat_id, college_id, squad_id, profile_id, place, points)
    SELECT p_event_id, p_heat_id, s.college_id, s.id, pl.profile_id, pl.place,
           (SELECT COALESCE(SUM(v_pts[k]), 0) FROM generate_series(pl.place, pl.place + pl.tied::INT - 1) k
             WHERE k <= array_length(v_pts, 1)) / pl.tied
    FROM placed pl
    JOIN profiles p ON p.id = pl.profile_id
    JOIN squads s ON s.id = p.squad_id
    WHERE pl.place <= 3;
  ELSE
    WITH f AS (
      SELECT ha.heat_id, ha.profile_id, ha.relay_team_id,
             COALESCE(p.squad_id, rt.squad_id) AS squad_id,
             COALESCE(sp.college_id, srt.college_id) AS college_id,
             tr.time_seconds
      FROM heats h
      JOIN heat_athletes ha ON ha.heat_id = h.id
      JOIN track_results tr ON tr.heat_athlete_id = ha.id
      LEFT JOIN profiles p ON ha.profile_id = p.id
      LEFT JOIN squads sp ON p.squad_id = sp.id
      LEFT JOIN relay_teams rt ON ha.relay_team_id = rt.id
      LEFT JOIN squads srt ON rt.squad_id = srt.id
      WHERE h.event_id = p_event_id AND h.stage = 'FINAL'
        AND tr.status = 'FINISHED' AND tr.time_seconds IS NOT NULL
    ), placed AS (
      SELECT f.*, RANK() OVER (ORDER BY time_seconds) AS place,
             COUNT(*) OVER (PARTITION BY time_seconds) AS tied
      FROM f
    )
    INSERT INTO team_points (event_id, heat_id, college_id, squad_id, profile_id, relay_team_id, place, points)
    SELECT p_event_id, pl.heat_id, pl.college_id, pl.squad_id, pl.profile_id, pl.relay_team_id, pl.place,
           (SELECT COALESCE(SUM(v_pts[k]), 0) FROM generate_series(pl.place::INT, (pl.place + pl.tied - 1)::INT) k
             WHERE k <= array_length(v_pts, 1)) / pl.tied
    FROM placed pl
    WHERE pl.place <= 3 AND pl.squad_id IS NOT NULL;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'event_id', p_event_id,
    'heat_id', p_heat_id,
    'placers_awarded', v_count,
    'is_relay', v_is_relay,
    'is_mixed_relay', v_is_mixed,
    'counts_for', CASE
      WHEN v_is_mixed THEN 'overall_only'
      ELSE 'overall_and_division'
    END
  );
END;
$function$;

-- compute_field_standings(p_heat_id uuid)
CREATE OR REPLACE FUNCTION public.compute_field_standings(p_heat_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_event RECORD;
  v_standings JSONB;
BEGIN
  SELECT e.id, e.name, e.category INTO r_event
  FROM heats h JOIN events e ON h.event_id = e.id
  WHERE h.id = p_heat_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Heat not found.';
  END IF;

  IF r_event.category = 'field_vertical_jump' THEN
    -- High Jump / Pole Vault countback: highest cleared, fewest attempts at that
    -- height, fewest failures up to it. Equal on all three = shared place.
    WITH athlete_cleared AS (
      SELECT ha.id AS heat_athlete_id, p.id AS profile_id, p.sslc_name, p.usn, p.bid_number,
             c.name AS college_name, c.code AS college_code,
             MAX(vja.bar_height_meters) FILTER (WHERE vja.result = 'O') AS max_cleared_height
      FROM heat_athletes ha
      JOIN profiles p ON ha.profile_id = p.id
      JOIN squads s ON p.squad_id = s.id
      JOIN colleges c ON s.college_id = c.id
      LEFT JOIN vertical_jump_attempts vja ON ha.id = vja.heat_athlete_id
      WHERE ha.heat_id = p_heat_id
      GROUP BY ha.id, p.id, p.sslc_name, p.usn, p.bid_number, c.name, c.code
    ),
    athlete_countback AS (
      SELECT ac.*,
        COALESCE((SELECT MIN(vja.attempt_number) FROM vertical_jump_attempts vja
                  WHERE vja.heat_athlete_id = ac.heat_athlete_id
                    AND vja.bar_height_meters = ac.max_cleared_height AND vja.result = 'O'), 99)
          AS attempts_at_winning_height,
        COALESCE((SELECT COUNT(*) FROM vertical_jump_attempts vja
                  WHERE vja.heat_athlete_id = ac.heat_athlete_id AND vja.result = 'X'
                    AND (ac.max_cleared_height IS NULL OR vja.bar_height_meters <= ac.max_cleared_height)), 0)
          AS total_failures
      FROM athlete_cleared ac
    ),
    ranked_vertical AS (
      SELECT RANK() OVER (ORDER BY max_cleared_height DESC NULLS LAST,
                                   attempts_at_winning_height ASC,
                                   total_failures ASC) AS rank, *
      FROM athlete_countback
    )
    SELECT jsonb_agg(jsonb_build_object(
             'rank', rank, 'heat_athlete_id', heat_athlete_id, 'profile_id', profile_id,
             'bid_number', bid_number, 'sslc_name', sslc_name, 'usn', usn,
             'college_name', college_name, 'college_code', college_code,
             'best_mark', max_cleared_height, 'attempts_at_best', attempts_at_winning_height,
             'total_failures', total_failures)
           ORDER BY rank, sslc_name)
    INTO v_standings
    FROM ranked_vertical;

  ELSE
    -- Throws & horizontal jumps: best mark, then 2nd best, 3rd best ... (the whole
    -- series). Identical series = shared place.
    WITH athlete_marks AS (
      SELECT ha.id AS heat_athlete_id, p.id AS profile_id, p.sslc_name, p.usn, p.bid_number,
             c.name AS college_name, c.code AS college_code,
             MAX(fa.mark_meters) FILTER (WHERE fa.attempt_type = 'VALID') AS best_mark,
             array_agg(fa.mark_meters ORDER BY fa.mark_meters DESC) FILTER (WHERE fa.attempt_type = 'VALID') AS all_marks
      FROM heat_athletes ha
      JOIN profiles p ON ha.profile_id = p.id
      JOIN squads s ON p.squad_id = s.id
      JOIN colleges c ON s.college_id = c.id
      LEFT JOIN field_attempts fa ON ha.id = fa.heat_athlete_id
      WHERE ha.heat_id = p_heat_id
      GROUP BY ha.id, p.id, p.sslc_name, p.usn, p.bid_number, c.name, c.code
    ),
    ranked_horizontal AS (
      SELECT RANK() OVER (ORDER BY best_mark DESC NULLS LAST, all_marks DESC NULLS LAST) AS rank, *
      FROM athlete_marks
    )
    SELECT jsonb_agg(jsonb_build_object(
             'rank', rank, 'heat_athlete_id', heat_athlete_id, 'profile_id', profile_id,
             'bid_number', bid_number, 'sslc_name', sslc_name, 'usn', usn,
             'college_name', college_name, 'college_code', college_code,
             'best_mark', best_mark, 'second_best_mark', all_marks[2])
           ORDER BY rank, sslc_name)
    INTO v_standings
    FROM ranked_horizontal;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'heat_id', p_heat_id,
    'event_name', r_event.name,
    'category', r_event.category,
    'standings', COALESCE(v_standings, '[]'::jsonb)
  );
END;
$function$;

-- generate_heat_draw(p_event_id uuid, p_stage text, p_num_lanes integer, p_only_ids uuid[])
CREATE OR REPLACE FUNCTION public.generate_heat_draw(p_event_id uuid, p_stage text DEFAULT 'HEATS'::text, p_num_lanes integer DEFAULT 8, p_only_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_event RECORD;
  v_is_relay BOOLEAN;
  v_single_group BOOLEAN;
  v_ids UUID[];
  v_total INTEGER;
  v_num_heats INTEGER;
  v_heat_ids UUID[] := ARRAY[]::UUID[];
  v_heat_id UUID;
  v_members UUID[];
  v_k INTEGER;
  v_schedule_item UUID;
  v_active INTEGER;
  v_not_accredited INTEGER := 0;
  v_not_paid INTEGER := 0;
  v_stage TEXT := p_stage;
  v_heat_event BOOLEAN;
  v_mode TEXT;
  i INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('generate_heat_draw_' || p_event_id::text || '_' || p_stage));

  IF p_num_lanes IS NULL OR p_num_lanes < 1 THEN
    RAISE EXCEPTION 'Number of lanes must be at least 1.';
  END IF;

  SELECT id, name, code, category, start_type INTO r_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  v_is_relay := r_event.category = 'relay';
  v_heat_event := is_heat_event(r_event.code);

  -- Heats exist only for 100m, 200m, 400m, the hurdles and the relays. Every other event
  -- (800m and up, road, walk, field) is ONE race / one flight and is always a straight FINAL.
  IF NOT v_heat_event THEN
    v_stage := 'FINAL';
    DELETE FROM heats WHERE event_id = p_event_id AND stage <> 'FINAL' AND status = 'SCHEDULED';
  END IF;
  v_single_group := NOT v_heat_event OR r_event.category LIKE 'field%';

  -- Manual photo finish mode: the vendor makes the heats, the admin types lane + bib instead
  SELECT COALESCE((SELECT photo_finish_mode FROM meet_settings LIMIT 1), 'APP') INTO v_mode;
  IF v_heat_event AND v_mode = 'MANUAL' THEN
    RAISE EXCEPTION 'Photo finish MANUAL mode is on: the heats of % come from the photo finish vendor. Enter lane and bib in Admin > Photo Finish, or switch back to App mode.', r_event.name;
  END IF;

  SELECT count(*) INTO v_active
  FROM heats WHERE event_id = p_event_id AND stage = v_stage AND status <> 'SCHEDULED';
  IF v_active > 0 THEN
    RAISE EXCEPTION 'Cannot redraw % (%): % heat(s) are already under way or finished.',
      r_event.name, v_stage, v_active;
  END IF;

  IF v_stage = 'FINAL' AND EXISTS (
    SELECT 1 FROM heats WHERE event_id = p_event_id AND stage <> 'FINAL'
  ) THEN
    RAISE EXCEPTION '% already has earlier rounds. Build the final from their results (qualify the top athletes), do not draw it.',
      r_event.name;
  END IF;

  -- Eligible entrants, grouped by college (random college order, random within a
  -- college) so that dealing them round-robin puts teammates in different heats.
  IF v_is_relay THEN
    WITH e AS (
      SELECT rt.id, s.college_id
      FROM relay_teams rt
      JOIN squads s ON s.id = rt.squad_id
      WHERE rt.event_id = p_event_id
        AND s.payment_status = 'VERIFIED'
        AND (p_only_ids IS NULL OR rt.id = ANY(p_only_ids))
        AND (SELECT count(*) FROM relay_members rm JOIN profiles p ON p.id = rm.profile_id
             WHERE rm.relay_team_id = rt.id AND p.accreditation_status = 'ACCREDITED') >= 4
    ), c AS (
      SELECT college_id, random() AS rc FROM (SELECT DISTINCT college_id FROM e) x
    )
    SELECT array_agg(e.id ORDER BY c.rc, random()) INTO v_ids FROM e JOIN c USING (college_id);

    SELECT count(*) FILTER (WHERE s.payment_status <> 'VERIFIED') INTO v_not_paid
    FROM relay_teams rt JOIN squads s ON s.id = rt.squad_id WHERE rt.event_id = p_event_id;
    SELECT count(*) - COALESCE(array_length(v_ids, 1), 0) - v_not_paid INTO v_not_accredited
    FROM relay_teams rt WHERE rt.event_id = p_event_id;
  ELSE
    WITH e AS (
      SELECT DISTINCT p.id, s.college_id
      FROM registrations r
      JOIN profiles p ON p.id = r.profile_id
      JOIN squads s ON s.id = p.squad_id
      WHERE r.event_id = p_event_id
        -- A roll call passes the athletes who reported; a reserve who came in for an absent
        -- teammate there is drawn on their reserve entry
        AND (r.kind IN ('regular', 'half_marathon') OR (p_only_ids IS NOT NULL AND r.kind = 'reserve'))
        AND (p_only_ids IS NULL OR p.id = ANY(p_only_ids))
        AND p.accreditation_status = 'ACCREDITED'
        AND s.payment_status = 'VERIFIED'
    ), c AS (
      SELECT college_id, random() AS rc FROM (SELECT DISTINCT college_id FROM e) x
    )
    SELECT array_agg(e.id ORDER BY c.rc, random()) INTO v_ids FROM e JOIN c USING (college_id);

    SELECT count(DISTINCT p.id) FILTER (WHERE s.payment_status <> 'VERIFIED'),
           count(DISTINCT p.id) FILTER (WHERE s.payment_status = 'VERIFIED'
                                          AND p.accreditation_status = 'REGISTERED')
    INTO v_not_paid, v_not_accredited
    FROM registrations r
    JOIN profiles p ON p.id = r.profile_id
    JOIN squads s ON s.id = p.squad_id
    WHERE r.event_id = p_event_id
      AND r.kind IN ('regular', 'half_marathon')
      AND p.accreditation_status <> 'WITHDrAWN';
  END IF;

  v_total := COALESCE(array_length(v_ids, 1), 0);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'No one can be drawn for % yet: % not accredited, % from colleges whose payment is not verified.',
      r_event.name, v_not_accredited, v_not_paid;
  END IF;

  IF v_single_group THEN
    v_num_heats := 1;
  ELSE
    IF v_stage = 'FINAL' AND v_total > p_num_lanes THEN
      RAISE EXCEPTION '% has % eligible athletes for % lanes. Draw HEATS first; the final is built from their results.',
        r_event.name, v_total, p_num_lanes;
    END IF;
    v_num_heats := CEIL(v_total::NUMERIC / p_num_lanes)::INTEGER;
  END IF;

  -- Replace the scheduled heats of this stage, keeping their schedule slot.
  SELECT schedule_item_id INTO v_schedule_item
  FROM heats
  WHERE event_id = p_event_id AND stage = v_stage AND schedule_item_id IS NOT NULL
  ORDER BY heat_number LIMIT 1;

  IF v_schedule_item IS NULL AND NOT v_heat_event THEN
    -- one race: it runs in the event's first slot on the schedule
    SELECT id INTO v_schedule_item FROM schedule_items WHERE event_id = p_event_id
    ORDER BY CASE stage WHEN 'QUALIFYING' THEN 1 WHEN 'HEATS' THEN 1 WHEN 'SEMI_FINAL' THEN 2 ELSE 3 END, scheduled_time NULLS LAST LIMIT 1;
  END IF;

  DELETE FROM heats WHERE event_id = p_event_id AND stage = v_stage AND status = 'SCHEDULED';

  FOR i IN 1..v_num_heats LOOP
    INSERT INTO heats (event_id, schedule_item_id, stage, heat_number, status)
    VALUES (p_event_id, v_schedule_item, v_stage, i, 'SCHEDULED')
    RETURNING id INTO v_heat_id;
    v_heat_ids := array_append(v_heat_ids, v_heat_id);

    -- Round-robin deal: entrant n goes to heat ((n-1) mod H) + 1.
    SELECT array_agg(x.id ORDER BY x.ord) INTO v_members
    FROM unnest(v_ids) WITH ORDINALITY AS x(id, ord)
    WHERE (x.ord - 1) % v_num_heats = i - 1;
    v_k := COALESCE(array_length(v_members, 1), 0);

    -- Lanes: the v_k most central lanes (or positions 1..v_k for one-group
    -- events), handed out in random order.
    WITH m AS (
      SELECT id, row_number() OVER (ORDER BY random()) AS rn FROM unnest(v_members) AS id
    ), l AS (
      SELECT lane, row_number() OVER (
               ORDER BY CASE WHEN v_single_group THEN lane ELSE abs(lane - (p_num_lanes + 1) / 2.0) END, lane
             ) AS rn
      FROM generate_series(1, CASE WHEN v_single_group THEN v_k ELSE GREATEST(p_num_lanes, v_k) END) AS lane
    )
    INSERT INTO heat_athletes (heat_id, profile_id, relay_team_id, lane_number)
    SELECT v_heat_id,
           CASE WHEN v_is_relay THEN NULL ELSE m.id END,
           CASE WHEN v_is_relay THEN m.id ELSE NULL END,
           l.lane
    FROM m JOIN l USING (rn);
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'event_id', p_event_id,
    'stage', v_stage,
    'total_athletes', v_total,
    'num_heats', v_num_heats,
    'heats_created', v_heat_ids,
    'left_out', jsonb_build_object('not_accredited', v_not_accredited, 'not_paid', v_not_paid)
  );
END;
$function$;

-- get_championship_standings()
CREATE OR REPLACE FUNCTION public.get_championship_standings()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_combined JSONB;
  v_mens JSONB;
  v_womens JSONB;
  v_best_men JSONB;
  v_best_women JSONB;
BEGIN
  -- Overall College Championship: every event, Mixed Relay included
  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_combined
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, college_name) AS rank, t.*
    FROM (
      SELECT
        c.id AS college_id, c.name AS college_name, c.code AS college_code, c.district,
        COALESCE(SUM(sc.college_points), 0) AS total_points,
        COALESCE(SUM(sc.college_points) FILTER (WHERE NOT sc.is_relay), 0) AS individual_points,
        COALESCE(SUM(sc.college_points) FILTER (WHERE sc.is_relay), 0) AS relay_points,
        COUNT(sc.id) FILTER (WHERE sc.place = 1) AS golds,
        COUNT(sc.id) FILTER (WHERE sc.place = 2) AS silvers,
        COUNT(sc.id) FILTER (WHERE sc.place = 3) AS bronzes
      FROM colleges c
      LEFT JOIN championship_scored_points sc ON sc.college_id = c.id
      GROUP BY c.id, c.name, c.code, c.district
    ) t
  ) r;

  -- Best Men's / Women's College: that division's events, relays included (Mixed Relay excluded)
  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_mens
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, college_name) AS rank, t.*
    FROM (
      SELECT
        c.id AS college_id, c.name AS college_name, c.code AS college_code,
        COALESCE(SUM(sc.college_points), 0) AS total_points,
        COUNT(sc.id) FILTER (WHERE sc.place = 1) AS golds,
        COUNT(sc.id) FILTER (WHERE sc.place = 2) AS silvers,
        COUNT(sc.id) FILTER (WHERE sc.place = 3) AS bronzes
      FROM colleges c
      JOIN squads s ON s.college_id = c.id AND s.gender = 'men'
      LEFT JOIN championship_scored_points sc ON sc.squad_id = s.id AND NOT sc.is_mixed
      GROUP BY c.id, c.name, c.code
    ) t
  ) r;

  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_womens
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, college_name) AS rank, t.*
    FROM (
      SELECT
        c.id AS college_id, c.name AS college_name, c.code AS college_code,
        COALESCE(SUM(sc.college_points), 0) AS total_points,
        COUNT(sc.id) FILTER (WHERE sc.place = 1) AS golds,
        COUNT(sc.id) FILTER (WHERE sc.place = 2) AS silvers,
        COUNT(sc.id) FILTER (WHERE sc.place = 3) AS bronzes
      FROM colleges c
      JOIN squads s ON s.college_id = c.id AND s.gender = 'women'
      LEFT JOIN championship_scored_points sc ON sc.squad_id = s.id AND NOT sc.is_mixed
      GROUP BY c.id, c.name, c.code
    ) t
  ) r;

  -- Best Male / Female Athlete: best single World Athletics score from a final, then the 2nd best
  WITH perf AS (
    SELECT f.*, ROW_NUMBER() OVER (PARTITION BY f.profile_id ORDER BY f.wa_points DESC, f.event_code) AS n
    FROM wa_final_performances() f
  ), per_athlete AS (
    SELECT
      p.id AS profile_id, p.sslc_name AS athlete_name, p.usn, p.bid_number,
      c.name AS college_name, c.code AS college_code, s.gender,
      MAX(pf.wa_points) FILTER (WHERE pf.n = 1) AS total_points,
      MAX(pf.event_name) FILTER (WHERE pf.n = 1) AS best_event,
      MAX(pf.mark) FILTER (WHERE pf.n = 1) AS best_mark,
      MAX(pf.mark_unit) FILTER (WHERE pf.n = 1) AS best_mark_unit,
      MAX(pf.wa_points) FILTER (WHERE pf.n = 2) AS second_points,
      MAX(pf.event_name) FILTER (WHERE pf.n = 2) AS second_event,
      (SELECT COUNT(*) FROM championship_scored_points sc WHERE sc.profile_id = p.id AND NOT sc.is_relay AND sc.place = 1) AS golds,
      (SELECT COUNT(*) FROM championship_scored_points sc WHERE sc.profile_id = p.id AND NOT sc.is_relay AND sc.place = 2) AS silvers,
      (SELECT COUNT(*) FROM championship_scored_points sc WHERE sc.profile_id = p.id AND NOT sc.is_relay AND sc.place = 3) AS bronzes
    FROM perf pf
    JOIN profiles p ON p.id = pf.profile_id
    JOIN squads s ON s.id = p.squad_id
    JOIN colleges c ON c.id = s.college_id
    GROUP BY p.id, p.sslc_name, p.usn, p.bid_number, c.name, c.code, s.gender
  ), ranked AS (
    SELECT ROW_NUMBER() OVER (PARTITION BY gender ORDER BY total_points DESC, second_points DESC NULLS LAST, athlete_name) AS rank, a.*
    FROM per_athlete a
  )
  SELECT
    jsonb_agg(to_jsonb(r) - 'gender' ORDER BY r.rank) FILTER (WHERE r.gender = 'men'),
    jsonb_agg(to_jsonb(r) - 'gender' ORDER BY r.rank) FILTER (WHERE r.gender = 'women')
  INTO v_best_men, v_best_women
  FROM ranked r;

  RETURN jsonb_build_object(
    'success', true,
    'combined', COALESCE(v_combined, '[]'::jsonb),
    'mens', COALESCE(v_mens, '[]'::jsonb),
    'womens', COALESCE(v_womens, '[]'::jsonb),
    'best_male_athletes', COALESCE(v_best_men, '[]'::jsonb),
    'best_female_athletes', COALESCE(v_best_women, '[]'::jsonb),
    'rules', jsonb_build_object(
      'college_individual', jsonb_build_array(5, 3, 1),
      'college_combined_and_relay', jsonb_build_array(10, 6, 2),
      'relay_counts_for', 'overall_and_division',
      'mixed_relay_counts_for', 'overall_only',
      'best_athlete', 'world_athletics_scoring_tables_2025_best_single_final_performance'
    )
  );
END;
$function$;

-- get_meal_stats(p_date date)
CREATE OR REPLACE FUNCTION public.get_meal_stats(p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_date DATE := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_breakfast INT := 0;
  v_lunch INT := 0;
  v_snacks INT := 0;
  v_dinner INT := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE meal_type = 'BREAKFAST'),
    COUNT(*) FILTER (WHERE meal_type = 'LUNCH'),
    COUNT(*) FILTER (WHERE meal_type = 'SNACKS'),
    COUNT(*) FILTER (WHERE meal_type = 'DINNER')
  INTO v_breakfast, v_lunch, v_snacks, v_dinner
  FROM meal_logs WHERE meal_date = v_date;

  RETURN jsonb_build_object(
    'date', v_date,
    'breakfast_served', v_breakfast,
    'lunch_served', v_lunch,
    'snacks_served', v_snacks,
    'dinner_served', v_dinner,
    'total_meals_today', (v_breakfast + v_lunch + v_snacks + v_dinner)
  );
END;
$function$;

-- process_accommodation_checkin(p_client_uuid uuid, p_profile_id uuid, p_hostel_id uuid, p_warden_id uuid, p_room_assigned text, p_caution_deposit numeric, p_caution_receipt_no text, p_device_timestamp timestamp with time zone)
CREATE OR REPLACE FUNCTION public.process_accommodation_checkin(p_client_uuid uuid, p_profile_id uuid, p_hostel_id uuid, p_warden_id uuid, p_room_assigned text DEFAULT 'General Dorm'::text, p_caution_deposit numeric DEFAULT 0, p_caution_receipt_no text DEFAULT ''::text, p_device_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_profile RECORD;
  r_hostel RECORD;
  r_prev RECORD;
  v_current_occupancy INTEGER := 0;
BEGIN
  -- Same scan re-sent (offline sync retry)
  SELECT a.room_assigned, a.caution_deposit, a.caution_receipt_no, h.id AS hostel_id, h.name AS hostel_name
  INTO r_prev
  FROM accommodation_scans a JOIN hostels h ON h.id = a.hostel_id
  WHERE a.client_scan_uuid = p_client_uuid;
  IF FOUND THEN
    SELECT p.id, p.sslc_name, p.usn, p.bid_number, c.name AS college_name, s.squad_code
    INTO r_profile
    FROM profiles p JOIN squads s ON p.squad_id = s.id JOIN colleges c ON s.college_id = c.id
    WHERE p.id = p_profile_id;
    RETURN jsonb_build_object(
      'success', true, 'is_duplicate_sync', true, 'already_checked_in', false,
      'athlete_id', r_profile.id, 'sslc_name', r_profile.sslc_name, 'usn', r_profile.usn,
      'bid_number', r_profile.bid_number, 'college_name', r_profile.college_name, 'squad_code', r_profile.squad_code,
      'hostel_id', r_prev.hostel_id, 'hostel_name', r_prev.hostel_name, 'room_assigned', r_prev.room_assigned,
      'caution_deposit', r_prev.caution_deposit, 'caution_receipt_no', r_prev.caution_receipt_no
    );
  END IF;

  SELECT p.id, p.sslc_name, p.usn, p.bid_number, p.accreditation_status, p.accommodation_checked_in,
         p.accommodation_checked_in_at, c.name AS college_name, s.squad_code, s.gender AS squad_gender
  INTO r_profile
  FROM profiles p
  JOIN squads s ON p.squad_id = s.id
  JOIN colleges c ON s.college_id = c.id
  WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Athlete profile not found.';
  END IF;
  IF r_profile.accreditation_status = 'WITHDrAWN' THEN
    RAISE EXCEPTION 'Cannot check-in withdrawn athlete.';
  END IF;

  -- Already checked in: report where, add nothing
  IF r_profile.accommodation_checked_in THEN
    SELECT a.room_assigned, h.id AS hostel_id, h.name AS hostel_name, a.synced_at
    INTO r_prev
    FROM accommodation_scans a JOIN hostels h ON h.id = a.hostel_id
    WHERE a.profile_id = p_profile_id
    ORDER BY a.synced_at ASC
    LIMIT 1;
    RETURN jsonb_build_object(
      'success', true, 'is_duplicate_sync', false, 'already_checked_in', true,
      'checked_in_at', r_profile.accommodation_checked_in_at,
      'athlete_id', r_profile.id, 'sslc_name', r_profile.sslc_name, 'usn', r_profile.usn,
      'bid_number', r_profile.bid_number, 'college_name', r_profile.college_name, 'squad_code', r_profile.squad_code,
      'hostel_id', r_prev.hostel_id, 'hostel_name', r_prev.hostel_name, 'room_assigned', r_prev.room_assigned
    );
  END IF;

  SELECT id, name, gender, total_capacity INTO r_hostel FROM hostels WHERE id = p_hostel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hostel not found.';
  END IF;

  IF LOWER(r_profile.squad_gender) <> LOWER(r_hostel.gender) THEN
    RAISE EXCEPTION 'Gender mismatch: % athlete cannot be allocated to % hostel (%).',
      UPPER(r_profile.squad_gender), UPPER(r_hostel.gender), r_hostel.name;
  END IF;

  SELECT COUNT(DISTINCT profile_id) INTO v_current_occupancy FROM accommodation_scans WHERE hostel_id = p_hostel_id;

  UPDATE profiles
  SET accommodation_checked_in = TRUE,
      accommodation_checked_in_at = COALESCE(accommodation_checked_in_at, COALESCE(p_device_timestamp, now())),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_profile_id;

  INSERT INTO accommodation_scans (
    client_scan_uuid, profile_id, hostel_id, scanned_by, room_assigned, caution_deposit, caution_receipt_no, device_timestamp
  )
  VALUES (
    p_client_uuid, p_profile_id, p_hostel_id, p_warden_id,
    COALESCE(NULLIF(p_room_assigned, ''), 'General Dorm'),
    COALESCE(p_caution_deposit, 0),
    COALESCE(p_caution_receipt_no, ''),
    COALESCE(p_device_timestamp, timezone('utc'::text, now()))
  );

  RETURN jsonb_build_object(
    'success', true, 'is_duplicate_sync', false, 'already_checked_in', false,
    'athlete_id', r_profile.id, 'sslc_name', r_profile.sslc_name, 'usn', r_profile.usn,
    'bid_number', r_profile.bid_number, 'college_name', r_profile.college_name, 'squad_code', r_profile.squad_code,
    'hostel_id', r_hostel.id, 'hostel_name', r_hostel.name,
    'room_assigned', COALESCE(NULLIF(p_room_assigned, ''), 'General Dorm'),
    'caution_deposit', COALESCE(p_caution_deposit, 0),
    'caution_receipt_no', COALESCE(p_caution_receipt_no, ''),
    'occupancy_after_checkin', v_current_occupancy + 1,
    'total_capacity', r_hostel.total_capacity
  );
END;
$function$;

-- process_accreditation_scan(p_client_uuid uuid, p_profile_id uuid, p_volunteer_id uuid, p_device_timestamp timestamp with time zone)
CREATE OR REPLACE FUNCTION public.process_accreditation_scan(p_client_uuid uuid, p_profile_id uuid, p_volunteer_id uuid, p_device_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_profile RECORD;
  v_scan_exists BOOLEAN := FALSE;
  v_by TEXT;
  v_college JSONB;
  v_events JSONB;
BEGIN
  SELECT p.id, p.sslc_name, p.usn, p.bid_number, p.accreditation_status,
         s.college_id, c.name AS college_name, s.squad_code
  INTO r_profile
  FROM profiles p
  JOIN squads s ON p.squad_id = s.id
  JOIN colleges c ON s.college_id = c.id
  WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Athlete profile not found.';
  END IF;

  SELECT TRUE INTO v_scan_exists FROM accreditation_scans WHERE client_scan_uuid = p_client_uuid;

  IF v_scan_exists THEN
    -- Offline retry of a scan already processed: report, change nothing
    v_college := jsonb_build_object('already_present', true, 'newly_accredited', 0, 'college_id', r_profile.college_id);
  ELSE
    IF r_profile.accreditation_status = 'WITHDrAWN' THEN
      RAISE EXCEPTION 'This athlete was withdrawn. Scan another athlete of the college.';
    END IF;

    SELECT display_name INTO v_by FROM staff WHERE id = p_volunteer_id;
    v_college := check_in_college(r_profile.college_id, COALESCE(v_by, 'Accreditation desk'));

    INSERT INTO accreditation_scans (client_scan_uuid, profile_id, scanned_by, device_timestamp)
    VALUES (p_client_uuid, p_profile_id, p_volunteer_id, COALESCE(p_device_timestamp, timezone('utc'::text, now())));
  END IF;

  SELECT jsonb_agg(jsonb_build_object('name', e.name, 'code', e.code, 'kind', r.kind))
  INTO v_events
  FROM registrations r JOIN events e ON r.event_id = e.id
  WHERE r.profile_id = p_profile_id;

  RETURN v_college || jsonb_build_object(
    'success', true,
    'is_duplicate_sync', COALESCE(v_scan_exists, false),
    'already_accredited', COALESCE((v_college->>'already_present')::boolean, false),
    'athlete_id', r_profile.id,
    'sslc_name', r_profile.sslc_name,
    'usn', r_profile.usn,
    'bid_number', r_profile.bid_number,
    'college_name', r_profile.college_name,
    'squad_code', r_profile.squad_code,
    'events', COALESCE(v_events, '[]'::jsonb),
    'status', 'ACCREDITED'
  );
END;
$function$;

-- scan_meal_coupon(p_client_uuid text, p_profile_id uuid, p_meal_type text, p_volunteer_id uuid, p_scanned_at timestamp with time zone)
CREATE OR REPLACE FUNCTION public.scan_meal_coupon(p_client_uuid text, p_profile_id uuid, p_meal_type text, p_volunteer_id uuid DEFAULT NULL::uuid, p_scanned_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_athlete RECORD;
  r_existing_meal RECORD;
  -- Never in the future; an offline scan keeps its own time
  v_at TIMESTAMPTZ := LEAST(COALESCE(p_scanned_at, now()), now());
  v_date DATE := (LEAST(COALESCE(p_scanned_at, now()), now()) AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  SELECT p.id, p.sslc_name, p.usn, p.bid_number, p.accreditation_status, s.payment_status, c.name AS college_name, c.code AS college_code
  INTO r_athlete
  FROM profiles p
  JOIN squads s ON p.squad_id = s.id
  JOIN colleges c ON s.college_id = c.id
  WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Athlete record not found in system.');
  END IF;

  IF r_athlete.accreditation_status = 'WITHDrAWN' THEN
    RETURN jsonb_build_object('success', false, 'status', 'WITHDrAWN', 'message', 'Athlete has been officially withdrawn from the meet.');
  END IF;

  -- Same scan re-sent (offline sync retry)
  IF EXISTS (SELECT 1 FROM meal_logs WHERE client_scan_uuid = p_client_uuid) THEN
    RETURN jsonb_build_object(
      'success', true, 'status', 'GRANTED', 'is_duplicate_sync', true, 'meal_type', p_meal_type,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code
    );
  END IF;

  -- Only athletes who may compete eat: college paid and athlete accredited (audit S3)
  IF r_athlete.payment_status <> 'VERIFIED' THEN
    RETURN jsonb_build_object(
      'success', false, 'status', 'NOT_PAID', 'meal_type', p_meal_type,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
      'message', 'NOT ELIGIBLE: the college''s registration fee is not verified yet. Send the athlete to the meet office.'
    );
  END IF;
  IF r_athlete.accreditation_status <> 'ACCREDITED' THEN
    RETURN jsonb_build_object(
      'success', false, 'status', 'NOT_ACCREDITED', 'meal_type', p_meal_type,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
      'message', 'NOT ELIGIBLE: athlete is not accredited yet. Send them to the accreditation desk first.'
    );
  END IF;

  SELECT scanned_at INTO r_existing_meal
  FROM meal_logs
  WHERE profile_id = p_profile_id AND meal_type = p_meal_type AND meal_date = v_date;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'status', 'ALREADY_SERVED', 'meal_type', p_meal_type,
      'served_at', r_existing_meal.scanned_at,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
      'message', 'ALREADY CLAIMED: Athlete already received ' || p_meal_type || ' at '
        || to_char(r_existing_meal.scanned_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') || '.'
    );
  END IF;

  BEGIN
    INSERT INTO meal_logs (client_scan_uuid, profile_id, meal_type, meal_date, scanned_by, scanned_at)
    VALUES (p_client_uuid, p_profile_id, p_meal_type, v_date, p_volunteer_id, v_at);
  EXCEPTION WHEN unique_violation THEN
    -- Two counters scanned the same athlete at the same moment
    RETURN jsonb_build_object(
      'success', false, 'status', 'ALREADY_SERVED', 'meal_type', p_meal_type,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
      'message', 'ALREADY CLAIMED: Athlete already received ' || p_meal_type || ' today.'
    );
  END;

  RETURN jsonb_build_object(
    'success', true, 'status', 'GRANTED', 'is_duplicate_sync', false, 'meal_type', p_meal_type,
    'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
    'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
    'message', 'Meal verified successfully.'
  );
END;
$function$;

-- substitute_athlete(p_withdrawn_profile_id uuid, p_new_sslc_name text, p_new_usn text, p_new_semester integer, p_new_blood_group text, p_new_joining_date date, p_new_sem_start_date date, p_reason text, p_admin_id uuid, p_new_date_of_birth date, p_new_phone text, p_new_aadhaar text, p_new_photo_url text)
CREATE OR REPLACE FUNCTION public.substitute_athlete(p_withdrawn_profile_id uuid, p_new_sslc_name text, p_new_usn text, p_new_semester integer, p_new_blood_group text, p_new_joining_date date, p_new_sem_start_date date, p_reason text, p_admin_id uuid, p_new_date_of_birth date DEFAULT NULL::date, p_new_phone text DEFAULT NULL::text, p_new_aadhaar text DEFAULT NULL::text, p_new_photo_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_bid INT;
  v_squad_id UUID;
  v_status TEXT;
  v_new_profile_id UUID;
  v_regs JSONB;
  v_copied INT := 0;
  r RECORD;
BEGIN
  SELECT bid_number, squad_id, accreditation_status
  INTO v_bid, v_squad_id, v_status
  FROM profiles
  WHERE id = p_withdrawn_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawn profile not found.';
  END IF;
  IF v_status <> 'WITHDrAWN' THEN
    RAISE EXCEPTION 'Only a withdrawn athlete''s slot can be substituted. Withdraw the athlete first.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM roster_amendments
    WHERE amendment_type = 'substitute' AND original_profile_id = p_withdrawn_profile_id
  ) THEN
    RAISE EXCEPTION 'This slot already has a substitute.';
  END IF;

  INSERT INTO profiles (
    squad_id, sslc_name, usn, semester, blood_group,
    college_joining_date, sem_start_date, bid_number, accreditation_status,
    date_of_birth, phone, aadhaar_number, photo_url
  )
  VALUES (
    v_squad_id, p_new_sslc_name, upper(trim(p_new_usn)), p_new_semester, p_new_blood_group,
    p_new_joining_date, p_new_sem_start_date, v_bid, 'REGISTERED',
    p_new_date_of_birth, NULLIF(trim(p_new_phone), ''), NULLIF(trim(p_new_aadhaar), ''), NULLIF(trim(p_new_photo_url), '')
  )
  RETURNING id INTO v_new_profile_id;

  -- Take over the withdrawn athlete's events (regular, reserve, relay, half marathon)
  SELECT withdrawn_registrations INTO v_regs
  FROM roster_amendments
  WHERE amendment_type = 'withdraw' AND original_profile_id = p_withdrawn_profile_id
    AND withdrawn_registrations IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_regs IS NOT NULL THEN
    -- Regular events first, so the reserve / relay rules see them
    FOR r IN
      SELECT (x->>'event_id')::UUID AS event_id, x->>'kind' AS kind
      FROM jsonb_array_elements(v_regs) x
      ORDER BY CASE x->>'kind' WHEN 'regular' THEN 0 WHEN 'half_marathon' THEN 1 WHEN 'relay' THEN 2 ELSE 3 END
    LOOP
      INSERT INTO registrations (profile_id, event_id, kind) VALUES (v_new_profile_id, r.event_id, r.kind);
      v_copied := v_copied + 1;
    END LOOP;
  END IF;

  INSERT INTO roster_amendments (
    squad_id, amendment_type, original_profile_id, new_profile_id, bid_number, reason, performed_by
  )
  VALUES (v_squad_id, 'substitute', p_withdrawn_profile_id, v_new_profile_id, v_bid, p_reason, p_admin_id);

  RETURN jsonb_build_object(
    'success', true,
    'new_profile_id', v_new_profile_id,
    'inherited_bid_number', v_bid,
    'copied_registrations', v_copied
  );
END;
$function$;

-- sync_squad_payment_status()
CREATE OR REPLACE FUNCTION public.sync_squad_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_verified_total INT;
  v_pending_count INT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE squads
    SET payment_status = 'SUBMITTED',
        updated_at = timezone('utc'::text, now())
    WHERE id = NEW.squad_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(COALESCE(amount_received, 0)), 0) INTO v_verified_total
    FROM payments
    WHERE squad_id = NEW.squad_id AND status = 'VERIFIED';

    SELECT count(*) INTO v_pending_count
    FROM payments
    WHERE squad_id = NEW.squad_id AND status = 'SUBMITTED';

    IF v_verified_total > 0 AND v_verified_total >= NEW.amount_expected THEN
      UPDATE squads
      SET payment_status = 'VERIFIED', updated_at = timezone('utc'::text, now())
      WHERE id = NEW.squad_id;
    ELSIF v_pending_count > 0 OR v_verified_total > 0 THEN
      -- Awaiting another receipt, or verified but under-paid: balance due
      UPDATE squads
      SET payment_status = 'SUBMITTED', updated_at = timezone('utc'::text, now())
      WHERE id = NEW.squad_id;
    ELSE
      UPDATE squads
      SET payment_status = 'REJECTED', updated_at = timezone('utc'::text, now())
      WHERE id = NEW.squad_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- validate_relay_team_composition()
CREATE OR REPLACE FUNCTION public.validate_relay_team_composition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_runner_count INT;
  v_reserve_count INT;
BEGIN
  IF current_setting('aura.relay_swap', true) = 'on' THEN
    RETURN NEW;  -- inside swap_relay_runner: the end state is checked by construction (still 4 runners + same reserves)
  END IF;
  IF NEW.is_reserve = FALSE THEN
    SELECT count(*) INTO v_runner_count
    FROM relay_members
    WHERE relay_team_id = NEW.relay_team_id AND is_reserve = FALSE AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');

    IF v_runner_count >= 4 THEN
      RAISE EXCEPTION 'A relay team cannot have more than 4 running members.';
    END IF;
  ELSE
    SELECT count(*) INTO v_reserve_count
    FROM relay_members
    WHERE relay_team_id = NEW.relay_team_id AND is_reserve = TRUE AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');

    IF v_reserve_count >= 2 THEN
      RAISE EXCEPTION 'A relay team cannot have more than 2 reserve runners.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- withdraw_athlete(p_profile_id uuid, p_reason text, p_admin_id uuid)
CREATE OR REPLACE FUNCTION public.withdraw_athlete(p_profile_id uuid, p_reason text, p_admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_bid INT;
  v_squad_id UUID;
  v_name TEXT;
  v_status TEXT;
  v_regs JSONB;
BEGIN
  SELECT bid_number, squad_id, sslc_name, accreditation_status
  INTO v_bid, v_squad_id, v_name, v_status
  FROM profiles
  WHERE id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Athlete profile not found.';
  END IF;
  IF v_status = 'WITHDrAWN' THEN
    RAISE EXCEPTION '% is already withdrawn.', v_name;
  END IF;

  -- Remember the events so a substitute can take them over
  SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id', event_id, 'kind', kind)), '[]'::jsonb)
  INTO v_regs
  FROM registrations
  WHERE profile_id = p_profile_id;

  UPDATE profiles
  SET accreditation_status = 'WITHDrAWN', updated_at = timezone('utc'::text, now())
  WHERE id = p_profile_id;

  -- Delete event registrations so they do not appear in heat seeding
  DELETE FROM registrations WHERE profile_id = p_profile_id;
  DELETE FROM relay_members WHERE profile_id = p_profile_id;

  INSERT INTO roster_amendments (
    squad_id, amendment_type, original_profile_id, bid_number, reason, performed_by, withdrawn_registrations
  )
  VALUES (v_squad_id, 'withdraw', p_profile_id, v_bid, p_reason, p_admin_id, v_regs);

  RETURN jsonb_build_object(
    'success', true,
    'athlete_name', v_name,
    'bid_number', v_bid,
    'status', 'WITHDrAWN',
    'saved_registrations', jsonb_array_length(v_regs)
  );
END;
$function$;

-- 3. Withdrawn status: production allowed 'WITHDRAWN', the code writes 'WITHDrAWN'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_accreditation_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_accreditation_status_check CHECK ((accreditation_status = ANY (ARRAY['REGISTERED'::text, 'ACCREDITED'::text, 'WITHDrAWN'::text])));

-- 4. Verify: every function must now be byte-identical to staging, and no stale overload may remain
DO $check$
DECLARE
  v_bad TEXT := '';
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('advance_heat_to_track(p_heat_id uuid, p_official_id uuid)', 'f5285b3532a712d82393f916877d1e2e'),
    ('allocate_event_points(p_event_id uuid, p_heat_id uuid)', 'f6a893182c3b38243bafcc2744f4bc29'),
    ('compute_field_standings(p_heat_id uuid)', '0ee72d690bc28bfd433575c3a1e32238'),
    ('generate_heat_draw(p_event_id uuid, p_stage text, p_num_lanes integer, p_only_ids uuid[])', '5340e92573c11cce61497e62c39565f3'),
    ('get_championship_standings()', '19797d0a4640c719d61ec86682c6c37c'),
    ('get_meal_stats(p_date date)', 'ddaca46c48f43b16e74888b14cd389ad'),
    ('process_accommodation_checkin(p_client_uuid uuid, p_profile_id uuid, p_hostel_id uuid, p_warden_id uuid, p_room_assigned text, p_caution_deposit numeric, p_caution_receipt_no text, p_device_timestamp timestamp with time zone)', '2486d5518ccb4d9f03eafe0d41b0e793'),
    ('process_accreditation_scan(p_client_uuid uuid, p_profile_id uuid, p_volunteer_id uuid, p_device_timestamp timestamp with time zone)', '4c43a71f1f0b063543f099473e1397ec'),
    ('scan_meal_coupon(p_client_uuid text, p_profile_id uuid, p_meal_type text, p_volunteer_id uuid, p_scanned_at timestamp with time zone)', '1ab760a24b020da372cdd1050184e10e'),
    ('substitute_athlete(p_withdrawn_profile_id uuid, p_new_sslc_name text, p_new_usn text, p_new_semester integer, p_new_blood_group text, p_new_joining_date date, p_new_sem_start_date date, p_reason text, p_admin_id uuid, p_new_date_of_birth date, p_new_phone text, p_new_aadhaar text, p_new_photo_url text)', 'aaab3891997878f8872ce59df1aa1d1f'),
    ('sync_squad_payment_status()', '22e2a42cdaf720cb6f842f5a7e8f617f'),
    ('validate_relay_team_composition()', '59acf8a97f98ade63831f14845fed1ce'),
    ('withdraw_athlete(p_profile_id uuid, p_reason text, p_admin_id uuid)', 'bc6ec307cc823384bd82c9fb4d331d92')
  ) AS t(sig, want) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = r.sig
        AND md5(pg_get_functiondef(p.oid)) = r.want
    ) THEN
      v_bad := v_bad || ' ' || split_part(r.sig, '(', 1);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('generate_heat_draw', 'scan_meal_coupon', 'substitute_athlete')) <> 3 THEN
    v_bad := v_bad || ' (extra overloads)';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION '0055 check failed, nothing applied:%', v_bad;
  END IF;
  RAISE NOTICE '0055: all 13 functions match staging; no stale overloads.';
END
$check$;
