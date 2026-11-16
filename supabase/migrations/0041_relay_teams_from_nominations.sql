-- ==============================================================================
-- 0041: Relay teams are built automatically from the athlete-form relay tick-boxes
-- ------------------------------------------------------------------------------
-- The Relay Teams page was removed from the college portal (relays are only ticked on the
-- athlete form). But the heat draw, call room and referee apps work on relay_teams /
-- relay_members — without them a relay event would be drawn with no teams at all.
--
-- From now on every relay nomination (registrations.kind = 'relay') keeps a matching team
-- membership:
--   * divisional 4x100m / 4x400m: the squad's own team; mixed 4x400m: the college's single
--     shared team (owned by whichever squad nominated first).
--   * the athlete takes the next free leg (mixed relay: women legs 1 & 3, men legs 2 & 4),
--     otherwise becomes a reserve. The call room official can still swap reserves in.
--   * removing a nomination removes the membership, and a reserve (of the right gender for
--     the mixed relay) moves up into the freed leg; an empty team is deleted.
-- Existing nominations without a membership are filled in at the end (oldest first).
-- ==============================================================================

CREATE OR REPLACE FUNCTION relay_leg_genders(p_is_mixed BOOLEAN, p_leg INT)
RETURNS TEXT AS $$
  SELECT CASE WHEN NOT p_is_mixed THEN NULL WHEN p_leg IN (1, 3) THEN 'women' ELSE 'men' END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION ensure_relay_membership(p_profile_id UUID, p_event_id UUID)
RETURNS VOID AS $$
DECLARE
  v_squad UUID;
  v_college UUID;
  v_gender TEXT;
  v_is_mixed BOOLEAN;
  v_team UUID;
  v_leg INT;
BEGIN
  SELECT p.squad_id, s.college_id, s.gender INTO v_squad, v_college, v_gender
  FROM profiles p JOIN squads s ON s.id = p.squad_id WHERE p.id = p_profile_id;
  IF v_squad IS NULL THEN RETURN; END IF;

  SELECT upper(code) = '4X400M-MIX' INTO v_is_mixed FROM events WHERE id = p_event_id AND category = 'relay';
  IF v_is_mixed IS NULL THEN RETURN; END IF; -- not a relay event

  -- One team per squad (divisional) / per college (mixed); serialise concurrent nominations
  PERFORM pg_advisory_xact_lock(hashtextextended('relayteam:' || p_event_id::text || ':' ||
    CASE WHEN v_is_mixed THEN v_college::text ELSE v_squad::text END, 0));

  IF v_is_mixed THEN
    SELECT t.id INTO v_team FROM relay_teams t JOIN squads s ON s.id = t.squad_id
    WHERE t.event_id = p_event_id AND s.college_id = v_college LIMIT 1;
  ELSE
    SELECT id INTO v_team FROM relay_teams WHERE event_id = p_event_id AND squad_id = v_squad;
  END IF;
  IF v_team IS NULL THEN
    INSERT INTO relay_teams (squad_id, event_id) VALUES (v_squad, p_event_id) RETURNING id INTO v_team;
  END IF;

  IF EXISTS (SELECT 1 FROM relay_members WHERE relay_team_id = v_team AND profile_id = p_profile_id) THEN
    RETURN;
  END IF;

  SELECT l INTO v_leg FROM generate_series(1, 4) AS l
  WHERE (relay_leg_genders(v_is_mixed, l) IS NULL OR relay_leg_genders(v_is_mixed, l) = v_gender)
    AND NOT EXISTS (SELECT 1 FROM relay_members WHERE relay_team_id = v_team AND leg_order = l)
  ORDER BY l LIMIT 1;

  INSERT INTO relay_members (relay_team_id, profile_id, leg_order, is_reserve)
  VALUES (v_team, p_profile_id, v_leg, v_leg IS NULL);
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION remove_relay_membership(p_profile_id UUID, p_event_id UUID)
RETURNS VOID AS $$
DECLARE
  r_member RECORD;
  v_is_mixed BOOLEAN;
  v_promote UUID;
BEGIN
  SELECT upper(code) = '4X400M-MIX' INTO v_is_mixed FROM events WHERE id = p_event_id;

  FOR r_member IN
    SELECT m.id, m.relay_team_id, m.leg_order
    FROM relay_members m JOIN relay_teams t ON t.id = m.relay_team_id
    WHERE m.profile_id = p_profile_id AND t.event_id = p_event_id
  LOOP
    DELETE FROM relay_members WHERE id = r_member.id;

    IF r_member.leg_order IS NOT NULL THEN
      -- Oldest reserve who may run that leg moves up
      SELECT m.id INTO v_promote
      FROM relay_members m JOIN profiles p ON p.id = m.profile_id JOIN squads s ON s.id = p.squad_id
      WHERE m.relay_team_id = r_member.relay_team_id AND m.is_reserve
        AND (relay_leg_genders(COALESCE(v_is_mixed, FALSE), r_member.leg_order) IS NULL
             OR s.gender = relay_leg_genders(COALESCE(v_is_mixed, FALSE), r_member.leg_order))
      ORDER BY m.created_at, m.id LIMIT 1;
      IF v_promote IS NOT NULL THEN
        UPDATE relay_members SET leg_order = r_member.leg_order, is_reserve = FALSE WHERE id = v_promote;
      END IF;
    END IF;

    -- A team nobody is in any more is removed (it must not appear in heat draws)
    DELETE FROM relay_teams t WHERE t.id = r_member.relay_team_id
      AND NOT EXISTS (SELECT 1 FROM relay_members WHERE relay_team_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM heat_athletes WHERE relay_team_id = t.id);
  END LOOP;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION sync_relay_team_from_registration()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.kind = 'relay' THEN
    PERFORM ensure_relay_membership(NEW.profile_id, NEW.event_id);
  ELSIF TG_OP = 'DELETE' AND OLD.kind = 'relay' THEN
    PERFORM remove_relay_membership(OLD.profile_id, OLD.event_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_relay_team ON registrations;
CREATE TRIGGER trg_sync_relay_team
  AFTER INSERT OR DELETE ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION sync_relay_team_from_registration();

-- Backfill: nominations that are not yet in their team (oldest first, so the first four nominated
-- take legs 1–4)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT reg.profile_id, reg.event_id
    FROM registrations reg
    JOIN profiles p ON p.id = reg.profile_id
    JOIN squads s ON s.id = p.squad_id
    WHERE reg.kind = 'relay'
      AND NOT EXISTS (
        SELECT 1 FROM relay_members m JOIN relay_teams t ON t.id = m.relay_team_id
        JOIN squads ts ON ts.id = t.squad_id
        WHERE m.profile_id = reg.profile_id AND t.event_id = reg.event_id AND ts.college_id = s.college_id
      )
    ORDER BY reg.created_at, reg.id
  LOOP
    PERFORM ensure_relay_membership(r.profile_id, r.event_id);
  END LOOP;
END $$;

-- Server-side only (service role), like every other function since 0036 / 0039
REVOKE EXECUTE ON FUNCTION relay_leg_genders(BOOLEAN, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ensure_relay_membership(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION remove_relay_membership(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_relay_team_from_registration() FROM PUBLIC;
