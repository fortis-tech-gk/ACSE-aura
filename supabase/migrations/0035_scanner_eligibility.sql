-- ==============================================================================
-- Migration: 0035_scanner_eligibility.sql
-- Description: Event-day scanners only let through athletes who may compete.
--   * Accreditation: refused while the college's payment is not VERIFIED (S1).
--   * Call room: an unaccredited athlete cannot report; a relay team can report
--     only with 4 accredited runners (S2).
--   * Meals: refused (status NOT_PAID / NOT_ACCREDITED) unless the college paid
--     and the athlete is accredited. Offline replays of a granted scan still
--     count once (S3).
--   * Hostel: check-in refused while the college's payment is not VERIFIED (S4).
-- The guards sit on the rows themselves, so the officials app, the API and the
-- admin website are all covered.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Accreditation and hostel check-in need a VERIFIED payment
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_profile_requires_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_paid TEXT;
BEGIN
  IF (NEW.accreditation_status = 'ACCREDITED' AND OLD.accreditation_status IS DISTINCT FROM 'ACCREDITED')
     OR (NEW.accommodation_checked_in AND NOT COALESCE(OLD.accommodation_checked_in, FALSE)) THEN
    SELECT payment_status INTO v_paid FROM squads WHERE id = NEW.squad_id;
    IF v_paid IS DISTINCT FROM 'VERIFIED' THEN
      RAISE EXCEPTION 'Not allowed: % is from a college whose registration fee is not verified yet. Send them to the meet office.',
        NEW.sslc_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_require_payment ON profiles;
CREATE TRIGGER trg_profiles_require_payment
  BEFORE UPDATE OF accreditation_status, accommodation_checked_in ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profile_requires_payment();

-- ------------------------------------------------------------------------------
-- 2. Call room: only accredited athletes (relays: 4 accredited runners) report
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_call_room_requires_accreditation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_name TEXT;
  v_ok INTEGER;
BEGIN
  IF NOT COALESCE(NEW.call_room_reported, FALSE) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.call_room_reported THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.profile_id IS NOT NULL THEN
    SELECT accreditation_status, sslc_name INTO v_status, v_name FROM profiles WHERE id = NEW.profile_id;
    IF v_status IS DISTINCT FROM 'ACCREDITED' THEN
      RAISE EXCEPTION '% is not accredited, so cannot report to the call room. Send them to the accreditation desk.', v_name;
    END IF;
  ELSIF NEW.relay_team_id IS NOT NULL THEN
    SELECT count(*) INTO v_ok
    FROM relay_members rm JOIN profiles p ON p.id = rm.profile_id
    WHERE rm.relay_team_id = NEW.relay_team_id AND p.accreditation_status = 'ACCREDITED';
    IF v_ok < 4 THEN
      RAISE EXCEPTION 'This relay team has only % accredited runner(s); 4 are needed to report.', v_ok;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heat_athletes_call_room_accredited ON heat_athletes;
CREATE TRIGGER trg_heat_athletes_call_room_accredited
  BEFORE INSERT OR UPDATE OF call_room_reported ON heat_athletes
  FOR EACH ROW EXECUTE FUNCTION trg_call_room_requires_accreditation();

-- ------------------------------------------------------------------------------
-- 3. Meals: paid and accredited only
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scan_meal_coupon(
  p_client_uuid TEXT,
  p_profile_id UUID,
  p_meal_type TEXT,
  p_volunteer_id UUID DEFAULT NULL,
  p_scanned_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  r_athlete RECORD;
  r_existing_meal RECORD;
  -- Never in the future; an offline scan keeps its own time
  v_at TIMESTAMPTZ := LEAST(COALESCE(p_scanned_at, now()), now());
  v_date DATE := (LEAST(COALESCE(p_scanned_at, now()), now()) AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  SELECT p.id, p.sslc_name, p.usn, p.bid_number, p.accreditation_status, s.payment_status, c.name AS college_name, c.code AS college_code
  INTO r_athlete
  FROM profiles p
  JOIN squads s ON p.squad_id = s.id
  JOIN colleges c ON s.college_id = c.id
  WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Athlete record not found in system.');
  END IF;

  IF r_athlete.accreditation_status = 'WITHDrAWN' THEN
    RETURN jsonb_build_object('success', false, 'status', 'WITHDrAWN', 'message', 'Athlete has been officially withdrawn from the meet.');
  END IF;

  -- Same scan re-sent (offline sync retry)
  IF EXISTS (SELECT 1 FROM meal_logs WHERE client_scan_uuid = p_client_uuid) THEN
    RETURN jsonb_build_object(
      'success', true, 'status', 'GRANTED', 'is_duplicate_sync', true, 'meal_type', p_meal_type,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code
    );
  END IF;

  -- Only athletes who may compete eat: college paid and athlete accredited (audit S3)
  IF r_athlete.payment_status <> 'VERIFIED' THEN
    RETURN jsonb_build_object(
      'success', false, 'status', 'NOT_PAID', 'meal_type', p_meal_type,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
      'message', 'NOT ELIGIBLE: the college''s registration fee is not verified yet. Send the athlete to the meet office.'
    );
  END IF;
  IF r_athlete.accreditation_status <> 'ACCREDITED' THEN
    RETURN jsonb_build_object(
      'success', false, 'status', 'NOT_ACCREDITED', 'meal_type', p_meal_type,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
      'message', 'NOT ELIGIBLE: athlete is not accredited yet. Send them to the accreditation desk first.'
    );
  END IF;

  SELECT scanned_at INTO r_existing_meal
  FROM meal_logs
  WHERE profile_id = p_profile_id AND meal_type = p_meal_type AND meal_date = v_date;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'status', 'ALREADY_SERVED', 'meal_type', p_meal_type,
      'served_at', r_existing_meal.scanned_at,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
      'message', 'ALREADY CLAIMED: Athlete already received ' || p_meal_type || ' at '
        || to_char(r_existing_meal.scanned_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') || '.'
    );
  END IF;

  BEGIN
    INSERT INTO meal_logs (client_scan_uuid, profile_id, meal_type, meal_date, scanned_by, scanned_at)
    VALUES (p_client_uuid, p_profile_id, p_meal_type, v_date, p_volunteer_id, v_at);
  EXCEPTION WHEN unique_violation THEN
    -- Two counters scanned the same athlete at the same moment
    RETURN jsonb_build_object(
      'success', false, 'status', 'ALREADY_SERVED', 'meal_type', p_meal_type,
      'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
      'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
      'message', 'ALREADY CLAIMED: Athlete already received ' || p_meal_type || ' today.'
    );
  END;

  RETURN jsonb_build_object(
    'success', true, 'status', 'GRANTED', 'is_duplicate_sync', false, 'meal_type', p_meal_type,
    'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
    'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
    'message', 'Meal verified successfully.'
  );
END;
$$ LANGUAGE plpgsql;
