-- =============================================================================
-- 0046: A substitute athlete takes over the withdrawn athlete's events and gets full details.
--
-- Before: substitute_athlete() created a profile with only name, USN, semester, blood group and
-- dates. It had NO event registrations (withdraw_athlete deletes them), no photo, DOB, phone or
-- Aadhaar. The heat draw reads registrations, so a substitute was never drawn into any heat, and
-- could not log in to the Athletes app (bib + date of birth).
--
-- Now:
--   * withdraw_athlete() saves the athlete's registrations (event + kind) in
--     roster_amendments.withdrawn_registrations before deleting them.
--   * substitute_athlete() copies those registrations to the new profile (the quota and relay
--     triggers run as usual, so a relay nomination rebuilds the team) and also stores date of
--     birth, phone, Aadhaar and photo. A slot can be substituted only once.
--   * Athletes withdrawn BEFORE this migration have no saved events: their substitute is created
--     without events (the result says copied_registrations = 0).
-- Safe to re-run.
-- =============================================================================

BEGIN;

ALTER TABLE public.roster_amendments ADD COLUMN IF NOT EXISTS withdrawn_registrations JSONB;

CREATE OR REPLACE FUNCTION withdraw_athlete(
  p_profile_id UUID,
  p_reason TEXT,
  p_admin_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_bid INT;
  v_squad_id UUID;
  v_name TEXT;
  v_status TEXT;
  v_regs JSONB;
BEGIN
  SELECT bid_number, squad_id, sslc_name, accreditation_status
  INTO v_bid, v_squad_id, v_name, v_status
  FROM profiles
  WHERE id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Athlete profile not found.';
  END IF;
  IF v_status = 'WITHDrAWN' THEN
    RAISE EXCEPTION '% is already withdrawn.', v_name;
  END IF;

  -- Remember the events so a substitute can take them over
  SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id', event_id, 'kind', kind)), '[]'::jsonb)
  INTO v_regs
  FROM registrations
  WHERE profile_id = p_profile_id;

  UPDATE profiles
  SET accreditation_status = 'WITHDrAWN', updated_at = timezone('utc'::text, now())
  WHERE id = p_profile_id;

  -- Delete event registrations so they do not appear in heat seeding
  DELETE FROM registrations WHERE profile_id = p_profile_id;
  DELETE FROM relay_members WHERE profile_id = p_profile_id;

  INSERT INTO roster_amendments (
    squad_id, amendment_type, original_profile_id, bid_number, reason, performed_by, withdrawn_registrations
  )
  VALUES (v_squad_id, 'withdraw', p_profile_id, v_bid, p_reason, p_admin_id, v_regs);

  RETURN jsonb_build_object(
    'success', true,
    'athlete_name', v_name,
    'bid_number', v_bid,
    'status', 'WITHDrAWN',
    'saved_registrations', jsonb_array_length(v_regs)
  );
END;
$$ LANGUAGE plpgsql;

-- The old 9-argument version is replaced by one with extra (optional) details
DROP FUNCTION IF EXISTS substitute_athlete(UUID, TEXT, TEXT, INT, TEXT, DATE, DATE, TEXT, UUID);

CREATE OR REPLACE FUNCTION substitute_athlete(
  p_withdrawn_profile_id UUID,
  p_new_sslc_name TEXT,
  p_new_usn TEXT,
  p_new_semester INT,
  p_new_blood_group TEXT,
  p_new_joining_date DATE,
  p_new_sem_start_date DATE,
  p_reason TEXT,
  p_admin_id UUID,
  p_new_date_of_birth DATE DEFAULT NULL,
  p_new_phone TEXT DEFAULT NULL,
  p_new_aadhaar TEXT DEFAULT NULL,
  p_new_photo_url TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_bid INT;
  v_squad_id UUID;
  v_status TEXT;
  v_new_profile_id UUID;
  v_regs JSONB;
  v_copied INT := 0;
  r RECORD;
BEGIN
  SELECT bid_number, squad_id, accreditation_status
  INTO v_bid, v_squad_id, v_status
  FROM profiles
  WHERE id = p_withdrawn_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawn profile not found.';
  END IF;
  IF v_status <> 'WITHDrAWN' THEN
    RAISE EXCEPTION 'Only a withdrawn athlete''s slot can be substituted. Withdraw the athlete first.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM roster_amendments
    WHERE amendment_type = 'substitute' AND original_profile_id = p_withdrawn_profile_id
  ) THEN
    RAISE EXCEPTION 'This slot already has a substitute.';
  END IF;

  INSERT INTO profiles (
    squad_id, sslc_name, usn, semester, blood_group,
    college_joining_date, sem_start_date, bid_number, accreditation_status,
    date_of_birth, phone, aadhaar_number, photo_url
  )
  VALUES (
    v_squad_id, p_new_sslc_name, upper(trim(p_new_usn)), p_new_semester, p_new_blood_group,
    p_new_joining_date, p_new_sem_start_date, v_bid, 'REGISTERED',
    p_new_date_of_birth, NULLIF(trim(p_new_phone), ''), NULLIF(trim(p_new_aadhaar), ''), NULLIF(trim(p_new_photo_url), '')
  )
  RETURNING id INTO v_new_profile_id;

  -- Take over the withdrawn athlete's events (regular, reserve, relay, half marathon)
  SELECT withdrawn_registrations INTO v_regs
  FROM roster_amendments
  WHERE amendment_type = 'withdraw' AND original_profile_id = p_withdrawn_profile_id
    AND withdrawn_registrations IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_regs IS NOT NULL THEN
    -- Regular events first, so the reserve / relay rules see them
    FOR r IN
      SELECT (x->>'event_id')::UUID AS event_id, x->>'kind' AS kind
      FROM jsonb_array_elements(v_regs) x
      ORDER BY CASE x->>'kind' WHEN 'regular' THEN 0 WHEN 'half_marathon' THEN 1 WHEN 'relay' THEN 2 ELSE 3 END
    LOOP
      INSERT INTO registrations (profile_id, event_id, kind) VALUES (v_new_profile_id, r.event_id, r.kind);
      v_copied := v_copied + 1;
    END LOOP;
  END IF;

  INSERT INTO roster_amendments (
    squad_id, amendment_type, original_profile_id, new_profile_id, bid_number, reason, performed_by
  )
  VALUES (v_squad_id, 'substitute', p_withdrawn_profile_id, v_new_profile_id, v_bid, p_reason, p_admin_id);

  RETURN jsonb_build_object(
    'success', true,
    'new_profile_id', v_new_profile_id,
    'inherited_bid_number', v_bid,
    'copied_registrations', v_copied
  );
END;
$$ LANGUAGE plpgsql;

-- Same lock-down as 0039: only the service role may call these
REVOKE EXECUTE ON FUNCTION withdraw_athlete(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION substitute_athlete(UUID, TEXT, TEXT, INT, TEXT, DATE, DATE, TEXT, UUID, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION withdraw_athlete(UUID, TEXT, UUID) FROM anon;
    REVOKE EXECUTE ON FUNCTION substitute_athlete(UUID, TEXT, TEXT, INT, TEXT, DATE, DATE, TEXT, UUID, DATE, TEXT, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION withdraw_athlete(UUID, TEXT, UUID) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION substitute_athlete(UUID, TEXT, TEXT, INT, TEXT, DATE, DATE, TEXT, UUID, DATE, TEXT, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION withdraw_athlete(UUID, TEXT, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION substitute_athlete(UUID, TEXT, TEXT, INT, TEXT, DATE, DATE, TEXT, UUID, DATE, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
