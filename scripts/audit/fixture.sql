-- Audit fixture: 6 colleges (CA..CF) with men's and women's squads.
-- CF never pays (DRAFT). Every 3rd 100m athlete is only REGISTERED (not accredited).
-- Two athletes enter the 100m ONLY as reserves.
\set ON_ERROR_STOP 1

CREATE OR REPLACE FUNCTION audit_ev(c text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM events WHERE code = c $$;

CREATE OR REPLACE FUNCTION audit_sq(c text, g text DEFAULT 'men') RETURNS uuid LANGUAGE sql AS $$
  SELECT s.id FROM squads s JOIN colleges co ON co.id = s.college_id WHERE co.code = c AND s.gender = g $$;

CREATE OR REPLACE FUNCTION audit_athlete(p_squad uuid, p_name text, p_usn text, p_status text DEFAULT 'ACCREDITED')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO profiles (squad_id, sslc_name, usn, semester, blood_group, college_joining_date, sem_start_date,
                        accreditation_status, date_of_birth)
  VALUES (p_squad, p_name, p_usn, 5, 'O+', '2023-08-01', '2026-08-01', p_status, '2004-01-01')
  RETURNING id INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION audit_pid(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM profiles WHERE sslc_name = p_name $$;

-- Puts athletes (by name) into a new heat for an event, lanes in the given order.
CREATE OR REPLACE FUNCTION audit_heat(p_event text, p_stage text, p_no int, p_names text[], p_status text DEFAULT 'IN_PROGRESS')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE h uuid; i int;
BEGIN
  INSERT INTO heats (event_id, stage, heat_number, status) VALUES (audit_ev(p_event), p_stage, p_no, p_status) RETURNING id INTO h;
  FOR i IN 1..array_length(p_names, 1) LOOP
    INSERT INTO heat_athletes (heat_id, profile_id, lane_number) VALUES (h, audit_pid(p_names[i]), i);
  END LOOP;
  RETURN h;
END $$;

CREATE OR REPLACE FUNCTION audit_ha(p_heat uuid, p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM heat_athletes WHERE heat_id = p_heat AND profile_id = audit_pid(p_name) $$;

DO $$
DECLARE
  codes text[] := ARRAY['CA','CB','CC','CD','CE','CF'];
  c text; sq uuid; p uuid; i int; n int := 0;
BEGIN
  FOREACH c IN ARRAY codes LOOP
    PERFORM create_college_with_squads('College '||c, c, 'Bengaluru', 'x', 'x', 'PED '||c, '9000000000', c||'@ped.test');
    sq := audit_sq(c);
    FOR i IN 1..2 LOOP
      n := n + 1;
      p := audit_athlete(sq, c||' Runner '||i, '1AA23CS'||lpad(n::text,3,'0'),
                         CASE WHEN n % 3 = 0 THEN 'REGISTERED' ELSE 'ACCREDITED' END);
      INSERT INTO registrations (profile_id, event_id, kind) VALUES (p, audit_ev('100M-M'), 'regular');
    END LOOP;
    UPDATE squads SET payment_status = CASE WHEN c = 'CF' THEN 'DRAFT' ELSE 'VERIFIED' END WHERE college_id = (SELECT id FROM colleges WHERE code = c);
  END LOOP;

  FOREACH c IN ARRAY ARRAY['CA','CB'] LOOP
    n := n + 1;
    p := audit_athlete(audit_sq(c), c||' Reserve', '1AA23CS'||lpad(n::text,3,'0'));
    INSERT INTO registrations (profile_id, event_id, kind) VALUES (p, audit_ev('200M-M'), 'regular');
    INSERT INTO registrations (profile_id, event_id, kind) VALUES (p, audit_ev('100M-M'), 'reserve');
  END LOOP;

  -- Spare accredited, paid athletes for manual heats (no registrations needed)
  FOR i IN 1..12 LOOP
    PERFORM audit_athlete(audit_sq(codes[1 + (i - 1) % 5]), 'Spare '||i, '1AA23SP'||lpad(i::text,3,'0'));
  END LOOP;
  PERFORM audit_athlete(audit_sq('CA','women'), 'Woman W1', '1AA23WW001');
  PERFORM audit_athlete(audit_sq('CF'), 'Unpaid U1', '1AA23UP001', 'REGISTERED');
  PERFORM audit_athlete(audit_sq('CC'), 'Unaccredited N1', '1AA23NA001', 'REGISTERED');
END $$;
