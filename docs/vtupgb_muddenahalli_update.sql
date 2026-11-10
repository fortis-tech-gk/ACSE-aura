-- =============================================================================
-- VTUPGB — Department of PG Studies, VTU, Muddenahalli (VTU code 1VW)
--   * College name  -> 'Department of PG Studies, VTU, Muddenahalli'
--   * Contact email -> vtucpgsb@gmail.com (PED email on both the Men's and Women's logins,
--                      and the Principal email if migration 0025 has been applied)
-- Passphrases are NOT changed — the college keeps using its existing VTUPGB passphrases.
--
-- HOW TO USE IN THE SUPABASE SQL EDITOR
--   1. Run PART 1 (read-only) to see the current values.
--   2. Run PART 2. Safe to re-run.
-- =============================================================================

-- PART 1 — PREVIEW (read-only)
SELECT c.code, c.name, c.district, s.squad_code, s.ped_email
FROM colleges c LEFT JOIN squads s ON s.college_id = c.id
WHERE c.code = 'VTUPGB'
ORDER BY s.squad_code;


-- PART 2 — APPLY
BEGIN;

UPDATE colleges
   SET name = 'Department of PG Studies, VTU, Muddenahalli'
 WHERE code = 'VTUPGB';

UPDATE squads s
   SET ped_email = 'vtucpgsb@gmail.com'
  FROM colleges c
 WHERE s.college_id = c.id
   AND c.code = 'VTUPGB';

-- Principal email column exists only after migration 0025 — update it when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'colleges' AND column_name = 'principal_email'
  ) THEN
    EXECUTE $q$UPDATE colleges SET principal_email = 'vtucpgsb@gmail.com' WHERE code = 'VTUPGB'$q$;
  END IF;
END $$;

-- Abort (and roll back) if the college does not exist yet — run the additions script first
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM colleges WHERE code = 'VTUPGB') THEN
    RAISE EXCEPTION 'College VTUPGB not found. Run supabase/migrations/college_credentials_2026-27_additions.sql first.';
  END IF;
END $$;

COMMIT;

SELECT c.code, c.name, s.squad_code, s.ped_email
FROM colleges c JOIN squads s ON s.college_id = c.id
WHERE c.code = 'VTUPGB'
ORDER BY s.squad_code;
