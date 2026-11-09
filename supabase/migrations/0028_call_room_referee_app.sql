-- ==============================================================================
-- Migration: 0028_call_room_referee_app.sql
-- Description: AURA Officials app — call room and referee screens
--   1. advance_heat_to_track: only athletes who really did not report become DNS.
--      (Before, an athlete marked "reported" without a full kit inspection was turned into
--       DNS when the call room closed, and SCRATCH / DISQUALIFIED were overwritten.)
--   2. swap_relay_runner: the call room official swaps a running leg with a registered
--      reserve (VTU rule: substitutes are changed by the call room official). Mixed relay
--      keeps its W-M-W-M order.
-- ==============================================================================

CREATE OR REPLACE FUNCTION advance_heat_to_track(
  p_heat_id UUID,
  p_official_id UUID
)
RETURNS JSONB AS $$
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

  UPDATE heats SET status = 'ON_TRACK' WHERE id = p_heat_id;

  RETURN jsonb_build_object(
    'success', true,
    'heat_id', p_heat_id,
    'status', 'ON_TRACK',
    'reported_athletes', v_reported_count,
    'dns_athletes', v_dns_count
  );
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION swap_relay_runner(
  p_relay_team_id UUID,
  p_leg_order INTEGER,
  p_reserve_profile_id UUID
)
RETURNS JSONB AS $$
DECLARE
  r_team RECORD;
  r_leg RECORD;
  r_reserve RECORD;
BEGIN
  IF p_leg_order NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Leg must be 1 to 4.';
  END IF;

  SELECT rt.id, e.code AS event_code INTO r_team
  FROM relay_teams rt JOIN events e ON e.id = rt.event_id
  WHERE rt.id = p_relay_team_id
  FOR UPDATE OF rt;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relay team not found.';
  END IF;

  SELECT rm.id, rm.profile_id, s.gender INTO r_leg
  FROM relay_members rm JOIN profiles p ON p.id = rm.profile_id JOIN squads s ON s.id = p.squad_id
  WHERE rm.relay_team_id = p_relay_team_id AND rm.leg_order = p_leg_order AND rm.is_reserve = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No runner is set for leg %.', p_leg_order;
  END IF;

  SELECT rm.id, rm.profile_id, s.gender, p.accreditation_status INTO r_reserve
  FROM relay_members rm JOIN profiles p ON p.id = rm.profile_id JOIN squads s ON s.id = p.squad_id
  WHERE rm.relay_team_id = p_relay_team_id AND rm.profile_id = p_reserve_profile_id AND rm.is_reserve = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a registered reserve of this team can come in.';
  END IF;
  IF r_reserve.accreditation_status = 'WITHDrAWN' THEN
    RAISE EXCEPTION 'This reserve has been withdrawn.';
  END IF;

  -- Mixed 4x400m: legs 1 and 3 women, legs 2 and 4 men
  IF upper(r_team.event_code) = '4X400M-MIX' AND lower(r_reserve.gender) <> lower(r_leg.gender) THEN
    RAISE EXCEPTION 'Mixed relay leg % must be run by a %.', p_leg_order, CASE WHEN p_leg_order IN (1, 3) THEN 'woman' ELSE 'man' END;
  END IF;

  UPDATE relay_members SET is_reserve = TRUE, leg_order = NULL WHERE id = r_leg.id;
  UPDATE relay_members SET is_reserve = FALSE, leg_order = p_leg_order WHERE id = r_reserve.id;

  RETURN jsonb_build_object(
    'success', true,
    'relay_team_id', p_relay_team_id,
    'leg_order', p_leg_order,
    'in_profile_id', r_reserve.profile_id,
    'out_profile_id', r_leg.profile_id
  );
END;
$$ LANGUAGE plpgsql;
