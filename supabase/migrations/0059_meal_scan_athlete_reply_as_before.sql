-- =============================================================================
-- 0059: Athletes' meal-scan answer exactly as before 0057 (27-11-2026)
--
-- 0057 taught scan_meal_coupon to serve faculty / PED / official passes, but its
-- athlete branch was retyped and the "served" answer changed shape: it lost
-- 'is_duplicate_sync': false and its message became 'SERVE <meal>' instead of
-- 'Meal verified successfully.'. The officials app reads neither on a served
-- meal, so counters were not affected; this puts the athlete answer back exactly
-- as production had it (0055). The pass branch is unchanged.
-- Function body taken from production after 0057 with only that RETURN restored.
-- Safe to re-run.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.scan_meal_coupon(p_client_uuid text, p_profile_id uuid, p_meal_type text, p_volunteer_id uuid DEFAULT NULL::uuid, p_scanned_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_athlete RECORD;
  r_del RECORD;
  r_existing_meal RECORD;
  v_role TEXT;
  v_name TEXT;
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

  -- ---------------------------------------------------------------------------
  -- Not an athlete: a faculty / PED / official pass
  -- ---------------------------------------------------------------------------
  IF NOT FOUND THEN
    SELECT d.id, d.full_name, d.pass_no, d.category, d.designation, d.meals_included,
           d.accreditation_status, d.college_id, c.name AS college_name, c.code AS college_code
    INTO r_del
    FROM delegates d
    LEFT JOIN colleges c ON c.id = d.college_id
    WHERE d.id = p_profile_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Pass not found in system.');
    END IF;

    v_role := CASE r_del.category
                WHEN 'PED' THEN 'Physical Education Director'
                WHEN 'FACULTY' THEN 'ACS Faculty'
                WHEN 'VOLUNTEER' THEN 'Volunteer'
                ELSE COALESCE(NULLIF(r_del.designation, ''), 'Technical Official')
              END;
    -- A blank pass has no name: the counter sees what it is and its number
    v_name := COALESCE(NULLIF(btrim(r_del.full_name), ''), v_role || ' · Pass ' || r_del.pass_no);

    IF r_del.accreditation_status = 'WITHDRAWN' THEN
      RETURN jsonb_build_object(
        'success', false, 'status', 'WITHDRAWN', 'subject_kind', 'delegate', 'role', v_role,
        'athlete_name', v_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
        'college_name', r_del.college_name, 'college_code', r_del.college_code,
        'message', 'This pass has been cancelled by the meet office.'
      );
    END IF;

    -- Same scan re-sent (offline sync retry)
    IF EXISTS (SELECT 1 FROM delegate_meal_logs WHERE client_scan_uuid = p_client_uuid) THEN
      RETURN jsonb_build_object(
        'success', true, 'status', 'GRANTED', 'is_duplicate_sync', true, 'meal_type', p_meal_type,
        'subject_kind', 'delegate', 'role', v_role,
        'athlete_name', v_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
        'college_name', r_del.college_name, 'college_code', r_del.college_code
      );
    END IF;

    IF NOT r_del.meals_included THEN
      RETURN jsonb_build_object(
        'success', false, 'status', 'NO_MEAL_PASS', 'meal_type', p_meal_type,
        'subject_kind', 'delegate', 'role', v_role,
        'athlete_name', v_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
        'college_name', r_del.college_name, 'college_code', r_del.college_code,
        'message', 'NOT ELIGIBLE: this pass was issued without meals. Send them to the meet office.'
      );
    END IF;

    -- No fee and no check-in for passes: issued and not cancelled is enough

    SELECT scanned_at INTO r_existing_meal
    FROM delegate_meal_logs
    WHERE delegate_id = r_del.id AND meal_type = p_meal_type AND meal_date = v_date;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', false, 'status', 'ALREADY_SERVED', 'meal_type', p_meal_type,
        'served_at', r_existing_meal.scanned_at,
        'subject_kind', 'delegate', 'role', v_role,
        'athlete_name', v_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
        'college_name', r_del.college_name, 'college_code', r_del.college_code,
        'message', 'ALREADY CLAIMED: ' || p_meal_type || ' was already served at '
          || to_char(r_existing_meal.scanned_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') || '.'
      );
    END IF;

    BEGIN
      INSERT INTO delegate_meal_logs (client_scan_uuid, delegate_id, meal_type, meal_date, scanned_by, scanned_at)
      VALUES (p_client_uuid, r_del.id, p_meal_type, v_date, p_volunteer_id, v_at);
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object(
        'success', false, 'status', 'ALREADY_SERVED', 'meal_type', p_meal_type,
        'subject_kind', 'delegate', 'role', v_role,
        'athlete_name', v_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
        'college_name', r_del.college_name, 'college_code', r_del.college_code,
        'message', 'ALREADY CLAIMED: ' || p_meal_type || ' was already served today.'
      );
    END;

    RETURN jsonb_build_object(
      'success', true, 'status', 'GRANTED', 'meal_type', p_meal_type, 'served_at', v_at,
      'subject_kind', 'delegate', 'role', v_role,
      'athlete_name', v_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
      'college_name', r_del.college_name, 'college_code', r_del.college_code,
      'message', 'SERVE ' || p_meal_type || ' — ' || v_role
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- Athlete (unchanged from 0035 / 0055)
  -- ---------------------------------------------------------------------------
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
$function$;

REVOKE EXECUTE ON FUNCTION public.scan_meal_coupon(text, uuid, text, uuid, timestamptz) FROM PUBLIC;

COMMIT;
