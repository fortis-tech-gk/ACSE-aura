-- =============================================================================
-- 0049: Event roll call in the call room, heats drawn from who is present, Q / q marks
--
-- New first-round flow (25-11-2026):
--   1. The call room official opens the ROLL CALL of an event's first round. Every eligible
--      entrant (same rules as the heat draw: accredited, college payment verified, relay teams
--      with 4 accredited runners) is on it.
--   2. Athletes scan in (a relay team reports when any of its runners scans). A reserve of the
--      same college can come in for an absent athlete.
--   3. "Prepare heats": the heats are drawn from the athletes who REPORTED only (teammates in
--      different heats, random lanes, centre lanes first), everyone in them is marked reported,
--      and the heats go straight to the referee (call room closed). The rest are DNS.
--   Later rounds (semi-final, final) still use the per-heat call room.
--
--   heat_athletes.qualified_as: 'Q' (on place) or 'q' (fastest loser), set on the entries of a
--   round when the next round is built from it.
-- Safe to re-run.
-- =============================================================================

BEGIN;

ALTER TABLE heat_athletes ADD COLUMN IF NOT EXISTS qualified_as TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'heat_athletes_qualified_as_check') THEN
    ALTER TABLE heat_athletes ADD CONSTRAINT heat_athletes_qualified_as_check CHECK (qualified_as IN ('Q', 'q'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS roll_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('HEATS', 'SEMI_FINAL', 'FINAL', 'QUALIFYING')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DRAWN')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  opened_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  drawn_at TIMESTAMPTZ,
  drawn_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  num_heats INTEGER,
  UNIQUE (event_id, stage)
);

CREATE TABLE IF NOT EXISTS roll_call_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roll_call_id UUID NOT NULL REFERENCES roll_calls(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  relay_team_id UUID REFERENCES relay_teams(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REPORTED', 'SCRATCH', 'DNS')),
  reported_at TIMESTAMPTZ,
  marked_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  substituted_for UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  CHECK ((profile_id IS NULL) <> (relay_team_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS roll_call_entries_profile ON roll_call_entries (roll_call_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roll_call_entries_team ON roll_call_entries (roll_call_id, relay_team_id) WHERE relay_team_id IS NOT NULL;

ALTER TABLE roll_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE roll_call_entries ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- Heat draw: optional p_only_ids = the entrants to draw (the roll call's reported list)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_heat_draw(uuid, text, integer);
CREATE OR REPLACE FUNCTION public.generate_heat_draw(p_event_id uuid, p_stage text DEFAULT 'HEATS'::text, p_num_lanes integer DEFAULT 8, p_only_ids uuid[] DEFAULT NULL)
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
  -- A mass-start distance event (1500m) that has HEATS is split into heats of p_num_lanes (8) runners;
  -- mass-start events that are straight finals (5000m, 10000m), road races and field events stay one group.
  v_single_group := (r_event.start_type IN ('mass', 'road') AND NOT (r_event.start_type = 'mass' AND p_stage = 'HEATS'))
                    OR r_event.category LIKE 'field%';

  SELECT count(*) INTO v_active
  FROM heats WHERE event_id = p_event_id AND stage = p_stage AND status <> 'SCHEDULED';
  IF v_active > 0 THEN
    RAISE EXCEPTION 'Cannot redraw % (%): % heat(s) are already under way or finished.',
      r_event.name, p_stage, v_active;
  END IF;

  IF p_stage = 'FINAL' AND EXISTS (
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
    IF p_stage = 'FINAL' AND v_total > p_num_lanes THEN
      RAISE EXCEPTION '% has % eligible athletes for % lanes. Draw HEATS first; the final is built from their results.',
        r_event.name, v_total, p_num_lanes;
    END IF;
    v_num_heats := CEIL(v_total::NUMERIC / p_num_lanes)::INTEGER;
  END IF;

  -- Replace the scheduled heats of this stage, keeping their schedule slot.
  SELECT schedule_item_id INTO v_schedule_item
  FROM heats
  WHERE event_id = p_event_id AND stage = p_stage AND schedule_item_id IS NOT NULL
  ORDER BY heat_number LIMIT 1;

  DELETE FROM heats WHERE event_id = p_event_id AND stage = p_stage AND status = 'SCHEDULED';

  FOR i IN 1..v_num_heats LOOP
    INSERT INTO heats (event_id, schedule_item_id, stage, heat_number, status)
    VALUES (p_event_id, v_schedule_item, p_stage, i, 'SCHEDULED')
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
    'stage', p_stage,
    'total_athletes', v_total,
    'num_heats', v_num_heats,
    'heats_created', v_heat_ids,
    'left_out', jsonb_build_object('not_accredited', v_not_accredited, 'not_paid', v_not_paid)
  );
END;
$function$;
-- ------------------------------------------------------------------------------
-- Open (or refresh) the roll call of an event's first round
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION open_roll_call(p_event_id UUID, p_stage TEXT, p_official_id UUID)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  r_event RECORD;
  v_rc UUID;
  v_status TEXT;
  v_added INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('roll_call_' || p_event_id::text || '_' || p_stage));

  SELECT id, name, category INTO r_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;
  IF r_event.category = 'combined' THEN
    RAISE EXCEPTION 'Combined events are not drawn from a roll call.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM heats WHERE event_id = p_event_id
      AND (CASE stage WHEN 'QUALIFYING' THEN 1 WHEN 'HEATS' THEN 1 WHEN 'SEMI_FINAL' THEN 2 ELSE 3 END)
        < (CASE p_stage WHEN 'QUALIFYING' THEN 1 WHEN 'HEATS' THEN 1 WHEN 'SEMI_FINAL' THEN 2 ELSE 3 END)
  ) THEN
    RAISE EXCEPTION 'A roll call is only for the first round of %.', r_event.name;
  END IF;
  IF EXISTS (SELECT 1 FROM heats WHERE event_id = p_event_id AND stage = p_stage AND status <> 'SCHEDULED') THEN
    RAISE EXCEPTION 'The heats of % are already under way.', r_event.name;
  END IF;

  INSERT INTO roll_calls (event_id, stage, opened_by)
  VALUES (p_event_id, p_stage, p_official_id)
  ON CONFLICT (event_id, stage) DO NOTHING;
  SELECT id, status INTO v_rc, v_status FROM roll_calls WHERE event_id = p_event_id AND stage = p_stage;
  IF v_status = 'DRAWN' THEN
    RAISE EXCEPTION 'The heats of % were already prepared from the roll call.', r_event.name;
  END IF;

  -- Everyone who may compete (added again if they became eligible after the roll call opened)
  IF r_event.category = 'relay' THEN
    INSERT INTO roll_call_entries (roll_call_id, relay_team_id)
    SELECT v_rc, rt.id
    FROM relay_teams rt JOIN squads s ON s.id = rt.squad_id
    WHERE rt.event_id = p_event_id AND s.payment_status = 'VERIFIED'
      AND (SELECT count(*) FROM relay_members rm JOIN profiles p ON p.id = rm.profile_id
           WHERE rm.relay_team_id = rt.id AND p.accreditation_status = 'ACCREDITED') >= 4
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO roll_call_entries (roll_call_id, profile_id)
    SELECT DISTINCT v_rc, p.id
    FROM registrations r
    JOIN profiles p ON p.id = r.profile_id
    JOIN squads s ON s.id = p.squad_id
    WHERE r.event_id = p_event_id AND r.kind IN ('regular', 'half_marathon')
      AND p.accreditation_status = 'ACCREDITED' AND s.payment_status = 'VERIFIED'
      AND NOT EXISTS (SELECT 1 FROM roll_call_entries x WHERE x.roll_call_id = v_rc AND x.substituted_for = p.id)
    ON CONFLICT DO NOTHING;
  END IF;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'roll_call_id', v_rc, 'added', v_added);
END;
$$;

-- ------------------------------------------------------------------------------
-- Reserves who could come in for an absent athlete on the roll call
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roll_call_reserves(p_entry_id UUID)
RETURNS TABLE (profile_id UUID, sslc_name TEXT, bid_number INTEGER)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.sslc_name, p.bid_number
  FROM roll_call_entries en
  JOIN roll_calls rc ON rc.id = en.roll_call_id
  JOIN profiles absent ON absent.id = en.profile_id
  JOIN registrations r ON r.event_id = rc.event_id AND r.kind = 'reserve'
  JOIN profiles p ON p.id = r.profile_id
  JOIN squads s ON s.id = p.squad_id
  WHERE en.id = p_entry_id
    AND p.squad_id = absent.squad_id
    AND p.id <> absent.id
    AND p.accreditation_status = 'ACCREDITED'
    AND s.payment_status = 'VERIFIED'
    AND NOT EXISTS (SELECT 1 FROM roll_call_entries x WHERE x.roll_call_id = rc.id AND x.profile_id = p.id)
  ORDER BY p.bid_number NULLS LAST, p.sslc_name
$$;

CREATE OR REPLACE FUNCTION roll_call_reserve_swap(p_entry_id UUID, p_reserve_profile_id UUID, p_official_id UUID)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  r_en RECORD;
  v_absent TEXT;
  v_reserve TEXT;
BEGIN
  SELECT en.*, rc.status AS rc_status, rc.event_id INTO r_en
  FROM roll_call_entries en JOIN roll_calls rc ON rc.id = en.roll_call_id
  WHERE en.id = p_entry_id FOR UPDATE OF en;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry not found on the roll call.';
  END IF;
  IF r_en.rc_status <> 'OPEN' THEN
    RAISE EXCEPTION 'The heats are already prepared; a reserve can no longer come in.';
  END IF;
  IF r_en.profile_id IS NULL THEN
    RAISE EXCEPTION 'Relay teams change runners with the relay swap.';
  END IF;
  IF r_en.status = 'REPORTED' THEN
    RAISE EXCEPTION 'This athlete has reported. Mark them scratched first if they will not compete.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roll_call_reserves(p_entry_id) x WHERE x.profile_id = p_reserve_profile_id) THEN
    RAISE EXCEPTION 'That athlete cannot come in: a reserve must be accredited, from the same college, registered for this event as their reserve event, and not already on the roll call.';
  END IF;
  SELECT sslc_name INTO v_absent FROM profiles WHERE id = r_en.profile_id;
  SELECT sslc_name INTO v_reserve FROM profiles WHERE id = p_reserve_profile_id;
  UPDATE roll_call_entries
  SET substituted_for = profile_id, profile_id = p_reserve_profile_id, status = 'REPORTED',
      reported_at = timezone('utc'::text, now()), marked_by = p_official_id,
      notes = 'Reserve in for ' || v_absent
  WHERE id = p_entry_id;
  RETURN jsonb_build_object('success', true, 'absent', v_absent, 'reserve', v_reserve);
END;
$$;

-- ------------------------------------------------------------------------------
-- Prepare heats: draw only the reported entrants, mark them reported, send to the referee
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prepare_heats_from_roll_call(p_event_id UUID, p_stage TEXT, p_num_lanes INTEGER, p_official_id UUID)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  r_rc RECORD;
  v_ids UUID[];
  v_draw JSONB;
  v_heat_ids UUID[];
  v_dns INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('roll_call_' || p_event_id::text || '_' || p_stage));
  SELECT * INTO r_rc FROM roll_calls WHERE event_id = p_event_id AND stage = p_stage FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open the roll call first.';
  END IF;
  IF r_rc.status <> 'OPEN' THEN
    RAISE EXCEPTION 'The heats were already prepared from this roll call.';
  END IF;

  SELECT array_agg(COALESCE(profile_id, relay_team_id)) INTO v_ids
  FROM roll_call_entries WHERE roll_call_id = r_rc.id AND status = 'REPORTED';
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'No one has reported yet. Scan the athletes first.';
  END IF;

  v_draw := generate_heat_draw(p_event_id, p_stage, p_num_lanes, v_ids);
  SELECT array_agg(x::UUID) INTO v_heat_ids FROM jsonb_array_elements_text(v_draw->'heats_created') x;

  -- Everyone drawn stood in the call room
  INSERT INTO call_room_inspections (heat_athlete_id, inspected_by, reported_status, bib_affixed, spike_length_mm, uniform_approved, notes, inspected_at)
  SELECT ha.id, p_official_id, 'REPORTED', TRUE, 9.0, TRUE, 'Reported at the event roll call', COALESCE(en.reported_at, timezone('utc'::text, now()))
  FROM heat_athletes ha
  JOIN roll_call_entries en ON en.roll_call_id = r_rc.id
   AND (en.profile_id = ha.profile_id OR en.relay_team_id = ha.relay_team_id)
  WHERE ha.heat_id = ANY(v_heat_ids)
  ON CONFLICT (heat_athlete_id) DO UPDATE SET reported_status = 'REPORTED', inspected_at = EXCLUDED.inspected_at;

  UPDATE heat_athletes ha
  SET call_room_reported = TRUE,
      call_room_reported_at = COALESCE(en.reported_at, timezone('utc'::text, now()))
  FROM roll_call_entries en
  WHERE ha.heat_id = ANY(v_heat_ids) AND en.roll_call_id = r_rc.id
    AND (en.profile_id = ha.profile_id OR en.relay_team_id = ha.relay_team_id);

  -- Straight to the referee: the call room for these heats is closed
  UPDATE heats
  SET status = 'ON_TRACK', call_room_opened_at = r_rc.opened_at, call_room_closed_at = timezone('utc'::text, now())
  WHERE id = ANY(v_heat_ids);

  UPDATE roll_call_entries SET status = 'DNS' WHERE roll_call_id = r_rc.id AND status = 'PENDING';
  GET DIAGNOSTICS v_dns = ROW_COUNT;

  UPDATE roll_calls
  SET status = 'DRAWN', drawn_at = timezone('utc'::text, now()), drawn_by = p_official_id,
      num_heats = (v_draw->>'num_heats')::INTEGER
  WHERE id = r_rc.id;

  RETURN v_draw || jsonb_build_object('dns', v_dns, 'reported', array_length(v_ids, 1));
END;
$$;

-- Lock everything down like 0039 (service role only)
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON roll_calls, roll_call_entries FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON roll_calls, roll_call_entries FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
    GRANT ALL ON roll_calls, roll_call_entries TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
