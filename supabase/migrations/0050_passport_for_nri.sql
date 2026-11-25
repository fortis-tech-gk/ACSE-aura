-- NRI / foreign students without an Aadhaar register with their passport number, stored in the
-- same profiles.aadhaar_number column (it stays the championship-wide unique identity key).
-- A 12-digit numeric value is an Aadhaar; 6–15 upper-case letters/digits is a passport number.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_aadhaar_format_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_aadhaar_format_check
  CHECK (aadhaar_number IS NULL OR aadhaar_number ~ '^[0-9]{12}$' OR aadhaar_number ~ '^[A-Z0-9]{6,15}$') NOT VALID;
