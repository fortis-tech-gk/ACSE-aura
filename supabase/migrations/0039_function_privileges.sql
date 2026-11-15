-- ==============================================================================
-- Migration: 0039_function_privileges.sql
-- Description: Follow-up to 0036. New functions are executable by PUBLIC by
--   PostgreSQL's built-in default, and a schema-level ALTER DEFAULT PRIVILEGES
--   (as in 0036) cannot remove a built-in default — only the global form can.
--   So functions created after 0036 (e.g. the reserve swap in 0037) were callable
--   with the anon key (harmless — anon has no table access — but not intended).
--   This revokes PUBLIC / anon / authenticated EXECUTE on every function in
--   public again and removes the PUBLIC default for functions created later.
--   service_role keeps EXECUTE. Safe to re-run.
-- ==============================================================================

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
  END IF;
END $$;
