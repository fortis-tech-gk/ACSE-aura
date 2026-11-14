-- =============================================================================
-- 0031: Database backstops for entry quotas and the shared Mixed Relay team
--
-- The website checks these before saving, but two tabs / two people saving at the same moment
-- could both pass that check. These triggers serialise the check per squad (or college) + event
-- with a transaction-scoped advisory lock, so the limit can never be exceeded.
--
--   Q1  At most 2 athletes of a squad in any one individual event (regular entries)
--   Q2  At most 6 athletes of a squad nominated for a men's / women's relay
--   Q3  At most 6 athletes of a college nominated for the 4x400m Mixed Relay
--   M1  Only ONE 4x400m Mixed Relay team per college (it is shared by the Men's and Women's squads)
--
-- Only new / changed rows are checked; existing data is not modified. Safe to re-run.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION enforce_registration_quotas()
RETURNS TRIGGER AS $$
DECLARE
  v_squad UUID;
  v_college UUID;
  v_event RECORD;
  v_is_mixed BOOLEAN;
  v_count INT;
BEGIN
  IF NEW.kind NOT IN ('regular', 'relay') THEN
    RETURN NEW;
  END IF;

  SELECT p.squad_id, s.college_id INTO v_squad, v_college
  FROM profiles p JOIN squads s ON s.id = p.squad_id
  WHERE p.id = NEW.profile_id;

  SELECT code, name, category INTO v_event FROM events WHERE id = NEW.event_id;
  IF NOT FOUND OR v_squad IS NULL THEN
    RETURN NEW; -- foreign keys reject it
  END IF;
  v_is_mixed := upper(v_event.code) = '4X400M-MIX';

  IF NEW.kind = 'regular' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('quota:' || v_squad::text || ':' || NEW.event_id::text, 0));
    SELECT count(*) INTO v_count
    FROM registrations r JOIN profiles p ON p.id = r.profile_id
    WHERE p.squad_id = v_squad AND r.event_id = NEW.event_id AND r.kind = 'regular'
      AND r.id IS DISTINCT FROM NEW.id;
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'VTU Quota Exceeded: your college already has the maximum of 2 athletes in %.', v_event.name
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF v_is_mixed THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('quota:' || v_college::text || ':' || NEW.event_id::text, 0));
    SELECT count(*) INTO v_count
    FROM registrations r JOIN profiles p ON p.id = r.profile_id JOIN squads s ON s.id = p.squad_id
    WHERE s.college_id = v_college AND r.event_id = NEW.event_id AND r.kind = 'relay'
      AND r.id IS DISTINCT FROM NEW.id;
    IF v_count >= 6 THEN
      RAISE EXCEPTION 'Your college already has the maximum of 6 nominations for the 4x400m Mixed Relay (4 runners + 2 reserves).'
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF v_event.category = 'relay' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('quota:' || v_squad::text || ':' || NEW.event_id::text, 0));
    SELECT count(*) INTO v_count
    FROM registrations r JOIN profiles p ON p.id = r.profile_id
    WHERE p.squad_id = v_squad AND r.event_id = NEW.event_id AND r.kind = 'relay'
      AND r.id IS DISTINCT FROM NEW.id;
    IF v_count >= 6 THEN
      RAISE EXCEPTION 'Your squad already has the maximum of 6 athletes for the % (4 runners + 2 reserves).', v_event.name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_registration_quotas ON registrations;
CREATE TRIGGER trg_registration_quotas
  BEFORE INSERT OR UPDATE OF event_id, kind, profile_id ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_registration_quotas();

-- -----------------------------------------------------------------------------
-- M1 One Mixed Relay team per college
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_one_mixed_team_per_college()
RETURNS TRIGGER AS $$
DECLARE
  v_college UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND upper(code) = '4X400M-MIX') THEN
    RETURN NEW;
  END IF;
  SELECT college_id INTO v_college FROM squads WHERE id = NEW.squad_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('mixedteam:' || v_college::text, 0));
  IF EXISTS (
    SELECT 1 FROM relay_teams t JOIN squads s ON s.id = t.squad_id
    WHERE t.event_id = NEW.event_id AND s.college_id = v_college AND t.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'This college already has a 4x400m Mixed Relay team.' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_one_mixed_team_per_college ON relay_teams;
CREATE TRIGGER trg_one_mixed_team_per_college
  BEFORE INSERT OR UPDATE OF squad_id, event_id ON relay_teams
  FOR EACH ROW
  EXECUTE FUNCTION enforce_one_mixed_team_per_college();

-- Report (do not change) colleges that already have two Mixed teams, so the admin can merge them
DO $$
DECLARE v_list TEXT;
BEGIN
  SELECT string_agg(c.code, ', ') INTO v_list FROM (
    SELECT s.college_id FROM relay_teams t
    JOIN squads s ON s.id = t.squad_id JOIN events e ON e.id = t.event_id
    WHERE upper(e.code) = '4X400M-MIX'
    GROUP BY s.college_id HAVING count(*) > 1
  ) d JOIN colleges c ON c.id = d.college_id;
  IF v_list IS NOT NULL THEN
    RAISE NOTICE 'Colleges with more than one Mixed Relay team (merge by hand): %', v_list;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
