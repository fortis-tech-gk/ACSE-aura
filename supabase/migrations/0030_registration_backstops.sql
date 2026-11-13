-- =============================================================================
-- 0030: Database backstops for the website's registration rules (audit #22, #12)
--
-- The website already enforces all of these; the database now enforces them too, so a race
-- between two requests or any future code path cannot slip through. Only NEW or CHANGED rows
-- are checked; existing data is not modified.
--
--   B4  USN unique across the whole championship (case-insensitive)
--   B5  Aadhaar is exactly 12 digits, and unique across the championship
--   B6  A divisional relay team (men's / women's) only has athletes of its own squad
--   B7  A relay team never has athletes from another college (mixed relay included)
--   +   Event gender matches the athlete's squad (no women's event for a men's athlete)
--   +   Entry kind matches the event: relay ↔ relay events, half_marathon ↔ HM-M / HM-W,
--       regular / reserve only for individual events
--   +   A reserve event differs from the athlete's own regular events and needs at least
--       one regular event (Rule 36)
--   +   Two runners cannot share a leg in one relay team
--   #12 The 'payment-proofs' storage bucket is private (signed links only)
--
-- Deliberately NOT enforced here:
--   B1  "no reserve with two events" — the meet now ALLOWS 1 reserve even with 2 events.
--   B3  "no entries on a locked roster" — Directorate withdrawals / substitutions and
--       late-entry windows legitimately change locked rosters; the website guards this.
--
-- The USN / Aadhaar uniqueness indexes are skipped (with a NOTICE listing the duplicates)
-- if the live data already contains duplicates; resolve them and re-run. Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- #12 Private payment-proofs bucket
-- -----------------------------------------------------------------------------
UPDATE storage.buckets SET public = FALSE WHERE id = 'payment-proofs';

-- -----------------------------------------------------------------------------
-- B5 Aadhaar format (new / changed rows only)
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_aadhaar_format_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_aadhaar_format_check
  CHECK (aadhaar_number IS NULL OR aadhaar_number ~ '^[0-9]{12}$') NOT VALID;

-- -----------------------------------------------------------------------------
-- B4 / B5 Championship-wide uniqueness (skipped with a report if duplicates exist)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_dups TEXT;
BEGIN
  SELECT string_agg(usn_key || ' ×' || n, ', ') INTO v_dups
  FROM (SELECT upper(usn) AS usn_key, count(*) AS n FROM public.profiles GROUP BY 1 HAVING count(*) > 1) d;
  IF v_dups IS NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_usn_championship ON public.profiles (upper(usn));
  ELSE
    RAISE NOTICE 'USN uniqueness NOT enforced yet — duplicate USNs exist: %', v_dups;
  END IF;

  SELECT string_agg(right(aadhaar_number, 4) || ' ×' || n, ', ') INTO v_dups
  FROM (SELECT aadhaar_number, count(*) AS n FROM public.profiles
        WHERE aadhaar_number IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
  IF v_dups IS NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_aadhaar_championship
      ON public.profiles (aadhaar_number) WHERE aadhaar_number IS NOT NULL;
  ELSE
    RAISE NOTICE 'Aadhaar uniqueness NOT enforced yet — duplicate Aadhaar numbers exist (last 4 digits): %', v_dups;
  END IF;

  -- One runner per leg in a relay team
  IF NOT EXISTS (
    SELECT 1 FROM public.relay_members WHERE leg_order IS NOT NULL
    GROUP BY relay_team_id, leg_order HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_relay_members_team_leg
      ON public.relay_members (relay_team_id, leg_order) WHERE leg_order IS NOT NULL;
  ELSE
    RAISE NOTICE 'One-runner-per-leg NOT enforced yet — a relay team has two runners on the same leg.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Registrations: event gender / entry kind (checked per row)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_registration_event_match()
RETURNS TRIGGER AS $$
DECLARE
  v_squad_gender TEXT;
  v_event RECORD;
  v_is_hm BOOLEAN;
BEGIN
  SELECT s.gender INTO v_squad_gender
  FROM profiles p JOIN squads s ON s.id = p.squad_id
  WHERE p.id = NEW.profile_id;

  SELECT code, gender, category INTO v_event FROM events WHERE id = NEW.event_id;
  IF NOT FOUND THEN
    RETURN NEW; -- FK will reject it
  END IF;
  v_is_hm := upper(v_event.code) IN ('HM-M', 'HM-W');

  IF v_event.gender IN ('men', 'women') AND v_event.gender IS DISTINCT FROM v_squad_gender THEN
    RAISE EXCEPTION 'Event % is for % — this athlete is in the % squad.', v_event.code, v_event.gender, v_squad_gender
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.kind = 'relay' AND v_event.category <> 'relay' THEN
    RAISE EXCEPTION 'Only relay events can be entered as a relay (got %).', v_event.code USING ERRCODE = 'check_violation';
  ELSIF NEW.kind = 'half_marathon' AND NOT v_is_hm THEN
    RAISE EXCEPTION 'Only HM-M / HM-W can be entered as the half marathon (got %).', v_event.code USING ERRCODE = 'check_violation';
  ELSIF NEW.kind IN ('regular', 'reserve') AND (v_event.category = 'relay' OR v_is_hm) THEN
    RAISE EXCEPTION 'Relays and the half marathon cannot be entered as a regular or reserve event (got %).', v_event.code
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_registration_event_match ON registrations;
CREATE TRIGGER trg_registration_event_match
  BEFORE INSERT OR UPDATE OF event_id, kind, profile_id ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_registration_event_match();

-- -----------------------------------------------------------------------------
-- Reserve rules — checked at the END of the statement/transaction (deferred), because the
-- website inserts an athlete's regular and reserve entries together.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_reserve_rules()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.kind <> 'reserve' THEN
    RETURN NULL;
  END IF;
  -- Row may have been deleted again within the same transaction
  IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = NEW.id) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM registrations r
    WHERE r.profile_id = NEW.profile_id AND r.kind = 'regular' AND r.event_id = NEW.event_id
  ) THEN
    RAISE EXCEPTION 'The reserve event must be different from the athlete''s own events.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM registrations r WHERE r.profile_id = NEW.profile_id AND r.kind = 'regular'
  ) THEN
    RAISE EXCEPTION 'A reserve event needs at least one regular event (Rule 36).' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reserve_rules ON registrations;
CREATE CONSTRAINT TRIGGER trg_reserve_rules
  AFTER INSERT OR UPDATE OF event_id, kind, profile_id ON registrations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION enforce_reserve_rules();

-- -----------------------------------------------------------------------------
-- B6 / B7 Relay team membership
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_relay_member_squad()
RETURNS TRIGGER AS $$
DECLARE
  v_team_squad UUID;
  v_team_college UUID;
  v_is_mixed BOOLEAN;
  v_member_squad UUID;
  v_member_college UUID;
BEGIN
  SELECT t.squad_id, s.college_id, (upper(e.code) = '4X400M-MIX')
    INTO v_team_squad, v_team_college, v_is_mixed
  FROM relay_teams t
  JOIN squads s ON s.id = t.squad_id
  JOIN events e ON e.id = t.event_id
  WHERE t.id = NEW.relay_team_id;

  SELECT p.squad_id, s.college_id INTO v_member_squad, v_member_college
  FROM profiles p JOIN squads s ON s.id = p.squad_id
  WHERE p.id = NEW.profile_id;

  IF v_member_college IS DISTINCT FROM v_team_college THEN
    RAISE EXCEPTION 'A relay team can only include athletes from its own college.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_is_mixed AND v_member_squad IS DISTINCT FROM v_team_squad THEN
    RAISE EXCEPTION 'A men''s / women''s relay team can only include athletes of that squad.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_relay_member_squad ON relay_members;
CREATE TRIGGER trg_relay_member_squad
  BEFORE INSERT OR UPDATE OF relay_team_id, profile_id ON relay_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_relay_member_squad();

COMMIT;

NOTIFY pgrst, 'reload schema';
