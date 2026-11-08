-- =============================================================================
-- 0026: Database guard — an athlete may be in only ONE divisional relay
--
-- VTU Rule 3 / 24: an athlete can run either the 4x100m OR the 4x400m relay of their
-- division (men's / women's), never both. The 4x400m Mixed Relay is separate and allowed
-- in addition. The app already enforces this on the athlete form and the Relay page; these
-- triggers make it impossible at the database level too, whichever way a row is written:
--   * registrations  (kind = 'relay', nominations from the athlete form)
--   * relay_members  (legs / reserves picked on the Relay page)
--
-- Only new or changed rows are checked; existing data is not modified. Safe to re-run.
-- =============================================================================

BEGIN;

-- Divisional relay family of an event code: '100' for 4X100M-M/W, '400' for 4X400M-M/W, NULL otherwise
CREATE OR REPLACE FUNCTION divisional_relay_family(p_code TEXT)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN upper(p_code) IN ('4X100M-M', '4X100M-W') THEN '100'
    WHEN upper(p_code) IN ('4X400M-M', '4X400M-W') THEN '400'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Divisional relay families an athlete is already in (from nominations and team lineups),
-- ignoring the row being written
CREATE OR REPLACE FUNCTION athlete_divisional_relay_families(
  p_profile_id UUID,
  p_ignore_registration UUID DEFAULT NULL,
  p_ignore_member UUID DEFAULT NULL
)
RETURNS SETOF TEXT AS $$
  SELECT DISTINCT fam FROM (
    SELECT divisional_relay_family(e.code) AS fam
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    WHERE r.profile_id = p_profile_id
      AND r.kind = 'relay'
      AND (p_ignore_registration IS NULL OR r.id <> p_ignore_registration)
    UNION ALL
    SELECT divisional_relay_family(e.code)
    FROM relay_members m
    JOIN relay_teams t ON t.id = m.relay_team_id
    JOIN events e ON e.id = t.event_id
    WHERE m.profile_id = p_profile_id
      AND (p_ignore_member IS NULL OR m.id <> p_ignore_member)
  ) x
  WHERE fam IS NOT NULL;
$$ LANGUAGE sql STABLE;

-- registrations: relay nominations
CREATE OR REPLACE FUNCTION enforce_one_divisional_relay_registration()
RETURNS TRIGGER AS $$
DECLARE
  v_family TEXT;
BEGIN
  IF NEW.kind <> 'relay' THEN
    RETURN NEW;
  END IF;
  SELECT divisional_relay_family(code) INTO v_family FROM events WHERE id = NEW.event_id;
  IF v_family IS NULL THEN
    RETURN NEW; -- mixed relay or non-relay: no restriction here
  END IF;
  IF EXISTS (
    SELECT 1 FROM athlete_divisional_relay_families(NEW.profile_id, NEW.id, NULL) f WHERE f <> v_family
  ) THEN
    RAISE EXCEPTION 'An athlete can participate in only one divisional relay (either 4x100m or 4x400m), not both.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_one_divisional_relay_registration ON registrations;
CREATE TRIGGER trg_one_divisional_relay_registration
  BEFORE INSERT OR UPDATE OF event_id, kind, profile_id ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_one_divisional_relay_registration();

-- relay_members: legs / reserves on the Relay page
CREATE OR REPLACE FUNCTION enforce_one_divisional_relay_member()
RETURNS TRIGGER AS $$
DECLARE
  v_family TEXT;
BEGIN
  SELECT divisional_relay_family(e.code) INTO v_family
  FROM relay_teams t JOIN events e ON e.id = t.event_id
  WHERE t.id = NEW.relay_team_id;
  IF v_family IS NULL THEN
    RETURN NEW; -- mixed relay team: no restriction here
  END IF;
  IF EXISTS (
    SELECT 1 FROM athlete_divisional_relay_families(NEW.profile_id, NULL, NEW.id) f WHERE f <> v_family
  ) THEN
    RAISE EXCEPTION 'An athlete can participate in only one divisional relay (either 4x100m or 4x400m), not both.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_one_divisional_relay_member ON relay_members;
CREATE TRIGGER trg_one_divisional_relay_member
  BEFORE INSERT OR UPDATE OF relay_team_id, profile_id ON relay_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_one_divisional_relay_member();

COMMIT;

-- Read-only report: athletes who are ALREADY in both divisional relays (should be none).
SELECT p.sslc_name, p.usn, array_agg(DISTINCT f) AS relays
FROM profiles p
CROSS JOIN LATERAL athlete_divisional_relay_families(p.id) f
GROUP BY p.id, p.sslc_name, p.usn
HAVING count(DISTINCT f) > 1;
