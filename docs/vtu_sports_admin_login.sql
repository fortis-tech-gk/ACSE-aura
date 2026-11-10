-- =============================================================================
-- VTU Sports Office — logins for sports@vtu.ac.in
--   A) Admin login        : username sports@vtu.ac.in, role meet_admin (Meet Director)
--   B) College squad login: college code VTU, Men's (VTU-M) and Women's (VTU-G) squads,
--                           PED email sports@vtu.ac.in
-- Passwords / passphrases are NOT in this file — only its bcrypt hash (cost 12). The plaintext
-- password was handed over separately.
--
-- HOW TO USE IN THE SUPABASE SQL EDITOR
--   1. Run PART 1 (read-only) to see whether this login already exists.
--   2. Run PART 2. It creates the login, or — if it already exists — resets its password,
--      makes it a Meet Director and re-activates it. Re-running is safe.
-- =============================================================================

-- PART 1 — PREVIEW (read-only)
SELECT username, display_name, role, is_active
FROM staff
WHERE username = 'sports@vtu.ac.in';


-- PART 2 — APPLY
INSERT INTO staff (username, password_hash, pin_hash, display_name, role, is_active)
VALUES (
  'sports@vtu.ac.in',
  '$2a$12$Cph6TxwUcYZYuhDYbedQDO4bj1q7/QQTg4cryKvhsY57YRBpxcqXe',
  NULL,
  'VTU Directorate of Physical Education & Sports',
  'meet_admin',
  TRUE
)
ON CONFLICT (username) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      pin_hash      = NULL,
      display_name  = EXCLUDED.display_name,
      role          = 'meet_admin',
      is_active     = TRUE;

SELECT username, display_name, role, is_active FROM staff WHERE username = 'sports@vtu.ac.in';


-- =============================================================================
-- B) VTU college squad logins (Institutional Student Registration Portal)
--    College code VTU • Men's squad VTU-M • Women's squad VTU-G
--    Only bcrypt hashes (cost 10, same as the app) — passphrases handed over separately.
--    Re-running resets both passphrases to these values. Existing athletes/payments are kept.
-- =============================================================================

-- PART 1 — PREVIEW (read-only)
SELECT c.code, c.name, s.squad_code, s.gender, s.ped_email
FROM colleges c LEFT JOIN squads s ON s.college_id = c.id
WHERE c.code = 'VTU';

-- PART 2 — APPLY
BEGIN;

INSERT INTO colleges (name, code, district)
VALUES ('VTU Directorate of Physical Education & Sports', 'VTU', 'Belagavi')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, district = EXCLUDED.district;

INSERT INTO squads (college_id, gender, squad_code, passphrase_hash, ped_email)
SELECT id, 'men', 'VTU-M', '$2a$10$Nmw7LCFFpiT65o0AwJxJpe9GMFAPvtz4reKZPUCOL2bf04.B7w6Ai', 'sports@vtu.ac.in' FROM colleges WHERE code = 'VTU'
ON CONFLICT (college_id, gender) DO UPDATE
  SET squad_code = EXCLUDED.squad_code, passphrase_hash = EXCLUDED.passphrase_hash, ped_email = EXCLUDED.ped_email;

INSERT INTO squads (college_id, gender, squad_code, passphrase_hash, ped_email)
SELECT id, 'women', 'VTU-G', '$2a$10$2XLsvbDeV0.y.fZpz5txceb0.pb4pwUrRbjJFFQ/h6xCKRRhoeMay', 'sports@vtu.ac.in' FROM colleges WHERE code = 'VTU'
ON CONFLICT (college_id, gender) DO UPDATE
  SET squad_code = EXCLUDED.squad_code, passphrase_hash = EXCLUDED.passphrase_hash, ped_email = EXCLUDED.ped_email;

COMMIT;

SELECT c.code, c.name, s.squad_code, s.gender, s.ped_email
FROM colleges c JOIN squads s ON s.college_id = c.id
WHERE c.code = 'VTU'
ORDER BY s.gender;
