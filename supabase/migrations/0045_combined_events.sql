-- ==============================================================================
-- Migration: 0045_combined_events.sql
-- Description: Decathlon (DEC-M) and Heptathlon (HEP-W), scored with the World
--   Athletics combined-events tables:
--     track : points = floor(A * (B - P) ^ C)   P = time in seconds
--     field : points = floor(A * (P - B) ^ C)   P = cm (LJ, HJ, PV) or metres (throws)
--   1. combined_disciplines : the disciplines of each event, in running order,
--      with the A / B / C coefficients and the allowed range of a mark.
--   2. combined_results     : one mark (and its points) per athlete per discipline.
--   3. combined_points()    : the formula. submit_combined_result() saves a mark.
--   4. compute_combined_standings() : total points, ranking and the World
--      Athletics tie-break (more disciplines with the higher score wins).
--   5. allocate_event_points() also awards the championship points (5 / 3 / 1,
--      ties share) for a combined event.
-- Marks are entered in seconds (track) or metres (field, jumps too); the formula
-- converts jumps to cm itself (mark_scale = 100). Safe to re-run.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS combined_disciplines (
  event_code  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  day         INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('track', 'field')),
  unit        TEXT NOT NULL CHECK (unit IN ('s', 'm')),
  mark_scale  NUMERIC NOT NULL DEFAULT 1,
  a           NUMERIC NOT NULL,
  b           NUMERIC NOT NULL,
  c           NUMERIC NOT NULL,
  lo          NUMERIC NOT NULL,   -- smallest allowed mark (track: fastest possible time)
  hi          NUMERIC NOT NULL,   -- largest allowed mark
  PRIMARY KEY (event_code, code)
);

INSERT INTO combined_disciplines (event_code, seq, code, name, day, kind, unit, mark_scale, a, b, c, lo, hi) VALUES
  ('DEC-M',  1, '100M',  '100m',          1, 'track', 's', 1,   25.4347,  18,   1.81, 9.0,   45),
  ('DEC-M',  2, 'LJ',    'Long Jump',     1, 'field', 'm', 100, 0.14354,  220,  1.40, 0,     9.0),
  ('DEC-M',  3, 'SP',    'Shot Put',      1, 'field', 'm', 1,   51.39,    1.5,  1.05, 0,     24.0),
  ('DEC-M',  4, 'HJ',    'High Jump',     1, 'field', 'm', 100, 0.8465,   75,   1.42, 0,     2.5),
  ('DEC-M',  5, '400M',  '400m',          1, 'track', 's', 1,   1.53775,  82,   1.81, 42.0,  210),
  ('DEC-M',  6, '110H',  '110m Hurdles',  2, 'track', 's', 1,   5.74352,  28.5, 1.92, 12.5,  65),
  ('DEC-M',  7, 'DT',    'Discus Throw',  2, 'field', 'm', 1,   12.91,    4,    1.10, 0,     78),
  ('DEC-M',  8, 'PV',    'Pole Vault',    2, 'field', 'm', 100, 0.2797,   100,  1.35, 0,     6.5),
  ('DEC-M',  9, 'JT',    'Javelin Throw', 2, 'field', 'm', 1,   10.14,    7,    1.08, 0,     99),
  ('DEC-M', 10, '1500M', '1500m',         2, 'track', 's', 1,   0.03768,  480,  1.85, 200.0, 1000),
  ('HEP-W',  1, '100H',  '100m Hurdles',  1, 'track', 's', 1,   9.23076,  26.7, 1.835, 12.0, 60),
  ('HEP-W',  2, 'HJ',    'High Jump',     1, 'field', 'm', 100, 1.84523,  75,   1.348, 0,    2.5),
  ('HEP-W',  3, 'SP',    'Shot Put',      1, 'field', 'm', 1,   56.0211,  1.5,  1.05, 0,     24.0),
  ('HEP-W',  4, '200M',  '200m',          1, 'track', 's', 1,   4.99087,  42.5, 1.81, 18.5,  90),
  ('HEP-W',  5, 'LJ',    'Long Jump',     2, 'field', 'm', 100, 0.188807, 210,  1.41, 0,     9.0),
  ('HEP-W',  6, 'JT',    'Javelin Throw', 2, 'field', 'm', 1,   15.9803,  3.8,  1.04, 0,     99),
  ('HEP-W',  7, '800M',  '800m',          2, 'track', 's', 1,   0.11193,  254,  1.88, 98.0,  490)
ON CONFLICT (event_code, code) DO UPDATE SET
  seq = EXCLUDED.seq, name = EXCLUDED.name, day = EXCLUDED.day, kind = EXCLUDED.kind, unit = EXCLUDED.unit,
  mark_scale = EXCLUDED.mark_scale, a = EXCLUDED.a, b = EXCLUDED.b, c = EXCLUDED.c, lo = EXCLUDED.lo, hi = EXCLUDED.hi;

CREATE TABLE IF NOT EXISTS combined_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_athlete_id UUID NOT NULL REFERENCES heat_athletes(id) ON DELETE CASCADE,
  discipline      TEXT NOT NULL,
  mark            NUMERIC(9,3),
  status          TEXT NOT NULL DEFAULT 'FINISHED' CHECK (status IN ('FINISHED', 'NM', 'DNF', 'DQ', 'DNS')),
  points          INTEGER NOT NULL DEFAULT 0,
  recorded_by     UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_combined_result UNIQUE (heat_athlete_id, discipline),
  CONSTRAINT chk_combined_mark CHECK (
    (status = 'FINISHED' AND mark IS NOT NULL AND mark > 0) OR status <> 'FINISHED'
  )
);
CREATE INDEX IF NOT EXISTS idx_combined_results_ha ON combined_results (heat_athlete_id);
ALTER TABLE combined_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE combined_disciplines ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- The World Athletics formula
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION combined_points(p_event_code TEXT, p_discipline TEXT, p_mark NUMERIC)
RETURNS INTEGER LANGUAGE plpgsql STABLE AS $$
DECLARE
  d combined_disciplines%ROWTYPE;
  v_p NUMERIC;
  v_d NUMERIC;
BEGIN
  SELECT * INTO d FROM combined_disciplines WHERE event_code = upper(p_event_code) AND code = upper(p_discipline);
  IF NOT FOUND OR p_mark IS NULL OR p_mark <= 0 THEN
    RETURN 0;
  END IF;
  v_p := p_mark * d.mark_scale;
  v_d := CASE WHEN d.kind = 'track' THEN d.b - v_p ELSE v_p - d.b END;
  IF v_d <= 0 THEN
    RETURN 0;
  END IF;
  RETURN floor(d.a * power(v_d, d.c))::INTEGER;
END;
$$;

CREATE OR REPLACE FUNCTION submit_combined_result(
  p_heat_athlete_id UUID,
  p_discipline TEXT,
  p_mark NUMERIC DEFAULT NULL,
  p_status TEXT DEFAULT 'FINISHED',
  p_official_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_code TEXT;
  d combined_disciplines%ROWTYPE;
  v_mark NUMERIC := p_mark;
  v_pts INTEGER := 0;
BEGIN
  SELECT e.code INTO v_code
  FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id JOIN events e ON e.id = h.event_id
  WHERE ha.id = p_heat_athlete_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Entry not found.';
  END IF;
  SELECT * INTO d FROM combined_disciplines WHERE event_code = upper(v_code) AND code = upper(p_discipline);
  IF NOT FOUND THEN
    RAISE EXCEPTION '% is not a discipline of %.', p_discipline, v_code;
  END IF;
  IF p_status NOT IN ('FINISHED', 'NM', 'DNF', 'DQ', 'DNS') THEN
    RAISE EXCEPTION 'Unknown status %.', p_status;
  END IF;

  IF p_status = 'FINISHED' THEN
    IF v_mark IS NULL OR v_mark <= 0 THEN
      RAISE EXCEPTION 'A mark is required.';
    END IF;
    IF v_mark < d.lo OR v_mark > d.hi THEN
      RAISE EXCEPTION 'A mark of % is not possible for % (allowed % to %). Check the entry.', v_mark, d.name, d.lo, d.hi;
    END IF;
    -- Field marks are measured in whole centimetres, rounded down
    IF d.kind = 'field' THEN
      v_mark := floor(v_mark * 100) / 100;
    ELSE
      v_mark := ceil(v_mark * 100) / 100;
    END IF;
    v_pts := combined_points(v_code, p_discipline, v_mark);
  ELSE
    v_mark := NULL;
  END IF;

  INSERT INTO combined_results (heat_athlete_id, discipline, mark, status, points, recorded_by)
  VALUES (p_heat_athlete_id, d.code, v_mark, p_status, v_pts, p_official_id)
  ON CONFLICT (heat_athlete_id, discipline) DO UPDATE SET
    mark = EXCLUDED.mark, status = EXCLUDED.status, points = EXCLUDED.points,
    recorded_by = EXCLUDED.recorded_by, updated_at = timezone('utc'::text, now());

  RETURN jsonb_build_object('success', true, 'discipline', d.code, 'status', p_status, 'mark', v_mark, 'points', v_pts);
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- Standings of a combined event (all its heats together)
--   classified : a result in EVERY discipline, none of them DNS / DNF / DQ
--                (NM = no valid mark scores 0 and the athlete stays in)
--   rank       : highest total; on equal totals the athlete with the higher score
--                in more disciplines wins; still equal = shared place
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_combined_standings(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_code TEXT;
  v_n INTEGER;
  v_out JSONB;
BEGIN
  SELECT upper(code) INTO v_code FROM events WHERE id = p_event_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;
  SELECT COUNT(*) INTO v_n FROM combined_disciplines WHERE event_code = v_code;

  WITH ath AS (
    SELECT ha.id AS heat_athlete_id, p.id AS profile_id, p.sslc_name, p.bid_number,
           c.code AS college_code, c.name AS college_name
    FROM heats h
    JOIN heat_athletes ha ON ha.heat_id = h.id
    JOIN profiles p ON p.id = ha.profile_id
    JOIN squads s ON s.id = p.squad_id
    JOIN colleges c ON c.id = s.college_id
    WHERE h.event_id = p_event_id
  ), tot AS (
    SELECT a.*,
           COALESCE(SUM(r.points), 0)::INTEGER AS total,
           COUNT(r.id)::INTEGER AS done,
           COUNT(r.id) FILTER (WHERE r.status IN ('DNS', 'DNF', 'DQ'))::INTEGER AS out_count
    FROM ath a LEFT JOIN combined_results r ON r.heat_athlete_id = a.heat_athlete_id
    GROUP BY a.heat_athlete_id, a.profile_id, a.sslc_name, a.bid_number, a.college_code, a.college_name
  ), cls AS (
    SELECT *, (done = v_n AND out_count = 0) AS classified FROM tot
  ), ranked AS (
    SELECT x.*,
      CASE WHEN x.classified THEN 1 + (
        SELECT COUNT(*) FROM cls y
        WHERE y.classified AND y.heat_athlete_id <> x.heat_athlete_id
          AND (y.total > x.total OR (y.total = x.total AND
            (SELECT COUNT(*) FROM combined_results ry JOIN combined_results rx
               ON rx.discipline = ry.discipline AND rx.heat_athlete_id = x.heat_athlete_id
              WHERE ry.heat_athlete_id = y.heat_athlete_id AND ry.points > rx.points)
          >
            (SELECT COUNT(*) FROM combined_results ry JOIN combined_results rx
               ON rx.discipline = ry.discipline AND rx.heat_athlete_id = x.heat_athlete_id
              WHERE ry.heat_athlete_id = y.heat_athlete_id AND rx.points > ry.points)))
      ) END AS rank
    FROM cls x
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rank', rank, 'classified', classified, 'heat_athlete_id', heat_athlete_id, 'profile_id', profile_id,
      'bid_number', bid_number, 'sslc_name', sslc_name, 'college_code', college_code, 'college_name', college_name,
      'total', total, 'done', done, 'disciplines', v_n)
    ORDER BY rank NULLS LAST, total DESC, sslc_name), '[]'::jsonb)
  INTO v_out FROM ranked;

  RETURN jsonb_build_object('success', true, 'event_id', p_event_id, 'standings', v_out);
END;
$$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------------------------
-- Championship points: same 5 / 3 / 1 as other individual events, ties share.
-- (Rest of the function is unchanged from 0034.)
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

  -- A combined event is one competition: points come from any of its heats
  IF r_event.category = 'combined' THEN
    IF NOT EXISTS (SELECT 1 FROM heats WHERE id = p_heat_id AND event_id = p_event_id) THEN
      RAISE EXCEPTION 'Heat does not belong to %.', r_event.name;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM heats WHERE id = p_heat_id AND event_id = p_event_id AND stage = 'FINAL') THEN
    RAISE EXCEPTION 'Points are awarded only from a FINAL of %.', r_event.name;
  END IF;

  v_is_mixed := upper(r_event.code) = '4X400M-MIX';
  v_is_relay := r_event.category = 'relay';
  IF v_is_mixed THEN
    v_pts := ARRAY[0.0, 0.0, 0.0];
  ELSIF v_is_relay THEN
    v_pts := ARRAY[10.0, 6.0, 2.0];
  ELSE
    v_pts := ARRAY[5.0, 3.0, 1.0];
  END IF;

  DELETE FROM team_points WHERE event_id = p_event_id;

  IF r_event.category = 'combined' THEN
    WITH st AS (
      SELECT (i->>'rank')::INTEGER AS place, (i->>'profile_id')::UUID AS profile_id
      FROM jsonb_array_elements(compute_combined_standings(p_event_id)->'standings') AS i
      WHERE (i->>'classified')::BOOLEAN AND (i->>'total')::INTEGER > 0
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
  ELSIF r_event.category LIKE 'field%' THEN
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

-- A mark edited after the points were awarded recalculates them (same as 0034)
CREATE OR REPLACE FUNCTION trg_recalc_combined_points()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_heat RECORD;
BEGIN
  SELECT h.id, h.event_id INTO v_heat
  FROM heat_athletes ha JOIN heats h ON h.id = ha.heat_id
  WHERE ha.id = COALESCE(NEW.heat_athlete_id, OLD.heat_athlete_id);
  IF FOUND AND EXISTS (SELECT 1 FROM team_points WHERE event_id = v_heat.event_id) THEN
    PERFORM allocate_event_points(v_heat.event_id, v_heat.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_combined_results_recalc ON combined_results;
CREATE TRIGGER trg_combined_results_recalc
  AFTER INSERT OR UPDATE OR DELETE ON combined_results
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_combined_points();

-- Lock the new functions down like 0039
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON combined_results, combined_disciplines FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON combined_results, combined_disciplines FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
  END IF;
END $$;
