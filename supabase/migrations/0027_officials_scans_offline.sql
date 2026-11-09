-- ==============================================================================
-- Migration: 0027_officials_scans_offline.sql
-- Description: AURA Officials app (food / warden / accreditation scanners, offline sync)
--   1. scan_meal_coupon: the meal counts for the India (IST) date of the scan itself, not
--      the server's UTC date or the time an offline scan was synced.
--   2. process_accommodation_checkin: scanning an athlete who is already checked in returns
--      their existing hostel and room instead of adding a second bed to the occupancy count.
-- ==============================================================================

-- 1. Meals ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS scan_meal_coupon(TEXT, UUID, TEXT, UUID);

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
  SELECT p.id, p.sslc_name, p.usn, p.bid_number, p.accreditation_status, c.name AS college_name, c.code AS college_code
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

-- Counts for "today" in India time by default
CREATE OR REPLACE FUNCTION get_meal_stats(p_date DATE DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_date DATE := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_breakfast INT := 0;
  v_lunch INT := 0;
  v_snacks INT := 0;
  v_dinner INT := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE meal_type = 'BREAKFAST'),
    COUNT(*) FILTER (WHERE meal_type = 'LUNCH'),
    COUNT(*) FILTER (WHERE meal_type = 'SNACKS'),
    COUNT(*) FILTER (WHERE meal_type = 'DINNER')
  INTO v_breakfast, v_lunch, v_snacks, v_dinner
  FROM meal_logs WHERE meal_date = v_date;

  RETURN jsonb_build_object(
    'date', v_date,
    'breakfast_served', v_breakfast,
    'lunch_served', v_lunch,
    'snacks_served', v_snacks,
    'dinner_served', v_dinner,
    'total_meals_today', (v_breakfast + v_lunch + v_snacks + v_dinner)
  );
END;
$$ LANGUAGE plpgsql;

-- 2. Hostel check-in -------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_accommodation_checkin(
  p_client_uuid UUID,
  p_profile_id UUID,
  p_hostel_id UUID,
  p_warden_id UUID,
  p_room_assigned TEXT DEFAULT 'General Dorm',
  p_caution_deposit NUMERIC DEFAULT 0,
  p_caution_receipt_no TEXT DEFAULT '',
  p_device_timestamp TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  r_profile RECORD;
  r_hostel RECORD;
  r_prev RECORD;
  v_current_occupancy INTEGER := 0;
BEGIN
  -- Same scan re-sent (offline sync retry)
  SELECT a.room_assigned, a.caution_deposit, a.caution_receipt_no, h.id AS hostel_id, h.name AS hostel_name
  INTO r_prev
  FROM accommodation_scans a JOIN hostels h ON h.id = a.hostel_id
  WHERE a.client_scan_uuid = p_client_uuid;
  IF FOUND THEN
    SELECT p.id, p.sslc_name, p.usn, p.bid_number, c.name AS college_name, s.squad_code
    INTO r_profile
    FROM profiles p JOIN squads s ON p.squad_id = s.id JOIN colleges c ON s.college_id = c.id
    WHERE p.id = p_profile_id;
    RETURN jsonb_build_object(
      'success', true, 'is_duplicate_sync', true, 'already_checked_in', false,
      'athlete_id', r_profile.id, 'sslc_name', r_profile.sslc_name, 'usn', r_profile.usn,
      'bid_number', r_profile.bid_number, 'college_name', r_profile.college_name, 'squad_code', r_profile.squad_code,
      'hostel_id', r_prev.hostel_id, 'hostel_name', r_prev.hostel_name, 'room_assigned', r_prev.room_assigned,
      'caution_deposit', r_prev.caution_deposit, 'caution_receipt_no', r_prev.caution_receipt_no
    );
  END IF;

  SELECT p.id, p.sslc_name, p.usn, p.bid_number, p.accreditation_status, p.accommodation_checked_in,
         p.accommodation_checked_in_at, c.name AS college_name, s.squad_code, s.gender AS squad_gender
  INTO r_profile
  FROM profiles p
  JOIN squads s ON p.squad_id = s.id
  JOIN colleges c ON s.college_id = c.id
  WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Athlete profile not found.';
  END IF;
  IF r_profile.accreditation_status = 'WITHDrAWN' THEN
    RAISE EXCEPTION 'Cannot check-in withdrawn athlete.';
  END IF;

  -- Already checked in: report where, add nothing
  IF r_profile.accommodation_checked_in THEN
    SELECT a.room_assigned, h.id AS hostel_id, h.name AS hostel_name, a.synced_at
    INTO r_prev
    FROM accommodation_scans a JOIN hostels h ON h.id = a.hostel_id
    WHERE a.profile_id = p_profile_id
    ORDER BY a.synced_at ASC
    LIMIT 1;
    RETURN jsonb_build_object(
      'success', true, 'is_duplicate_sync', false, 'already_checked_in', true,
      'checked_in_at', r_profile.accommodation_checked_in_at,
      'athlete_id', r_profile.id, 'sslc_name', r_profile.sslc_name, 'usn', r_profile.usn,
      'bid_number', r_profile.bid_number, 'college_name', r_profile.college_name, 'squad_code', r_profile.squad_code,
      'hostel_id', r_prev.hostel_id, 'hostel_name', r_prev.hostel_name, 'room_assigned', r_prev.room_assigned
    );
  END IF;

  SELECT id, name, gender, total_capacity INTO r_hostel FROM hostels WHERE id = p_hostel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hostel not found.';
  END IF;

  IF LOWER(r_profile.squad_gender) <> LOWER(r_hostel.gender) THEN
    RAISE EXCEPTION 'Gender mismatch: % athlete cannot be allocated to % hostel (%).',
      UPPER(r_profile.squad_gender), UPPER(r_hostel.gender), r_hostel.name;
  END IF;

  SELECT COUNT(DISTINCT profile_id) INTO v_current_occupancy FROM accommodation_scans WHERE hostel_id = p_hostel_id;

  UPDATE profiles
  SET accommodation_checked_in = TRUE,
      accommodation_checked_in_at = COALESCE(accommodation_checked_in_at, COALESCE(p_device_timestamp, now())),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_profile_id;

  INSERT INTO accommodation_scans (
    client_scan_uuid, profile_id, hostel_id, scanned_by, room_assigned, caution_deposit, caution_receipt_no, device_timestamp
  )
  VALUES (
    p_client_uuid, p_profile_id, p_hostel_id, p_warden_id,
    COALESCE(NULLIF(p_room_assigned, ''), 'General Dorm'),
    COALESCE(p_caution_deposit, 0),
    COALESCE(p_caution_receipt_no, ''),
    COALESCE(p_device_timestamp, timezone('utc'::text, now()))
  );

  RETURN jsonb_build_object(
    'success', true, 'is_duplicate_sync', false, 'already_checked_in', false,
    'athlete_id', r_profile.id, 'sslc_name', r_profile.sslc_name, 'usn', r_profile.usn,
    'bid_number', r_profile.bid_number, 'college_name', r_profile.college_name, 'squad_code', r_profile.squad_code,
    'hostel_id', r_hostel.id, 'hostel_name', r_hostel.name,
    'room_assigned', COALESCE(NULLIF(p_room_assigned, ''), 'General Dorm'),
    'caution_deposit', COALESCE(p_caution_deposit, 0),
    'caution_receipt_no', COALESCE(p_caution_receipt_no, ''),
    'occupancy_after_checkin', v_current_occupancy + 1,
    'total_capacity', r_hostel.total_capacity
  );
END;
$$ LANGUAGE plpgsql;
