-- =============================================================================
-- 0057: Faculty, PEDs and meet officials get accreditation passes (27-11-2026)
--
-- Until now only athletes (profiles) existed, so the accompanying faculty, the
-- Physical Education Directors, and the host's referees / technical officials /
-- volunteers had no ID card and nothing to show at the food counter.
--
-- This migration adds ONE table for every non-athlete who needs a pass:
--   delegates.category = 'FACULTY'  — college faculty / team manager / coach
--                        'PED'      — Physical Education Director of a college
--                        'OFFICIAL' — host side: referee, technical official,
--                                     jury, volunteer, medical, media, guest
-- College rows carry college_id; host officials have college_id = NULL.
--
-- The pass QR is the SAME signed format as the athlete card
-- ("AURA26.<uuid>.<sig>", see frontend/web/src/lib/athlete-qr.ts), so the
-- officials app scanner and the API need no new QR grammar: the uuid simply
-- belongs to delegates instead of profiles, and the RPCs below work out which.
--   * scan_meal_coupon          — falls back to delegates, logs delegate_meal_logs
--   * process_delegate_accommodation_checkin — hostel check-in for a pass that
--                                 asked for a bed (the API calls it for a pass)
--   * get_meal_stats            — counts athlete + delegate meals
-- Passes are free and need no check-in: active from the moment they are issued
-- until the meet office cancels one. The QR is used only at food and, when the
-- holder asked for it, the hostel.
-- Pass numbers are typeable like a bib (90001+), outside the athlete bib ranges
-- (men 100-2000, women 2001+), so a damaged pass can be keyed in by hand.
--
-- Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Pass numbers: 90001.. — never collide with athlete bibs
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS delegate_pass_no_seq
  AS INTEGER START WITH 90001 INCREMENT BY 1 MINVALUE 90001 MAXVALUE 99999 NO CYCLE;

-- -----------------------------------------------------------------------------
-- 2. The delegates table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('FACULTY', 'PED', 'OFFICIAL')),
  -- College faculty / PED: the college that nominated them. NULL for host officials.
  college_id UUID REFERENCES colleges(id) ON DELETE CASCADE,
  pass_no INTEGER NOT NULL UNIQUE DEFAULT nextval('delegate_pass_no_seq'),
  full_name TEXT NOT NULL,
  -- "Physical Education Director", "Team Manager", "Coach", "Referee", "Volunteer", ...
  designation TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  -- Host officials: the body they come from (VTU, AFI, a college, a hospital, ...)
  organisation TEXT NOT NULL DEFAULT '',
  gender TEXT CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE', 'OTHER')),
  phone TEXT NOT NULL DEFAULT '',
  email TEXT,
  blood_group TEXT NOT NULL DEFAULT '',
  -- Which squad they travel with (printed on the pass; 'BOTH' for the whole contingent)
  squad_scope TEXT NOT NULL DEFAULT 'BOTH' CHECK (squad_scope IN ('MEN', 'WOMEN', 'BOTH')),
  meals_included BOOLEAN NOT NULL DEFAULT TRUE,
  accommodation_required BOOLEAN NOT NULL DEFAULT FALSE,
  accreditation_status TEXT NOT NULL DEFAULT 'REGISTERED'
    CHECK (accreditation_status IN ('REGISTERED', 'ACCREDITED', 'WITHDRAWN')),
  accredited_at TIMESTAMPTZ,
  remarks TEXT NOT NULL DEFAULT '',
  -- Who entered the row: "<squad code> (PED)" or "Meet office" / an import filename
  added_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  -- A faculty member or PED always belongs to a college; a host official never does
  CONSTRAINT chk_delegate_college CHECK (
    (category = 'OFFICIAL' AND college_id IS NULL) OR
    (category <> 'OFFICIAL' AND college_id IS NOT NULL)
  )
);

-- Re-uploading the same filled sheet must update people, not duplicate them
CREATE UNIQUE INDEX IF NOT EXISTS uq_delegate_college_person
  ON delegates (college_id, category, upper(btrim(full_name)))
  WHERE college_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_delegate_official_person
  ON delegates (upper(btrim(full_name)), phone)
  WHERE college_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_delegates_college ON delegates (college_id, category);
CREATE INDEX IF NOT EXISTS idx_delegates_category ON delegates (category, accreditation_status);

-- -----------------------------------------------------------------------------
-- 3. Meals served to delegates (athletes keep meal_logs; the FK differs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegate_meal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_scan_uuid TEXT UNIQUE NOT NULL,
  delegate_id UUID NOT NULL REFERENCES delegates(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER')),
  meal_date DATE NOT NULL DEFAULT CURRENT_DATE,
  scanned_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_delegate_meal_per_day UNIQUE (delegate_id, meal_type, meal_date)
);
CREATE INDEX IF NOT EXISTS idx_delegate_meals_date ON delegate_meal_logs (meal_date, meal_type);

-- -----------------------------------------------------------------------------
-- 4. Optional cap per college (NULL = no cap). Set it from the meet office.
-- -----------------------------------------------------------------------------
ALTER TABLE meet_settings ADD COLUMN IF NOT EXISTS max_delegates_per_college INTEGER;

CREATE OR REPLACE FUNCTION trg_delegate_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cap INTEGER;
  v_used INTEGER;
BEGIN
  IF NEW.college_id IS NULL THEN RETURN NEW; END IF;
  SELECT max_delegates_per_college INTO v_cap FROM meet_settings LIMIT 1;
  IF v_cap IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_used
  FROM delegates
  WHERE college_id = NEW.college_id
    AND accreditation_status <> 'WITHDRAWN'
    AND id <> NEW.id;
  IF v_used + 1 > v_cap THEN
    RAISE EXCEPTION 'This college may nominate at most % faculty / officials (% already entered).', v_cap, v_used;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delegates_cap ON delegates;
CREATE TRIGGER trg_delegates_cap
  BEFORE INSERT OR UPDATE OF college_id, accreditation_status ON delegates
  FOR EACH ROW EXECUTE FUNCTION trg_delegate_cap();

-- -----------------------------------------------------------------------------
-- 5. Every pass is active from the moment it is issued: no fee, no check-in.
--    Only the meet office cancelling it (WITHDRAWN) stops it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_delegate_auto_accredit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accreditation_status <> 'WITHDRAWN' THEN
    NEW.accreditation_status := 'ACCREDITED';
    NEW.accredited_at := COALESCE(NEW.accredited_at, timezone('utc'::text, now()));
  END IF;
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delegates_auto_accredit ON delegates;
CREATE TRIGGER trg_delegates_auto_accredit
  BEFORE INSERT OR UPDATE ON delegates
  FOR EACH ROW EXECUTE FUNCTION trg_delegate_auto_accredit();

-- -----------------------------------------------------------------------------
-- 6. College check-in is for athletes only. (An earlier draft of this migration
--    made it accredit passes too; this puts back the 0054 function unchanged.)
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
-- 7. Food counter: the same RPC serves athletes and delegates.
--    The id the scanner sends is an athlete profile OR a delegate; whichever it
--    is, the signature and the result keys the app reads stay the same.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scan_meal_coupon(
  p_client_uuid TEXT,
  p_profile_id UUID,
  p_meal_type TEXT,
  p_volunteer_id UUID DEFAULT NULL,
  p_scanned_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  r_athlete RECORD;
  r_del RECORD;
  r_existing_meal RECORD;
  v_role TEXT;
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
                WHEN 'FACULTY' THEN COALESCE(NULLIF(r_del.designation, ''), 'Faculty')
                ELSE COALESCE(NULLIF(r_del.designation, ''), 'Meet official')
              END;

    IF r_del.accreditation_status = 'WITHDRAWN' THEN
      RETURN jsonb_build_object(
        'success', false, 'status', 'WITHDRAWN', 'subject_kind', 'delegate', 'role', v_role,
        'athlete_name', r_del.full_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
        'college_name', r_del.college_name, 'college_code', r_del.college_code,
        'message', 'This pass has been cancelled by the meet office.'
      );
    END IF;

    -- Same scan re-sent (offline sync retry)
    IF EXISTS (SELECT 1 FROM delegate_meal_logs WHERE client_scan_uuid = p_client_uuid) THEN
      RETURN jsonb_build_object(
        'success', true, 'status', 'GRANTED', 'is_duplicate_sync', true, 'meal_type', p_meal_type,
        'subject_kind', 'delegate', 'role', v_role,
        'athlete_name', r_del.full_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
        'college_name', r_del.college_name, 'college_code', r_del.college_code
      );
    END IF;

    IF NOT r_del.meals_included THEN
      RETURN jsonb_build_object(
        'success', false, 'status', 'NO_MEAL_PASS', 'meal_type', p_meal_type,
        'subject_kind', 'delegate', 'role', v_role,
        'athlete_name', r_del.full_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
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
        'athlete_name', r_del.full_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
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
        'athlete_name', r_del.full_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
        'college_name', r_del.college_name, 'college_code', r_del.college_code,
        'message', 'ALREADY CLAIMED: ' || p_meal_type || ' was already served today.'
      );
    END;

    RETURN jsonb_build_object(
      'success', true, 'status', 'GRANTED', 'meal_type', p_meal_type, 'served_at', v_at,
      'subject_kind', 'delegate', 'role', v_role,
      'athlete_name', r_del.full_name, 'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no,
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
    'success', true, 'status', 'GRANTED', 'meal_type', p_meal_type, 'served_at', v_at,
    'athlete_name', r_athlete.sslc_name, 'bid_number', r_athlete.bid_number,
    'college_name', r_athlete.college_name, 'college_code', r_athlete.college_code,
    'message', 'SERVE ' || p_meal_type
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8a. Passes are not used at the accreditation desk. (An earlier draft of this
--     migration let a pass check a college in; this puts back the 0055 function.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_accreditation_scan(p_client_uuid uuid, p_profile_id uuid, p_volunteer_id uuid, p_device_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
$function$;

-- -----------------------------------------------------------------------------
-- 8b. Accommodation: a pass whose holder asked for a bed checks in at the hostel
--    with the same scan as an athlete. Passes are not tied to a squad's hostel
--    allotment, so the warden picks the hostel in the app.
-- -----------------------------------------------------------------------------
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS accommodation_checked_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS accommodation_checked_in_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS delegate_accommodation_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_scan_uuid UUID UNIQUE NOT NULL,
  delegate_id UUID NOT NULL REFERENCES delegates(id) ON DELETE CASCADE,
  hostel_id UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  scanned_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  room_assigned TEXT NOT NULL DEFAULT 'General Dorm',
  device_timestamp TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_delegate_stay_hostel ON delegate_accommodation_scans (hostel_id);

CREATE OR REPLACE FUNCTION process_delegate_accommodation_checkin(
  p_client_uuid UUID,
  p_delegate_id UUID,
  p_hostel_id UUID,
  p_warden_id UUID,
  p_room_assigned TEXT DEFAULT 'General Dorm',
  p_device_timestamp TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  r_del RECORD;
  r_hostel RECORD;
  r_prev RECORD;
  v_role TEXT;
  v_college TEXT;
BEGIN
  SELECT d.id, d.full_name, d.pass_no, d.category, d.designation, d.gender, d.organisation,
         d.accommodation_required, d.accommodation_checked_in, d.accommodation_checked_in_at,
         d.accreditation_status, c.name AS college_name
  INTO r_del
  FROM delegates d LEFT JOIN colleges c ON c.id = d.college_id
  WHERE d.id = p_delegate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pass not found.';
  END IF;

  v_role := CASE r_del.category WHEN 'PED' THEN 'Physical Education Director'
                                ELSE COALESCE(NULLIF(r_del.designation, ''), initcap(r_del.category)) END;
  v_college := COALESCE(r_del.college_name, NULLIF(r_del.organisation, ''), 'AURA 2026 Organising Committee');

  -- Same scan re-sent (offline sync retry)
  SELECT a.room_assigned, h.id AS hostel_id, h.name AS hostel_name
  INTO r_prev
  FROM delegate_accommodation_scans a JOIN hostels h ON h.id = a.hostel_id
  WHERE a.client_scan_uuid = p_client_uuid;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true, 'is_duplicate_sync', true, 'already_checked_in', false, 'subject_kind', 'delegate',
      'athlete_id', r_del.id, 'sslc_name', COALESCE(r_del.full_name, v_role), 'usn', v_role,
      'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no, 'college_name', v_college, 'squad_code', '',
      'hostel_id', r_prev.hostel_id, 'hostel_name', r_prev.hostel_name, 'room_assigned', r_prev.room_assigned
    );
  END IF;

  IF r_del.accreditation_status = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'This pass has been cancelled by the meet office.';
  END IF;
  IF NOT r_del.accommodation_required THEN
    RAISE EXCEPTION 'Pass % was issued without accommodation. Send them to the meet office.', r_del.pass_no;
  END IF;

  -- Already checked in: report where, add nothing
  IF r_del.accommodation_checked_in THEN
    SELECT a.room_assigned, h.id AS hostel_id, h.name AS hostel_name
    INTO r_prev
    FROM delegate_accommodation_scans a JOIN hostels h ON h.id = a.hostel_id
    WHERE a.delegate_id = p_delegate_id
    ORDER BY a.synced_at ASC LIMIT 1;
    RETURN jsonb_build_object(
      'success', true, 'is_duplicate_sync', false, 'already_checked_in', true, 'subject_kind', 'delegate',
      'checked_in_at', r_del.accommodation_checked_in_at,
      'athlete_id', r_del.id, 'sslc_name', COALESCE(r_del.full_name, v_role), 'usn', v_role,
      'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no, 'college_name', v_college, 'squad_code', '',
      'hostel_id', r_prev.hostel_id, 'hostel_name', r_prev.hostel_name, 'room_assigned', r_prev.room_assigned
    );
  END IF;

  SELECT id, name, gender, total_capacity INTO r_hostel FROM hostels WHERE id = p_hostel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick the hostel in the app and scan again.';
  END IF;
  -- Gender is optional on a pass: check it only when it is known
  IF (r_del.gender = 'MALE' AND LOWER(r_hostel.gender) = 'women')
     OR (r_del.gender = 'FEMALE' AND LOWER(r_hostel.gender) = 'men') THEN
    RAISE EXCEPTION 'Gender mismatch: % is a % hostel.', r_hostel.name, LOWER(r_hostel.gender);
  END IF;

  UPDATE delegates
  SET accommodation_checked_in = TRUE,
      accommodation_checked_in_at = COALESCE(accommodation_checked_in_at, COALESCE(p_device_timestamp, now()))
  WHERE id = p_delegate_id;

  INSERT INTO delegate_accommodation_scans (client_scan_uuid, delegate_id, hostel_id, scanned_by, room_assigned, device_timestamp)
  VALUES (p_client_uuid, p_delegate_id, p_hostel_id, p_warden_id,
          COALESCE(NULLIF(p_room_assigned, ''), 'General Dorm'),
          COALESCE(p_device_timestamp, timezone('utc'::text, now())));

  RETURN jsonb_build_object(
    'success', true, 'is_duplicate_sync', false, 'already_checked_in', false, 'subject_kind', 'delegate',
    'athlete_id', r_del.id, 'sslc_name', COALESCE(r_del.full_name, v_role), 'usn', v_role,
    'bid_number', r_del.pass_no, 'pass_no', r_del.pass_no, 'college_name', v_college, 'squad_code', '',
    'hostel_id', r_hostel.id, 'hostel_name', r_hostel.name,
    'room_assigned', COALESCE(NULLIF(p_room_assigned, ''), 'General Dorm'),
    'caution_deposit', 0, 'caution_receipt_no', '',
    'total_capacity', r_hostel.total_capacity
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Kitchen counts include the faculty / officials fed
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_meal_stats(p_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_date DATE := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_breakfast INT := 0;
  v_lunch INT := 0;
  v_snacks INT := 0;
  v_dinner INT := 0;
  d_breakfast INT := 0;
  d_lunch INT := 0;
  d_snacks INT := 0;
  d_dinner INT := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE meal_type = 'BREAKFAST'),
    COUNT(*) FILTER (WHERE meal_type = 'LUNCH'),
    COUNT(*) FILTER (WHERE meal_type = 'SNACKS'),
    COUNT(*) FILTER (WHERE meal_type = 'DINNER')
  INTO v_breakfast, v_lunch, v_snacks, v_dinner
  FROM meal_logs WHERE meal_date = v_date;

  SELECT
    COUNT(*) FILTER (WHERE meal_type = 'BREAKFAST'),
    COUNT(*) FILTER (WHERE meal_type = 'LUNCH'),
    COUNT(*) FILTER (WHERE meal_type = 'SNACKS'),
    COUNT(*) FILTER (WHERE meal_type = 'DINNER')
  INTO d_breakfast, d_lunch, d_snacks, d_dinner
  FROM delegate_meal_logs WHERE meal_date = v_date;

  RETURN jsonb_build_object(
    'date', v_date,
    'breakfast_served', v_breakfast + d_breakfast,
    'lunch_served', v_lunch + d_lunch,
    'snacks_served', v_snacks + d_snacks,
    'dinner_served', v_dinner + d_dinner,
    'total_meals_today', (v_breakfast + v_lunch + v_snacks + v_dinner + d_breakfast + d_lunch + d_snacks + d_dinner),
    'athlete_meals_today', (v_breakfast + v_lunch + v_snacks + v_dinner),
    'delegate_meals_today', (d_breakfast + d_lunch + d_snacks + d_dinner)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. Keep the new tables closed to the public API keys (0036)
-- -----------------------------------------------------------------------------
ALTER TABLE delegates ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegate_meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegate_accommodation_scans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON delegates, delegate_meal_logs, delegate_accommodation_scans TO service_role;
    GRANT ALL ON SEQUENCE delegate_pass_no_seq TO service_role;
  END IF;
  REVOKE EXECUTE ON FUNCTION scan_meal_coupon(TEXT, UUID, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION process_accreditation_scan(UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION get_meal_stats(DATE) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION process_delegate_accommodation_checkin(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION check_in_college(UUID, TEXT) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION scan_meal_coupon(TEXT, UUID, TEXT, UUID, TIMESTAMPTZ) TO service_role;
    GRANT EXECUTE ON FUNCTION process_accreditation_scan(UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;
    GRANT EXECUTE ON FUNCTION get_meal_stats(DATE) TO service_role;
    GRANT EXECUTE ON FUNCTION process_delegate_accommodation_checkin(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;
    GRANT EXECUTE ON FUNCTION check_in_college(UUID, TEXT) TO service_role;
  END IF;
END $$;

COMMIT;
