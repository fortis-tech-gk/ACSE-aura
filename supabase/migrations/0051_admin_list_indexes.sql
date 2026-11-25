-- Indexes for the paged admin lists (Athletes, ID Cards, Certificates, Amendments).
-- The admin Athletes page now reads one page at a time, newest first; these keep that order and
-- the common filters index-backed as the meet grows. Safe to run more than once.

-- Athletes Management: ORDER BY created_at DESC, id with LIMIT/OFFSET
CREATE INDEX IF NOT EXISTS idx_profiles_created_at_id ON public.profiles (created_at DESC, id);

-- Certificates: accredited-athlete count and participation list
CREATE INDEX IF NOT EXISTS idx_profiles_accreditation_status ON public.profiles (accreditation_status);

-- Roster Amendments log, newest first
CREATE INDEX IF NOT EXISTS idx_roster_amendments_created_at ON public.roster_amendments (created_at DESC);

-- Heats lists: ordered by created_at, results page filters finalized heats
CREATE INDEX IF NOT EXISTS idx_heats_status_created_at ON public.heats (status, created_at DESC);
