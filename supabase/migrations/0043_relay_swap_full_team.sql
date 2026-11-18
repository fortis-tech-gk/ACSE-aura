-- =============================================================================
-- 0043: Call-room relay swap failed for a team with its full 4 runners + 2 reserves
--       ("A relay team cannot have more than 2 reserve runners").
--       swap_relay_runner() first turns the outgoing runner into a reserve, which the composition
--       trigger rejected when the team already had 2 reserves. The swap now flags itself
--       (transaction-local) so the trigger lets the in/out exchange through; the end state is unchanged.
-- Found in the 2026-11-17 full-meet staging rehearsal. Safe to re-run.
-- =============================================================================
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

CREATE OR REPLACE FUNCTION public.swap_relay_runner(p_relay_team_id uuid, p_leg_order integer, p_reserve_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_team RECORD;
  r_leg RECORD;
  r_reserve RECORD;
BEGIN
  -- The swap moves one runner out and one in; between the two UPDATEs the team briefly has 3 reserves.
  -- Tell the composition check this is a swap (transaction-local) so a full 4 + 2 team can be substituted.
  PERFORM set_config('aura.relay_swap', 'on', true);
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
$function$;

NOTIFY pgrst, 'reload schema';
