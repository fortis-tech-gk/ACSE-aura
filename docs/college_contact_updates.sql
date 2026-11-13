-- =============================================================================
-- College contact e-mail updates (requested by the Organising Secretary)
-- Run in the Supabase SQL editor. Safe to re-run. Passphrases are NOT changed.
--
--   SRINIT — Srinivas Institute of Technology, Valachil, Mangaluru (VTU code 4SN)
--            principal e-mail: principalsit@srinivasgroup.com   (13-11-2026)
--
-- Principal e-mail -> colleges.principal_email (only if migration 0025 is applied).
-- Squad PED e-mail -> filled only where the college has not entered its own PED e-mail.
-- =============================================================================

-- PART 1 — PREVIEW (read-only)
SELECT c.code, c.name, s.squad_code, s.ped_email
FROM colleges c LEFT JOIN squads s ON s.college_id = c.id
WHERE c.code IN ('SRINIT')
ORDER BY s.squad_code;


-- PART 2 — APPLY
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM colleges WHERE code = 'SRINIT') THEN
    RAISE EXCEPTION 'College SRINIT not found.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'colleges' AND column_name = 'principal_email'
  ) THEN
    EXECUTE $q$UPDATE colleges SET principal_email = 'principalsit@srinivasgroup.com' WHERE code = 'SRINIT'$q$;
  END IF;
END $$;

UPDATE squads s
   SET ped_email = 'principalsit@srinivasgroup.com'
  FROM colleges c
 WHERE s.college_id = c.id
   AND c.code = 'SRINIT'
   AND (s.ped_email IS NULL OR btrim(s.ped_email) = '');

COMMIT;

SELECT c.code, c.name, s.squad_code, s.ped_email
FROM colleges c JOIN squads s ON s.college_id = c.id
WHERE c.code IN ('SRINIT')
ORDER BY s.squad_code;
