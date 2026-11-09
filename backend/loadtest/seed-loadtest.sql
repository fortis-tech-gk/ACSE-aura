-- =============================================================================
-- LOADTEST data: 1 college, 2 squads, N athletes (bibs 90000+, DOB 2004-01-01),
-- each with 2 events, for backend/loadtest/aura-athletes.k6.js.
-- Clearly marked (college code LOADTEST, USNs 9LT…, Aadhaar 9999…) so it can be removed
-- completely with cleanup-loadtest.sql. Run in the Supabase SQL editor.
-- =============================================================================
BEGIN;
INSERT INTO colleges (id, name, code, district)
VALUES ('00000000-0000-0000-0000-00000000f001', 'LOAD TEST — DELETE ME', 'LOADTEST', 'Test')
ON CONFLICT DO NOTHING;
INSERT INTO squads (id, college_id, gender, squad_code, passphrase_hash, payment_status, roster_locked)
VALUES ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-00000000f001', 'men', 'LOADTEST-M', 'x-not-a-login', 'VERIFIED', true),
       ('00000000-0000-0000-0000-00000000f0a2', '00000000-0000-0000-0000-00000000f001', 'women', 'LOADTEST-G', 'x-not-a-login', 'VERIFIED', true)
ON CONFLICT DO NOTHING;
INSERT INTO profiles (squad_id, sslc_name, usn, semester, blood_group, college_joining_date, sem_start_date, aadhaar_number, date_of_birth, bid_number, accreditation_status)
SELECT CASE WHEN g % 2 = 0 THEN '00000000-0000-0000-0000-00000000f0a1'::uuid ELSE '00000000-0000-0000-0000-00000000f0a2'::uuid END,
       'Load Test Athlete ' || g, '9LT22LT' || lpad(g::text, 4, '0'), 5, 'O+', '2022-08-01', '2025-08-01',
       '9999' || lpad(g::text, 8, '0'), '2004-01-01', 90000 + g, 'ACCREDITED'
FROM generate_series(0, 2999) g;
INSERT INTO registrations (profile_id, event_id, kind)
SELECT p.id, e.id, 'regular'
FROM profiles p JOIN squads s ON s.id = p.squad_id
JOIN events e ON e.code IN (CASE WHEN s.gender = 'men' THEN '100M-M' ELSE '100M-W' END, CASE WHEN s.gender = 'men' THEN '200M-M' ELSE '200M-W' END)
WHERE s.college_id = '00000000-0000-0000-0000-00000000f001';
COMMIT;
