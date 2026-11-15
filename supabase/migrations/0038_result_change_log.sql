-- ==============================================================================
-- Migration: 0038_result_change_log.sql
-- Description: Every change to a result after it was first entered is logged
--   (audit #20): track times / statuses (e.g. DNS later given a time), field
--   attempts and high-jump / pole-vault attempts. Each row keeps the old and
--   new values, who saved the change (recorded_by) and when. Useful for appeals.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS result_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                -- track_results | field_attempts | vertical_jump_attempts
  action TEXT NOT NULL CHECK (action IN ('UPDATE', 'DELETE')),
  heat_athlete_id UUID,
  heat_id UUID,
  event_id UUID,
  old_values JSONB NOT NULL,
  new_values JSONB,
  changed_by UUID,                     -- staff who saved the new value (NULL for deletes)
  changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_result_changes_heat ON result_changes (heat_id);
CREATE INDEX IF NOT EXISTS idx_result_changes_event ON result_changes (event_id);
ALTER TABLE result_changes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION trg_log_result_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_old JSONB := to_jsonb(OLD) - 'created_at' - 'recorded_by' - 'id';
  v_new JSONB;
  v_heat UUID;
  v_event UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_new := to_jsonb(NEW) - 'created_at' - 'recorded_by' - 'id';
    IF v_new = v_old THEN
      RETURN NULL; -- same value re-sent (e.g. an offline retry): nothing changed
    END IF;
  END IF;

  SELECT h.id, h.event_id INTO v_heat, v_event
  FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id
  WHERE ha.id = OLD.heat_athlete_id;

  INSERT INTO result_changes (source, action, heat_athlete_id, heat_id, event_id, old_values, new_values, changed_by)
  VALUES (TG_TABLE_NAME, TG_OP, OLD.heat_athlete_id, v_heat, v_event, v_old, v_new,
          CASE WHEN TG_OP = 'UPDATE' THEN NEW.recorded_by END);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_results_log ON track_results;
CREATE TRIGGER trg_track_results_log
  AFTER UPDATE OR DELETE ON track_results
  FOR EACH ROW EXECUTE FUNCTION trg_log_result_change();

DROP TRIGGER IF EXISTS trg_field_attempts_log ON field_attempts;
CREATE TRIGGER trg_field_attempts_log
  AFTER UPDATE OR DELETE ON field_attempts
  FOR EACH ROW EXECUTE FUNCTION trg_log_result_change();

DROP TRIGGER IF EXISTS trg_vertical_attempts_log ON vertical_jump_attempts;
CREATE TRIGGER trg_vertical_attempts_log
  AFTER UPDATE OR DELETE ON vertical_jump_attempts
  FOR EACH ROW EXECUTE FUNCTION trg_log_result_change();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON result_changes TO service_role;
  END IF;
END $$;
