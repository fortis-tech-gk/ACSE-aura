-- Removes ALL load-test data created by seed-loadtest.sql (cascades to registrations etc.).
BEGIN;
DELETE FROM login_attempts WHERE scope = 'athlete' AND key ~ '^9[0-9]{4}$';
DELETE FROM device_push_tokens WHERE profile_id IN (SELECT p.id FROM profiles p JOIN squads s ON s.id = p.squad_id WHERE s.college_id = '00000000-0000-0000-0000-00000000f001');
DELETE FROM registrations WHERE profile_id IN (SELECT p.id FROM profiles p JOIN squads s ON s.id = p.squad_id WHERE s.college_id = '00000000-0000-0000-0000-00000000f001');
DELETE FROM profiles WHERE squad_id IN (SELECT id FROM squads WHERE college_id = '00000000-0000-0000-0000-00000000f001');
DELETE FROM squads WHERE college_id = '00000000-0000-0000-0000-00000000f001';
DELETE FROM colleges WHERE id = '00000000-0000-0000-0000-00000000f001';
COMMIT;
