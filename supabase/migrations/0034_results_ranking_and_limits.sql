-- ==============================================================================
-- Migration: 0034_results_ranking_and_limits.sql
-- Description: Correct places, medals and points on event day.
--   1. Impossible results are refused: a track time faster than any world record
--      (or more than 5x that), a throw/jump/bar height beyond the world record
--      (audit P7, P8).
--   2. Ties share the place: equal track times, identical field series and
--      identical high-jump records get the same rank (audit P1, P4). A shared
--      place gets the points of the places it covers, split equally (e.g. two
--      athletes tied for 2nd get (3 + 1) / 2 = 2 each); the next place is skipped.
--   3. A track final run in several sections is ranked by time across all
--      sections (audit P2). allocate_event_points refuses a heat that is not a
--      FINAL of that event.
--   4. Editing a result after the points were awarded recalculates them
--      (audit P3).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Plausibility limits
-- ------------------------------------------------------------------------------
-- Fastest possible time (s) for a track / road event, just under the world records.
CREATE OR REPLACE FUNCTION event_min_time_seconds(p_code TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE regexp_replace(upper(p_code), '-(M|W|MIX)$', '')
    WHEN '100M'   THEN 9.0
    WHEN '200M'   THEN 18.5
    WHEN '400M'   THEN 42.0
    WHEN '100H'   THEN 12.0
    WHEN '110H'   THEN 12.5
    WHEN '400H'   THEN 45.0
    WHEN '800M'   THEN 98.0
    WHEN '1500M'  THEN 200.0
    WHEN '5000M'  THEN 740.0
    WHEN '10000M' THEN 1560.0
    WHEN 'HM'     THEN 3300.0
    WHEN '4X100M' THEN 36.0
    WHEN '4X400M' THEN 170.0
    ELSE NULL
  END
$$;

-- Longest / highest possible mark (m) for a field event, just over the world records.
CREATE OR REPLACE FUNCTION event_max_mark_meters(p_code TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE regexp_replace(upper(p_code), '-(M|W|MIX)$', '')
    WHEN 'SP' THEN 24.0
    WHEN 'DT' THEN 78.0
    WHEN 'HT' THEN 88.0
    WHEN 'JT' THEN 99.0
    WHEN 'LJ' THEN 9.0
    WHEN 'TJ' THEN 18.5
    WHEN 'HJ' THEN 2.5
    WHEN 'PV' THEN 6.5
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION trg_check_track_time()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code TEXT;
  v_name TEXT;
  v_min NUMERIC;
BEGIN
  IF NEW.status <> 'FINISHED' OR NEW.time_seconds IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT e.code, e.name INTO v_code, v_name
  FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id JOIN events e ON e.id = h.event_id
  WHERE ha.id = NEW.heat_athlete_id;
  v_min := event_min_time_seconds(v_code);
  IF v_min IS NOT NULL AND (NEW.time_seconds < v_min OR NEW.time_seconds > v_min * 5) THEN
    RAISE EXCEPTION 'A time of % s is not possible for %. Check the entry (allowed: % to % s).',
      NEW.time_seconds, v_name, v_min, v_min * 5;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_results_plausible ON track_results;
CREATE TRIGGER trg_track_results_plausible
  BEFORE INSERT OR UPDATE ON track_results
  FOR EACH ROW EXECUTE FUNCTION trg_check_track_time();

CREATE OR REPLACE FUNCTION trg_check_field_mark()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code TEXT;
  v_name TEXT;
  v_max NUMERIC;
  v_mark NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'field_attempts' THEN
    v_mark := NEW.mark_meters;
  ELSE
    v_mark := NEW.bar_height_meters;
  END IF;
  IF v_mark IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT e.code, e.name INTO v_code, v_name
  FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id JOIN events e ON e.id = h.event_id
  WHERE ha.id = NEW.heat_athlete_id;
  v_max := event_max_mark_meters(v_code);
  IF v_max IS NOT NULL AND v_mark > v_max THEN
    RAISE EXCEPTION 'A mark of % m is not possible for %. Check the entry (at most % m).',
      v_mark, v_name, v_max;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_field_attempts_plausible ON field_attempts;
CREATE TRIGGER trg_field_attempts_plausible
  BEFORE INSERT OR UPDATE ON field_attempts
  FOR EACH ROW EXECUTE FUNCTION trg_check_field_mark();

DROP TRIGGER IF EXISTS trg_vertical_attempts_plausible ON vertical_jump_attempts;
CREATE TRIGGER trg_vertical_attempts_plausible
  BEFORE INSERT OR UPDATE ON vertical_jump_attempts
  FOR EACH ROW EXECUTE FUNCTION trg_check_field_mark();

-- ------------------------------------------------------------------------------
-- 2. Shared places: one row per placed athlete / team instead of one per place
-- ------------------------------------------------------------------------------
ALTER TABLE team_points DROP CONSTRAINT IF EXISTS uq_event_place;
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_points_event_profile
  ON team_points (event_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_points_event_relay
  ON team_points (event_id, relay_team_id) WHERE relay_team_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. Field standings with true ties
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_field_standings(p_heat_id UUID)
RETURNS JSONB AS $$
DECLARE
  r_event RECORD;
  v_standings JSONB;
BEGIN
  SELECT e.id, e.name, e.category INTO r_event
  FROM heats h JOIN events e ON h.event_id = e.id
  WHERE h.id = p_heat_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Heat not found.';
  END IF;

  IF r_event.category = 'field_vertical_jump' THEN
    -- High Jump / Pole Vault countback: highest cleared, fewest attempts at that
    -- height, fewest failures up to it. Equal on all three = shared place.
    WITH athlete_cleared AS (
      SELECT ha.id AS heat_athlete_id, p.id AS profile_id, p.sslc_name, p.usn, p.bid_number,
             c.name AS college_name, c.code AS college_code,
             MAX(vja.bar_height_meters) FILTER (WHERE vja.result = 'O') AS max_cleared_height
      FROM heat_athletes ha
      JOIN profiles p ON ha.profile_id = p.id
      JOIN squads s ON p.squad_id = s.id
      JOIN colleges c ON s.college_id = c.id
      LEFT JOIN vertical_jump_attempts vja ON ha.id = vja.heat_athlete_id
      WHERE ha.heat_id = p_heat_id
      GROUP BY ha.id, p.id, p.sslc_name, p.usn, p.bid_number, c.name, c.code
    ),
    athlete_countback AS (
      SELECT ac.*,
        COALESCE((SELECT MIN(vja.attempt_number) FROM vertical_jump_attempts vja
                  WHERE vja.heat_athlete_id = ac.heat_athlete_id
                    AND vja.bar_height_meters = ac.max_cleared_height AND vja.result = 'O'), 99)
          AS attempts_at_winning_height,
        COALESCE((SELECT COUNT(*) FROM vertical_jump_attempts vja
                  WHERE vja.heat_athlete_id = ac.heat_athlete_id AND vja.result = 'X'
                    AND (ac.max_cleared_height IS NULL OR vja.bar_height_meters <= ac.max_cleared_height)), 0)
          AS total_failures
      FROM athlete_cleared ac
    ),
    ranked_vertical AS (
      SELECT RANK() OVER (ORDER BY max_cleared_height DESC NULLS LAST,
                                   attempts_at_winning_height ASC,
                                   total_failures ASC) AS rank, *
      FROM athlete_countback
    )
    SELECT jsonb_agg(jsonb_build_object(
             'rank', rank, 'heat_athlete_id', heat_athlete_id, 'profile_id', profile_id,
             'bid_number', bid_number, 'sslc_name', sslc_name, 'usn', usn,
             'college_name', college_name, 'college_code', college_code,
             'best_mark', max_cleared_height, 'attempts_at_best', attempts_at_winning_height,
             'total_failures', total_failures)
           ORDER BY rank, sslc_name)
    INTO v_standings
    FROM ranked_vertical;

  ELSE
    -- Throws & horizontal jumps: best mark, then 2nd best, 3rd best ... (the whole
    -- series). Identical series = shared place.
    WITH athlete_marks AS (
      SELECT ha.id AS heat_athlete_id, p.id AS profile_id, p.sslc_name, p.usn, p.bid_number,
             c.name AS college_name, c.code AS college_code,
             MAX(fa.mark_meters) FILTER (WHERE fa.attempt_type = 'VALID') AS best_mark,
             array_agg(fa.mark_meters ORDER BY fa.mark_meters DESC) FILTER (WHERE fa.attempt_type = 'VALID') AS all_marks
      FROM heat_athletes ha
      JOIN profiles p ON ha.profile_id = p.id
      JOIN squads s ON p.squad_id = s.id
      JOIN colleges c ON s.college_id = c.id
      LEFT JOIN field_attempts fa ON ha.id = fa.heat_athlete_id
      WHERE ha.heat_id = p_heat_id
      GROUP BY ha.id, p.id, p.sslc_name, p.usn, p.bid_number, c.name, c.code
    ),
    ranked_horizontal AS (
      SELECT RANK() OVER (ORDER BY best_mark DESC NULLS LAST, all_marks DESC NULLS LAST) AS rank, *
      FROM athlete_marks
    )
    SELECT jsonb_agg(jsonb_build_object(
             'rank', rank, 'heat_athlete_id', heat_athlete_id, 'profile_id', profile_id,
             'bid_number', bid_number, 'sslc_name', sslc_name, 'usn', usn,
             'college_name', college_name, 'college_code', college_code,
             'best_mark', best_mark, 'second_best_mark', all_marks[2])
           ORDER BY rank, sslc_name)
    INTO v_standings
    FROM ranked_horizontal;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'heat_id', p_heat_id,
    'event_name', r_event.name,
    'category', r_event.category,
    'standings', COALESCE(v_standings, '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 4. Points: across all sections of the final, ties share
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION allocate_event_points(
  p_event_id UUID,
  p_heat_id UUID
)
RETURNS JSONB AS $$
DECLARE
  r_event RECORD;
  v_pts NUMERIC[];
  v_is_relay BOOLEAN;
  v_is_mixed BOOLEAN;
  v_count INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('allocate_event_points_' || p_event_id::text));

  SELECT id, name, code, category INTO r_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM heats WHERE id = p_heat_id AND event_id = p_event_id AND stage = 'FINAL') THEN
    RAISE EXCEPTION 'Points are awarded only from a FINAL of %.', r_event.name;
  END IF;

  v_is_mixed := upper(r_event.code) = '4X400M-MIX';
  v_is_relay := r_event.category = 'relay';
  IF v_is_mixed THEN
    v_pts := ARRAY[0.0, 0.0, 0.0];      -- Mixed relay: counts for neither championship
  ELSIF v_is_relay THEN
    v_pts := ARRAY[10.0, 6.0, 2.0];     -- 4x100m / 4x400m: overall championship only
  ELSE
    v_pts := ARRAY[5.0, 3.0, 1.0];      -- Individual events
  END IF;

  DELETE FROM team_points WHERE event_id = p_event_id;

  IF r_event.category LIKE 'field%' THEN
    WITH st AS (
      SELECT (i->>'rank')::INTEGER AS place, (i->>'profile_id')::UUID AS profile_id
      FROM jsonb_array_elements(compute_field_standings(p_heat_id)->'standings') AS i
      WHERE (i->>'best_mark') IS NOT NULL
    ), placed AS (
      SELECT st.*, COUNT(*) OVER (PARTITION BY place) AS tied FROM st
    )
    INSERT INTO team_points (event_id, heat_id, college_id, squad_id, profile_id, place, points)
    SELECT p_event_id, p_heat_id, s.college_id, s.id, pl.profile_id, pl.place,
           (SELECT COALESCE(SUM(v_pts[k]), 0) FROM generate_series(pl.place, pl.place + pl.tied::INT - 1) k
             WHERE k <= array_length(v_pts, 1)) / pl.tied
    FROM placed pl
    JOIN profiles p ON p.id = pl.profile_id
    JOIN squads s ON s.id = p.squad_id
    WHERE pl.place <= 3;
  ELSE
    WITH f AS (
      SELECT ha.heat_id, ha.profile_id, ha.relay_team_id,
             COALESCE(p.squad_id, rt.squad_id) AS squad_id,
             COALESCE(sp.college_id, srt.college_id) AS college_id,
             tr.time_seconds
      FROM heats h
      JOIN heat_athletes ha ON ha.heat_id = h.id
      JOIN track_results tr ON tr.heat_athlete_id = ha.id
      LEFT JOIN profiles p ON ha.profile_id = p.id
      LEFT JOIN squads sp ON p.squad_id = sp.id
      LEFT JOIN relay_teams rt ON ha.relay_team_id = rt.id
      LEFT JOIN squads srt ON rt.squad_id = srt.id
      WHERE h.event_id = p_event_id AND h.stage = 'FINAL'
        AND tr.status = 'FINISHED' AND tr.time_seconds IS NOT NULL
    ), placed AS (
      SELECT f.*, RANK() OVER (ORDER BY time_seconds) AS place,
             COUNT(*) OVER (PARTITION BY time_seconds) AS tied
      FROM f
    )
    INSERT INTO team_points (event_id, heat_id, college_id, squad_id, profile_id, relay_team_id, place, points)
    SELECT p_event_id, pl.heat_id, pl.college_id, pl.squad_id, pl.profile_id, pl.relay_team_id, pl.place,
           (SELECT COALESCE(SUM(v_pts[k]), 0) FROM generate_series(pl.place::INT, (pl.place + pl.tied - 1)::INT) k
             WHERE k <= array_length(v_pts, 1)) / pl.tied
    FROM placed pl
    WHERE pl.place <= 3 AND pl.squad_id IS NOT NULL;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'event_id', p_event_id,
    'heat_id', p_heat_id,
    'placers_awarded', v_count,
    'is_relay', v_is_relay,
    'is_mixed_relay', v_is_mixed,
    'counts_for', CASE
      WHEN v_is_mixed THEN 'none'
      WHEN v_is_relay THEN 'overall_only'
      ELSE 'individual_and_team'
    END
  );
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 5. A result edited after the points were awarded recalculates them
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_recalc_points_on_result_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_ha UUID := COALESCE(NEW.heat_athlete_id, OLD.heat_athlete_id);
  v_heat RECORD;
BEGIN
  SELECT h.id, h.event_id, h.stage INTO v_heat
  FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id
  WHERE ha.id = v_ha;
  IF FOUND AND v_heat.stage = 'FINAL'
     AND EXISTS (SELECT 1 FROM team_points WHERE event_id = v_heat.event_id) THEN
    PERFORM allocate_event_points(v_heat.event_id, v_heat.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_results_recalc ON track_results;
CREATE TRIGGER trg_track_results_recalc
  AFTER INSERT OR UPDATE OR DELETE ON track_results
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_points_on_result_change();

DROP TRIGGER IF EXISTS trg_field_attempts_recalc ON field_attempts;
CREATE TRIGGER trg_field_attempts_recalc
  AFTER INSERT OR UPDATE OR DELETE ON field_attempts
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_points_on_result_change();

DROP TRIGGER IF EXISTS trg_vertical_attempts_recalc ON vertical_jump_attempts;
CREATE TRIGGER trg_vertical_attempts_recalc
  AFTER INSERT OR UPDATE OR DELETE ON vertical_jump_attempts
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_points_on_result_change();

-- ------------------------------------------------------------------------------
-- 6. Recalculate points already awarded under the old rules
-- ------------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (tp.event_id) tp.event_id, h.id AS heat_id
    FROM team_points tp
    JOIN heats h ON h.event_id = tp.event_id AND h.stage = 'FINAL'
    ORDER BY tp.event_id, h.heat_number
  LOOP
    PERFORM allocate_event_points(r.event_id, r.heat_id);
  END LOOP;
END $$;
