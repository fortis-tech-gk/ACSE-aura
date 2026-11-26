-- =============================================================================
-- 0054: College check-in replaces per-athlete accreditation (26-11-2026)
--
-- The accreditation desk no longer scans every athlete. Scanning ANY one athlete's
-- QR (or typing one bib) checks in the whole COLLEGE:
--   * colleges.attendance_marked_at / _by are set (the college is "present");
--   * every athlete of both squads whose fee is VERIFIED becomes ACCREDITED, so the
--     heat draw, roll call, call room, meals and reserve swaps keep working unchanged.
-- The real attendance is the roll call / call room: college_participation() counts
-- who actually reported, per college and gender (same rule as the Certificate of
-- Participation: reported at least once, own heat or relay team).
--
-- Athletes added or reinstated after their college checked in are accredited by a
-- trigger, so nobody has to be scanned separately.
--
-- The manual men/women counts typed at the old Registration Desk are no longer used.
-- Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Check in a college (used by the app scan and by the website fallback)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_in_college(p_college_id UUID, p_marked_by TEXT)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  r_college RECORD;
  v_already BOOLEAN;
  v_new INTEGER := 0;
  v_men INTEGER;
  v_women INTEGER;
BEGIN
  SELECT id, name, code, attendance_marked_at INTO r_college
  FROM colleges WHERE id = p_college_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'College not found.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM squads WHERE college_id = p_college_id AND payment_status = 'VERIFIED') THEN
    RAISE EXCEPTION 'Fees for % are not verified yet. Send the team manager to the finance desk.', r_college.code;
  END IF;

  v_already := r_college.attendance_marked_at IS NOT NULL;

  UPDATE colleges
  SET attendance_marked_at = COALESCE(attendance_marked_at, timezone('utc'::text, now())),
      attendance_marked_by = COALESCE(attendance_marked_by, NULLIF(p_marked_by, ''))
  WHERE id = p_college_id;

  -- Athletes who joined after an earlier check-in are picked up by a second scan too
  WITH upd AS (
    UPDATE profiles p
    SET accreditation_status = 'ACCREDITED',
        accredited_at = COALESCE(p.accredited_at, timezone('utc'::text, now())),
        updated_at = timezone('utc'::text, now())
    FROM squads s
    WHERE s.id = p.squad_id
      AND s.college_id = p_college_id
      AND s.payment_status = 'VERIFIED'
      AND p.accreditation_status = 'REGISTERED'
    RETURNING p.id
  )
  SELECT count(*) INTO v_new FROM upd;

  SELECT count(*) FILTER (WHERE s.gender = 'men'), count(*) FILTER (WHERE s.gender = 'women')
  INTO v_men, v_women
  FROM profiles p JOIN squads s ON s.id = p.squad_id
  WHERE s.college_id = p_college_id AND p.accreditation_status = 'ACCREDITED';

  RETURN jsonb_build_object(
    'college_id', r_college.id,
    'college_name', r_college.name,
    'college_code', r_college.code,
    'already_present', v_already,
    'newly_accredited', v_new,
    'accredited_men', v_men,
    'accredited_women', v_women
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. The app scan: same signature and result fields as before (old app builds keep
--    working), plus the college fields. "already_accredited" now means the college
--    was already checked in.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_accreditation_scan(
  p_client_uuid UUID,
  p_profile_id UUID,
  p_volunteer_id UUID,
  p_device_timestamp TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
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
$$;

-- -----------------------------------------------------------------------------
-- 3. Athletes added (late entry, substitute) or reinstated after the college
--    checked in are accredited straight away. Runs before trg_profiles_require_payment
--    (trigger names fire in alphabetical order), which still checks the fee.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_profile_auto_accredit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accreditation_status = 'REGISTERED' AND EXISTS (
    SELECT 1 FROM squads s JOIN colleges c ON c.id = s.college_id
    WHERE s.id = NEW.squad_id AND s.payment_status = 'VERIFIED' AND c.attendance_marked_at IS NOT NULL
  ) THEN
    NEW.accreditation_status := 'ACCREDITED';
    NEW.accredited_at := COALESCE(NEW.accredited_at, timezone('utc'::text, now()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_auto_accredit ON profiles;
CREATE TRIGGER trg_profiles_auto_accredit
  BEFORE INSERT OR UPDATE OF accreditation_status ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profile_auto_accredit();

-- -----------------------------------------------------------------------------
-- 4. Who actually competed, per college and gender
--    Reported = scanned in at a roll call or call room at least once (own entry or
--    the athlete's relay team), the same rule as the Certificate of Participation.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION college_participation()
RETURNS TABLE (
  college_id UUID,
  registered_men INTEGER,
  registered_women INTEGER,
  competed_men INTEGER,
  competed_women INTEGER
)
LANGUAGE sql STABLE AS $$
  WITH reported AS (
    SELECT ha.profile_id AS id FROM heat_athletes ha
      WHERE ha.call_room_reported AND ha.profile_id IS NOT NULL
    UNION
    SELECT rm.profile_id FROM heat_athletes ha JOIN relay_members rm ON rm.relay_team_id = ha.relay_team_id
      WHERE ha.call_room_reported
    UNION
    SELECT e.profile_id FROM roll_call_entries e
      WHERE e.status = 'REPORTED' AND e.profile_id IS NOT NULL
    UNION
    SELECT rm.profile_id FROM roll_call_entries e JOIN relay_members rm ON rm.relay_team_id = e.relay_team_id
      WHERE e.status = 'REPORTED'
  )
  SELECT s.college_id,
         count(*) FILTER (WHERE s.gender = 'men')::INTEGER,
         count(*) FILTER (WHERE s.gender = 'women')::INTEGER,
         count(*) FILTER (WHERE s.gender = 'men' AND r.id IS NOT NULL AND p.accreditation_status = 'ACCREDITED')::INTEGER,
         count(*) FILTER (WHERE s.gender = 'women' AND r.id IS NOT NULL AND p.accreditation_status = 'ACCREDITED')::INTEGER
  FROM profiles p
  JOIN squads s ON s.id = p.squad_id
  LEFT JOIN reported r ON r.id = p.id
  WHERE p.accreditation_status <> 'WITHDrAWN'
  GROUP BY s.college_id
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
