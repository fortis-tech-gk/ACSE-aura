-- =============================================================================
-- 0025: College principal details
--
-- The college's PED can now edit the college details from the contingent portal
-- (dashboard → "College Details"): college name plus the Principal's name, email
-- and contact number. Shared by the college's Men's and Women's squads.
--
-- Safe to re-run.
-- =============================================================================

BEGIN;

ALTER TABLE public.colleges
  ADD COLUMN IF NOT EXISTS principal_name TEXT,
  ADD COLUMN IF NOT EXISTS principal_email TEXT,
  ADD COLUMN IF NOT EXISTS principal_phone TEXT;

ALTER TABLE public.colleges DROP CONSTRAINT IF EXISTS colleges_principal_phone_check;
ALTER TABLE public.colleges ADD CONSTRAINT colleges_principal_phone_check
  CHECK (principal_phone IS NULL OR principal_phone ~ '^[0-9]{10,12}$');

COMMIT;

NOTIFY pgrst, 'reload schema';
