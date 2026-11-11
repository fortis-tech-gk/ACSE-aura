-- =============================================================================
-- Admin password reset — vtu.meetdirector and sports@vtu.ac.in
-- Sets NEW passwords (only bcrypt hashes here; plaintext is in ~/vtu-admin-logins.txt on
-- the organiser's computer), re-activates both accounts and clears admin login lockouts.
-- Run the whole file once in the Supabase SQL editor. Safe to re-run.
-- =============================================================================

BEGIN;

UPDATE staff
   SET password_hash = '$2a$12$9NOu3gkYpVG5mDjXvXLCteZchqI4W.dd2dPbk97fGXqcI.5N5Y.MS',
       pin_hash = NULL,
       role = 'meet_admin',
       is_active = TRUE
 WHERE username = 'vtu.meetdirector';

UPDATE staff
   SET password_hash = '$2a$12$uFGCuAbIzDyNhJkbl9ACZuEunD.8m0tPVRtAM17ZP45Ife1dVnpBO',
       pin_hash = NULL,
       role = 'meet_admin',
       is_active = TRUE
 WHERE username = 'sports@vtu.ac.in';

-- Clear any 15-minute lockouts from earlier wrong attempts on the admin login
DELETE FROM login_attempts WHERE scope = 'admin';

COMMIT;

SELECT username, role, is_active, password_hash IS NOT NULL AS has_password
FROM staff
WHERE username IN ('vtu.meetdirector', 'sports@vtu.ac.in');
