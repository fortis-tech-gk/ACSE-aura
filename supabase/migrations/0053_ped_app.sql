-- ==============================================================================
-- 0053: College PED in the athletes app
-- ------------------------------------------------------------------------------
-- A PED signs in to the AURA Athletes app once for the whole college (Men + Women) and can:
--   * swap a reserve into an individual event in place of one of the college's athletes,
--   * choose the 4 running members (and their legs) of each relay team,
-- both until 22:00 IST on the day before the event's first round. They also get push
-- notifications about athletes who have not reported to the call room and about results.
--
--   1. device_push_tokens.college_id  — a PED's phone is registered for a college
--   2. ped_alerts_sent                — each PED alert is sent once (30/20/10 min, closed, result);
--                                       keyed by 'heat:<id>' or 'rc:<event>:<stage>' (roll call)
--   3. ped_change_log                 — every PED change is recorded
--   4. ped_change_deadline(event)     — 22:00 IST the day before the event's first session
--   5. ped_swap_reserve(...)          — reserve in, athlete out (optionally reserve gives up an event)
--   6. ped_set_relay_runners(...)     — the 4 runners of a relay team in leg order
-- Safe to re-run.
-- ==============================================================================

BEGIN;

-- 1. Push tokens for PED phones ----------------------------------------------------------
ALTER TABLE public.device_push_tokens
  ADD COLUMN IF NOT EXISTS college_id UUID REFERENCES public.colleges(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_push_tokens_college ON public.device_push_tokens (college_id);

-- 2. Alerts already sent -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ped_alerts_sent (
  alert_key TEXT NOT NULL, -- 'heat:<heat id>' or 'rc:<event id>:<stage>' (first-round roll call)
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- 'T30' | 'T20' | 'T10' | 'CLOSED' | 'RESULT'
  sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (alert_key, college_id, kind)
);
ALTER TABLE public.ped_alerts_sent ENABLE ROW LEVEL SECURITY;

-- 3. Change log ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ped_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('RESERVE_SWAP', 'RELAY_RUNNERS')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_ped_change_log_college ON public.ped_change_log (college_id, created_at DESC);
ALTER TABLE public.ped_change_log ENABLE ROW LEVEL SECURITY;

-- 4. Deadline ------------------------------------------------------------------------------
-- 22:00 India time on the day before the event's first scheduled session. NULL when the event
-- is not on the schedule yet (changes stay open).
CREATE OR REPLACE FUNCTION public.ped_change_deadline(p_event_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT ((min(ss.session_date) - 1)::timestamp + time '22:00') AT TIME ZONE 'Asia/Kolkata'
  FROM schedule_items si JOIN schedule_sessions ss ON ss.id = si.session_id
  WHERE si.event_id = p_event_id
$$;

-- The call room has started work on the event: its roll call is open (the roll call copies the
-- entry list when it opens) or a heat has left SCHEDULED
CREATE OR REPLACE FUNCTION public.ped_event_started(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM roll_calls WHERE event_id = p_event_id)
      OR EXISTS (SELECT 1 FROM heats WHERE event_id = p_event_id AND status NOT IN ('SCHEDULED', 'DELAYED'))
$$;

CREATE OR REPLACE FUNCTION public.ped_assert_before_deadline(p_event_id UUID, p_event_name TEXT)
RETURNS VOID
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_deadline TIMESTAMPTZ := ped_change_deadline(p_event_id);
BEGIN
  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'Changes for % closed at 10 PM on %.', p_event_name,
      to_char(v_deadline AT TIME ZONE 'Asia/Kolkata', 'DD Mon');
  END IF;
  IF ped_event_started(p_event_id) THEN
    RAISE EXCEPTION '% has already started at the call room; changes are closed.', p_event_name;
  END IF;
END;
$$;

-- An entry in a drawn heat that has any result recorded
CREATE OR REPLACE FUNCTION public.ped_entry_has_result(p_heat_athlete_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM track_results WHERE heat_athlete_id = p_heat_athlete_id)
      OR EXISTS (SELECT 1 FROM field_attempts WHERE heat_athlete_id = p_heat_athlete_id)
      OR EXISTS (SELECT 1 FROM vertical_jump_attempts WHERE heat_athlete_id = p_heat_athlete_id)
      OR EXISTS (SELECT 1 FROM combined_results WHERE heat_athlete_id = p_heat_athlete_id)
$$;

-- 5. Reserve swap --------------------------------------------------------------------------
-- The reserve takes the outgoing athlete's place in the event (and their lane, if heats are
-- drawn). The outgoing athlete leaves that event only. A reserve who already has 2 individual
-- events must give one of them up (p_give_up_event_id) — at most 2 individual events each.
-- If the outgoing athlete is left with no individual event, their own reserve nomination is
-- removed too (Rule 36: a reserve needs at least one regular event).
CREATE OR REPLACE FUNCTION public.ped_swap_reserve(
  p_college_id UUID,
  p_event_id UUID,
  p_out_profile_id UUID,
  p_reserve_profile_id UUID,
  p_give_up_event_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r_event RECORD;
  r_out RECORD;
  r_res RECORD;
  r_give RECORD;
  v_regulars INT;
  v_ha RECORD;
  v_lane INT;
  v_gave_up TEXT := NULL;
  v_dropped_reserve TEXT := NULL;
  v_dropped_event UUID := NULL;
BEGIN
  SELECT id, name, code, category INTO r_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  IF r_event.category = 'relay' OR upper(r_event.code) IN ('HM-M', 'HM-W') THEN
    RAISE EXCEPTION 'Reserve swaps are for individual events only. For relays choose the 4 runners instead.';
  END IF;

  SELECT p.id, p.sslc_name, p.squad_id, p.accreditation_status, s.college_id INTO r_out
  FROM profiles p JOIN squads s ON s.id = p.squad_id WHERE p.id = p_out_profile_id;
  SELECT p.id, p.sslc_name, p.squad_id, p.accreditation_status, s.college_id INTO r_res
  FROM profiles p JOIN squads s ON s.id = p.squad_id WHERE p.id = p_reserve_profile_id;
  IF r_out.id IS NULL OR r_res.id IS NULL OR r_out.college_id <> p_college_id OR r_res.college_id <> p_college_id THEN
    RAISE EXCEPTION 'Both athletes must be from your college.';
  END IF;
  IF r_out.squad_id <> r_res.squad_id THEN
    RAISE EXCEPTION 'The reserve must be in the same squad (Men / Women) as the athlete going out.';
  END IF;
  IF r_res.accreditation_status = 'WITHDrAWN' THEN
    RAISE EXCEPTION '% has been withdrawn and cannot come in.', r_res.sslc_name;
  END IF;

  -- One change at a time per squad
  PERFORM pg_advisory_xact_lock(hashtextextended('pedswap:' || r_out.squad_id::text, 0));

  PERFORM ped_assert_before_deadline(p_event_id, r_event.name);

  IF NOT EXISTS (SELECT 1 FROM registrations WHERE profile_id = p_out_profile_id AND event_id = p_event_id AND kind = 'regular') THEN
    RAISE EXCEPTION '% is not entered in %.', r_out.sslc_name, r_event.name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registrations WHERE profile_id = p_reserve_profile_id AND event_id = p_event_id AND kind = 'reserve') THEN
    RAISE EXCEPTION '% is not the reserve for %.', r_res.sslc_name, r_event.name;
  END IF;

  -- A later round already drawn means athletes have qualified; nobody can be swapped in then
  IF EXISTS (SELECT 1 FROM heats WHERE event_id = p_event_id AND stage IN ('SEMI_FINAL', 'FINAL'))
     AND EXISTS (SELECT 1 FROM heats WHERE event_id = p_event_id AND stage IN ('HEATS', 'QUALIFYING')) THEN
    RAISE EXCEPTION '% has moved past its first round.', r_event.name;
  END IF;

  -- Two-event cap for the reserve
  SELECT count(*) INTO v_regulars FROM registrations WHERE profile_id = p_reserve_profile_id AND kind = 'regular';
  IF v_regulars >= 2 THEN
    IF p_give_up_event_id IS NULL THEN
      RAISE EXCEPTION '% already has 2 individual events. Choose one to give up.', r_res.sslc_name
        USING ERRCODE = 'P0001', HINT = 'GIVE_UP_REQUIRED';
    END IF;
    SELECT e.id, e.name INTO r_give
    FROM registrations r JOIN events e ON e.id = r.event_id
    WHERE r.profile_id = p_reserve_profile_id AND r.event_id = p_give_up_event_id AND r.kind = 'regular';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The event to give up must be one of %''s own events.', r_res.sslc_name;
    END IF;
    PERFORM ped_assert_before_deadline(r_give.id, r_give.name);
    -- Out of the given-up event's drawn heat (the lane stays empty)
    FOR v_ha IN
      SELECT ha.id FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id
      WHERE h.event_id = r_give.id AND ha.profile_id = p_reserve_profile_id
    LOOP
      IF ped_entry_has_result(v_ha.id) THEN
        RAISE EXCEPTION '% already has a result in %.', r_res.sslc_name, r_give.name;
      END IF;
      DELETE FROM call_room_inspections WHERE heat_athlete_id = v_ha.id;
      DELETE FROM heat_athletes WHERE id = v_ha.id;
    END LOOP;
    DELETE FROM registrations WHERE profile_id = p_reserve_profile_id AND event_id = r_give.id AND kind = 'regular';
    v_gave_up := r_give.name;
  ELSIF p_give_up_event_id IS NOT NULL THEN
    RAISE EXCEPTION '% has fewer than 2 events and does not need to give one up.', r_res.sslc_name;
  END IF;

  -- Drawn heat: the reserve takes the outgoing athlete's lane / order
  FOR v_ha IN
    SELECT ha.id, ha.lane_number FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id
    WHERE h.event_id = p_event_id AND ha.profile_id = p_out_profile_id
  LOOP
    IF ped_entry_has_result(v_ha.id) THEN
      RAISE EXCEPTION '% already has a result in %.', r_out.sslc_name, r_event.name;
    END IF;
    DELETE FROM call_room_inspections WHERE heat_athlete_id = v_ha.id;
    UPDATE heat_athletes
    SET profile_id = p_reserve_profile_id, seed_mark = '', call_room_reported = FALSE, call_room_reported_at = NULL
    WHERE id = v_ha.id;
    v_lane := v_ha.lane_number;
  END LOOP;

  -- Registrations: out first (frees the college slot), then the reserve becomes a regular entry
  DELETE FROM registrations WHERE profile_id = p_out_profile_id AND event_id = p_event_id AND kind = 'regular';
  UPDATE registrations SET kind = 'regular' WHERE profile_id = p_reserve_profile_id AND event_id = p_event_id AND kind = 'reserve';

  -- Rule 36 for the outgoing athlete (an event the call room has already started is left alone)
  IF NOT EXISTS (SELECT 1 FROM registrations WHERE profile_id = p_out_profile_id AND kind = 'regular') THEN
    SELECT e.name, e.id INTO v_dropped_reserve, v_dropped_event
    FROM registrations r JOIN events e ON e.id = r.event_id
    WHERE r.profile_id = p_out_profile_id AND r.kind = 'reserve';
    IF v_dropped_reserve IS NOT NULL AND NOT ped_event_started(v_dropped_event) THEN
      DELETE FROM registrations WHERE profile_id = p_out_profile_id AND kind = 'reserve';
    ELSE
      v_dropped_reserve := NULL;
    END IF;
  END IF;

  INSERT INTO ped_change_log (college_id, event_id, kind, details)
  VALUES (p_college_id, p_event_id, 'RESERVE_SWAP', jsonb_build_object(
    'out_profile_id', p_out_profile_id, 'out_name', r_out.sslc_name,
    'in_profile_id', p_reserve_profile_id, 'in_name', r_res.sslc_name,
    'gave_up_event_id', p_give_up_event_id, 'gave_up_event', v_gave_up,
    'dropped_reserve_event', v_dropped_reserve, 'lane', v_lane));

  RETURN jsonb_build_object(
    'success', true,
    'event', r_event.name,
    'out', r_out.sslc_name,
    'in', r_res.sslc_name,
    'lane', v_lane,
    'gaveUp', v_gave_up,
    'droppedReserve', v_dropped_reserve
  );
END;
$$;

-- 6. Relay runners -------------------------------------------------------------------------
-- p_runner_ids: exactly 4 team members, in leg order 1..4. Everyone else on the team becomes a
-- reserve (the call room can still swap a reserve in on the day). Mixed relay: legs 1 & 3
-- women, legs 2 & 4 men.
CREATE OR REPLACE FUNCTION public.ped_set_relay_runners(
  p_college_id UUID,
  p_relay_team_id UUID,
  p_runner_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r_team RECORD;
  v_is_mixed BOOLEAN;
  v_leg INT;
  v_pid UUID;
  v_gender TEXT;
  v_status TEXT;
  v_members INT;
BEGIN
  SELECT t.id, t.event_id, e.name AS event_name, e.code, s.college_id INTO r_team
  FROM relay_teams t JOIN events e ON e.id = t.event_id JOIN squads s ON s.id = t.squad_id
  WHERE t.id = p_relay_team_id
  FOR UPDATE OF t;
  IF NOT FOUND OR r_team.college_id <> p_college_id THEN
    RAISE EXCEPTION 'Relay team not found for your college.';
  END IF;
  v_is_mixed := upper(r_team.code) = '4X400M-MIX';

  PERFORM ped_assert_before_deadline(r_team.event_id, r_team.event_name);

  IF p_runner_ids IS NULL OR array_length(p_runner_ids, 1) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Choose exactly 4 runners.';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_runner_ids) x) <> 4 THEN
    RAISE EXCEPTION 'The same athlete cannot run two legs.';
  END IF;
  SELECT count(*) INTO v_members FROM relay_members WHERE relay_team_id = p_relay_team_id;
  IF v_members < 4 THEN
    RAISE EXCEPTION 'This team has only % nominated athletes; it needs at least 4.', v_members;
  END IF;

  FOR v_leg IN 1..4 LOOP
    v_pid := p_runner_ids[v_leg];
    SELECT s.gender, p.accreditation_status INTO v_gender, v_status
    FROM relay_members m JOIN profiles p ON p.id = m.profile_id JOIN squads s ON s.id = p.squad_id
    WHERE m.relay_team_id = p_relay_team_id AND m.profile_id = v_pid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Every runner must be nominated for this relay.';
    END IF;
    IF v_status = 'WITHDrAWN' THEN
      RAISE EXCEPTION 'A withdrawn athlete cannot run.';
    END IF;
    IF v_is_mixed AND v_gender IS DISTINCT FROM relay_leg_genders(TRUE, v_leg) THEN
      RAISE EXCEPTION 'Mixed relay leg % must be run by a %.', v_leg, CASE WHEN v_leg IN (1, 3) THEN 'woman' ELSE 'man' END;
    END IF;
  END LOOP;

  -- Re-arrange: everyone to reserve, then the 4 runners onto their legs (the composition check
  -- would see 6 reserves in between; the end state is 4 runners + at most 2 reserves)
  PERFORM set_config('aura.relay_swap', 'on', true);
  UPDATE relay_members SET is_reserve = TRUE, leg_order = NULL WHERE relay_team_id = p_relay_team_id;
  FOR v_leg IN 1..4 LOOP
    UPDATE relay_members SET is_reserve = FALSE, leg_order = v_leg
    WHERE relay_team_id = p_relay_team_id AND profile_id = p_runner_ids[v_leg];
  END LOOP;
  PERFORM set_config('aura.relay_swap', 'off', true);

  INSERT INTO ped_change_log (college_id, event_id, kind, details)
  VALUES (p_college_id, r_team.event_id, 'RELAY_RUNNERS', jsonb_build_object(
    'relay_team_id', p_relay_team_id, 'runners', to_jsonb(p_runner_ids)));

  RETURN jsonb_build_object('success', true, 'event', r_team.event_name, 'relayTeamId', p_relay_team_id);
END;
$$;

-- Server-side only (service role), like every other function since 0036 / 0039
REVOKE EXECUTE ON FUNCTION public.ped_change_deadline(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ped_event_started(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ped_assert_before_deadline(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ped_entry_has_result(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ped_swap_reserve(UUID, UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ped_set_relay_runners(UUID, UUID, UUID[]) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.ped_alerts_sent, public.ped_change_log TO service_role;
    GRANT EXECUTE ON FUNCTION public.ped_change_deadline(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ped_event_started(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ped_assert_before_deadline(UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ped_entry_has_result(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ped_swap_reserve(UUID, UUID, UUID, UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.ped_set_relay_runners(UUID, UUID, UUID[]) TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
