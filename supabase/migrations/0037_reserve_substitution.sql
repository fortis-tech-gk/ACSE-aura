-- ==============================================================================
-- Migration: 0037_reserve_substitution.sql
-- Description: Call room reserve substitution (plan §7.3, audit #17).
--   When an athlete does not report, the call room official can put in an
--   accredited reserve from the SAME college who registered that event as their
--   reserve event. The reserve takes the absent athlete's lane / order and is
--   marked reported.
--   Allowed only:
--     * for individual events (relays have swap_relay_runner),
--     * in the event's first round (a qualifier for a later round cannot be replaced),
--     * before the call room closes (SCHEDULED / DELAYED / CALL_ROOM),
--     * when the absent athlete has not reported and has no result,
--     * when the reserve is not already drawn in this event.
--   Every swap is logged in call_room_substitutions.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS call_room_substitutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id UUID NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
  heat_athlete_id UUID NOT NULL REFERENCES heat_athletes(id) ON DELETE CASCADE,
  absent_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reserve_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  official_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_call_room_substitutions_heat ON call_room_substitutions (heat_id);
ALTER TABLE call_room_substitutions ENABLE ROW LEVEL SECURITY;

-- Accredited reserves of the absent athlete's college for this entry's event,
-- not already drawn in the event. Used by the call room screen.
CREATE OR REPLACE FUNCTION eligible_reserves_for_entry(p_heat_athlete_id UUID)
RETURNS TABLE (profile_id UUID, sslc_name TEXT, bid_number INTEGER)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.sslc_name, p.bid_number
  FROM heat_athletes ha
  JOIN heats h ON h.id = ha.heat_id
  JOIN profiles absent ON absent.id = ha.profile_id
  JOIN registrations r ON r.event_id = h.event_id AND r.kind = 'reserve'
  JOIN profiles p ON p.id = r.profile_id
  WHERE ha.id = p_heat_athlete_id
    AND p.squad_id = absent.squad_id
    AND p.id <> absent.id
    AND p.accreditation_status = 'ACCREDITED'
    AND NOT EXISTS (
      SELECT 1 FROM heat_athletes x JOIN heats hx ON hx.id = x.heat_id
      WHERE hx.event_id = h.event_id AND x.profile_id = p.id
    )
  ORDER BY p.bid_number NULLS LAST, p.sslc_name
$$;

CREATE OR REPLACE FUNCTION substitute_reserve_in_heat(
  p_heat_athlete_id UUID,
  p_reserve_profile_id UUID,
  p_official_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  r_entry RECORD;
  v_absent_name TEXT;
  v_reserve_name TEXT;
  v_stage_rank INTEGER;
BEGIN
  SELECT ha.id, ha.heat_id, ha.profile_id, ha.lane_number, ha.call_room_reported,
         h.event_id, h.stage, h.status, e.name AS event_name, e.category
  INTO r_entry
  FROM heat_athletes ha
  JOIN heats h ON h.id = ha.heat_id
  JOIN events e ON e.id = h.event_id
  WHERE ha.id = p_heat_athlete_id
  FOR UPDATE OF ha;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry not found in any heat.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('reserve_swap_' || r_entry.event_id::text));

  IF r_entry.profile_id IS NULL THEN
    RAISE EXCEPTION 'Relay teams change runners with the relay swap, not a reserve substitution.';
  END IF;
  IF r_entry.status NOT IN ('SCHEDULED', 'DELAYED', 'CALL_ROOM') THEN
    RAISE EXCEPTION 'The call room for this heat is closed; a reserve can no longer come in.';
  END IF;

  v_stage_rank := CASE r_entry.stage WHEN 'QUALIFYING' THEN 1 WHEN 'HEATS' THEN 1 WHEN 'SEMI_FINAL' THEN 2 ELSE 3 END;
  IF EXISTS (
    SELECT 1 FROM heats WHERE event_id = r_entry.event_id
      AND (CASE stage WHEN 'QUALIFYING' THEN 1 WHEN 'HEATS' THEN 1 WHEN 'SEMI_FINAL' THEN 2 ELSE 3 END) < v_stage_rank
  ) THEN
    RAISE EXCEPTION 'Reserves can come in only in the first round of %; this % was reached by qualifying.',
      r_entry.event_name, lower(replace(r_entry.stage, '_', '-'));
  END IF;

  IF r_entry.call_room_reported THEN
    RAISE EXCEPTION 'This athlete has reported. Mark them DNS or scratched first if they will not run.';
  END IF;
  IF EXISTS (SELECT 1 FROM track_results WHERE heat_athlete_id = p_heat_athlete_id)
     OR EXISTS (SELECT 1 FROM field_attempts WHERE heat_athlete_id = p_heat_athlete_id)
     OR EXISTS (SELECT 1 FROM vertical_jump_attempts WHERE heat_athlete_id = p_heat_athlete_id) THEN
    RAISE EXCEPTION 'This entry already has a result.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM eligible_reserves_for_entry(p_heat_athlete_id) er WHERE er.profile_id = p_reserve_profile_id) THEN
    RAISE EXCEPTION 'That athlete cannot come in: a reserve must be accredited, from the same college, registered for % as their reserve event, and not already in it.',
      r_entry.event_name;
  END IF;

  SELECT sslc_name INTO v_absent_name FROM profiles WHERE id = r_entry.profile_id;
  SELECT sslc_name INTO v_reserve_name FROM profiles WHERE id = p_reserve_profile_id;

  INSERT INTO call_room_substitutions (heat_id, heat_athlete_id, absent_profile_id, reserve_profile_id, official_id)
  VALUES (r_entry.heat_id, p_heat_athlete_id, r_entry.profile_id, p_reserve_profile_id, p_official_id);

  -- The lane now belongs to the reserve, who is standing in the call room
  DELETE FROM call_room_inspections WHERE heat_athlete_id = p_heat_athlete_id;
  UPDATE heat_athletes
  SET profile_id = p_reserve_profile_id,
      seed_mark = '',
      call_room_reported = TRUE,
      call_room_reported_at = timezone('utc'::text, now())
  WHERE id = p_heat_athlete_id;

  RETURN jsonb_build_object(
    'success', true,
    'heat_athlete_id', p_heat_athlete_id,
    'lane', r_entry.lane_number,
    'absent', v_absent_name,
    'reserve', v_reserve_name
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON call_room_substitutions TO service_role;
    GRANT EXECUTE ON FUNCTION eligible_reserves_for_entry(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION substitute_reserve_in_heat(UUID, UUID, UUID) TO service_role;
  END IF;
END $$;
