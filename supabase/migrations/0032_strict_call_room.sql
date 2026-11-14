-- =============================================================================
-- 0032: Strict call room (athletics is discipline)
--
--   - heats.call_room_opened_at / call_room_closed_at: when the call room opened and closed.
--     The API uses them to refuse scans before opening, and to accept a scan sent late from an
--     offline call room tablet only if it was made before the close.
--   - heats.call_room_close_note: set when the call room was closed from a referee tablet with the
--     call room official's PIN (call room tablet offline).
--   - advance_heat_to_track records the close time (otherwise unchanged).
--
-- Safe to re-run. Existing heats keep their status; their timestamps stay empty.
-- =============================================================================

BEGIN;

ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS call_room_opened_at TIMESTAMPTZ;
ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS call_room_closed_at TIMESTAMPTZ;
ALTER TABLE public.heats ADD COLUMN IF NOT EXISTS call_room_close_note TEXT;

CREATE OR REPLACE FUNCTION advance_heat_to_track(
  p_heat_id UUID,
  p_official_id UUID
)
RETURNS JSONB AS $$
DECLARE
  r_heat RECORD;
  v_dns_count INTEGER := 0;
  v_reported_count INTEGER := 0;
  r_unreported RECORD;
BEGIN
  SELECT h.id, h.status INTO r_heat FROM heats h WHERE h.id = p_heat_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Heat not found.';
  END IF;

  SELECT COUNT(*) INTO v_reported_count
  FROM heat_athletes WHERE heat_id = p_heat_id AND call_room_reported = TRUE;

  -- Everyone who has not reported (and is not already scratched / disqualified) is DNS
  FOR r_unreported IN
    SELECT ha.id
    FROM heat_athletes ha
    LEFT JOIN call_room_inspections cri ON ha.id = cri.heat_athlete_id
    WHERE ha.heat_id = p_heat_id
      AND ha.call_room_reported = FALSE
      AND (cri.reported_status IS NULL OR cri.reported_status = 'REPORTED')
  LOOP
    INSERT INTO call_room_inspections (heat_athlete_id, inspected_by, reported_status, notes, inspected_at)
    VALUES (r_unreported.id, p_official_id, 'DNS', 'Did not report to the call room before it closed.', timezone('utc'::text, now()))
    ON CONFLICT (heat_athlete_id) DO UPDATE SET
      reported_status = 'DNS',
      notes = 'Did not report to the call room before it closed.',
      inspected_at = timezone('utc'::text, now());
    v_dns_count := v_dns_count + 1;
  END LOOP;

  UPDATE heats
  SET status = 'ON_TRACK',
      call_room_closed_at = timezone('utc'::text, now())
  WHERE id = p_heat_id;

  RETURN jsonb_build_object(
    'success', true,
    'heat_id', p_heat_id,
    'status', 'ON_TRACK',
    'reported_athletes', v_reported_count,
    'dns_athletes', v_dns_count
  );
END;
$$ LANGUAGE plpgsql;

COMMIT;

NOTIFY pgrst, 'reload schema';
