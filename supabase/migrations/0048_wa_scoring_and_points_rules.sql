-- =============================================================================
-- 0048: Points rules of 25-11-2026 and World Athletics scoring for Best Athlete
--
-- College championships (Overall, Best Men's College, Best Women's College):
--   * Individual events                    : 1st = 5,  2nd = 3, 3rd = 1
--   * Combined events (Decathlon/Heptathlon): 1st = 10, 2nd = 6, 3rd = 2
--   * Relays 4x100m / 4x400m               : 1st = 10, 2nd = 6, 3rd = 2
--   * 4x400m Mixed Relay                   : 1st = 10, 2nd = 6, 3rd = 2, Overall only
--   * Overall = every event. Men's / Women's College = that division's events, relays included,
--     Mixed Relay excluded (web rules 7 and 14).
--   * Ties share the points of the places they cover (unchanged).
--   team_points.points now holds exactly these college points.
--
-- Best Male / Female Athlete (replaces 5-3-1 athlete points):
--   * Every individual performance in a FINAL (track, road, field) and every classified combined
--     event total is scored with the World Athletics Scoring Tables (2025 edition):
--       points = round(a*x^2 + b*x + c), x = seconds (track/road), metres (field), points (combined)
--     Coefficients are a curve fit of the official tables (github.com/jchen1/iaaf-scoring-tables,
--     coefficients-2025.json), accurate to about 1 point. Clamped to 0..1400.
--   * Only the final counts, even if the athlete was faster in the heats.
--   * Ranking: best single performance score, then the second best, then name.
-- Safe to re-run.
-- =============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. World Athletics scoring table coefficients, keyed by our event codes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wa_scoring_coefficients (
  event_code TEXT PRIMARY KEY,
  wa_event   TEXT NOT NULL,
  mark_unit  TEXT NOT NULL CHECK (mark_unit IN ('seconds', 'metres', 'points')),
  a          DOUBLE PRECISION NOT NULL,
  b          DOUBLE PRECISION NOT NULL,
  c          DOUBLE PRECISION NOT NULL,
  edition    TEXT NOT NULL DEFAULT '2025'
);

INSERT INTO wa_scoring_coefficients (event_code, wa_event, mark_unit, a, b, c) VALUES
  -- Men
  ('100M-M',   '100m',       'seconds', 24.642211664166098,     -837.7135408530303,   7119.3125116789015),
  ('200M-M',   '200m',       'seconds', 5.083329625804254,      -360.8260380705033,   6403.154333221377),
  ('400M-M',   '400m',       'seconds', 1.0210130425695638,     -161.3092238081408,   6371.289298935095),
  ('800M-M',   '800m',       'seconds', 0.1980049254166545,     -72.07136038821409,   6558.28160300618),
  ('1500M-M',  '1500m',      'seconds', 0.04065992529984008,    -31.307736299477256,  6026.662254345021),
  ('5000M-M',  '5000m',      'seconds', 0.002777997945427213,   -8.000608112196687,   5760.418712362531),
  ('10000M-M', '10000m',     'seconds', 5.239994429364625E-4,   -3.3011925260043427,  5199.371486475808),
  ('110H-M',   '110mH',      'seconds', 7.1470227474935655,     -375.8846820439139,   4920.401710892969),
  ('400H-M',   '400mH',      'seconds', 0.5459888468067362,     -104.2787780128183,   4979.068748674414),
  ('20KM-W-M', 'Road 20kmW', 'seconds', 2.735041573859393E-5,   -0.623559717833615,   3554.1219906366896),
  ('HM-M',     'Road HM',    'seconds', 9.469710951061014E-5,   -1.3521892901331114,  4827.020676429092),
  ('HJ-M',     'HJ',         'metres',  32.14570816360356,      745.3746826150164,    -705.259733494051),
  ('PV-M',     'PV',         'metres',  3.0457199208785823,     239.612026696057,     -280.5412229935755),
  ('LJ-M',     'LJ',         'metres',  1.931092872960562,      186.73134733641928,   -479.70640445759636),
  ('TJ-M',     'TJ',         'metres',  0.4603666024030417,     90.96978768056579,    -514.9946082626993),
  ('SP-M',     'SP',         'metres',  0.04234614355526389,    57.99966265925241,    -55.823610246186945),
  ('DT-M',     'DT',         'metres',  0.00400631290161968,    17.8920605010303,     -27.18777464602681),
  ('HT-M',     'HT',         'metres',  0.0028444950947790204,  15.081627308136717,   -21.68901198504136),
  ('JT-M',     'JT',         'metres',  0.0024031524897170087,  13.841186813175682,   -21.05825095349428),
  ('DEC-M',    'Dec.',       'points',  9.772168523991976E-7,   0.139129643801148,    -48.958602564753164),
  -- Women
  ('100M-W',   '100m',       'seconds', 9.927426450685289,      -436.6751262119069,   4802.020943877404),
  ('200M-W',   '200m',       'seconds', 2.2422237149162925,     -204.01464451534775,  4640.727341804304),
  ('400M-W',   '400m',       'seconds', 0.3350059758445596,     -73.6974469594461,    4053.1545244171575),
  ('800M-W',   '800m',       'seconds', 0.06879989341997295,    -34.399261916380055,  4299.822125108796),
  ('1500M-W',  '1500m',      'seconds', 0.01339999627048627,    -14.471861176560651,  3907.3655835949467),
  ('5000M-W',  '5000m',      'seconds', 8.079992470730324E-4,   -3.3935897885437782,  3563.2616780022654),
  ('10000M-W', '10000m',     'seconds', 1.712000450308747E-4,   -1.5407985033832432,  3466.7925173026015),
  ('100H-W',   '100mH',      'seconds', 3.982296326194273,      -238.8619577729478,   3581.9054393060505),
  ('400H-W',   '400mH',      'seconds', 0.20856495718486912,    -54.2249062108549,    3524.488878249118),
  ('20KM-W-W', 'Road 20kmW', 'seconds', 1.869988372757989E-5,   -0.493658647842274,   3258.0265828920237),
  ('HM-W',     'Road HM',    'seconds', 2.5960366893742386E-5,  -0.5606107770831628,  3026.587224518895),
  ('HJ-W',     'HJ',         'metres',  39.557908744493034,     831.3655724464043,    -601.5063267494843),
  ('PV-W',     'PV',         'metres',  3.9325797501069246,     275.48968329938936,   -205.1216924619548),
  ('LJ-W',     'LJ',         'metres',  1.958114032649064,      193.69548254413166,   -233.98988652729167),
  ('TJ-W',     'TJ',         'metres',  0.4296645887350792,     90.3430418780863,     -231.6675825305283),
  ('SP-W',     'SP',         'metres',  0.046214387641356325,   60.75503111383068,    -25.931941888942674),
  ('DT-W',     'DT',         'metres',  0.0040284238096806035,  17.94169538353276,    -19.210748193687323),
  ('HT-W',     'HT',         'metres',  0.0030967239667614166,  15.730166876520684,   -22.699498543297523),
  ('JT-W',     'JT',         'metres',  0.004072274456476066,   18.042616052881158,   -18.842904339435336),
  ('HEP-W',    'Hept.',      'points',  1.5806071811915508E-6,  0.17704089212065277,  -43.84270064775592)
ON CONFLICT (event_code) DO UPDATE SET
  wa_event = EXCLUDED.wa_event, mark_unit = EXCLUDED.mark_unit,
  a = EXCLUDED.a, b = EXCLUDED.b, c = EXCLUDED.c, edition = EXCLUDED.edition;

ALTER TABLE wa_scoring_coefficients ENABLE ROW LEVEL SECURITY;

-- Score of one mark. NULL for an event without a table (relays) or no mark.
-- Times slower than the bottom of the curve score 0 (the parabola would rise again there).
CREATE OR REPLACE FUNCTION wa_points(p_event_code TEXT, p_mark NUMERIC)
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_mark IS NULL OR p_mark <= 0 THEN NULL
    WHEN k.mark_unit = 'seconds' AND p_mark >= -k.b / (2 * k.a) THEN 0
    ELSE GREATEST(0, LEAST(1400, round(k.a * p_mark::float8 * p_mark::float8 + k.b * p_mark::float8 + k.c)))::INTEGER
  END
  FROM wa_scoring_coefficients k
  WHERE k.event_code = upper(p_event_code);
$$;

-- ------------------------------------------------------------------------------
-- 2. Points allocation: combined events now 10-6-2 (relays already were)
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
  IF v_is_relay OR r_event.category = 'combined' THEN
    v_pts := ARRAY[10.0, 6.0, 2.0];             -- relays (incl. Mixed Relay) and combined events
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
      WHEN v_is_mixed THEN 'overall_only'
      ELSE 'overall_and_division'
    END
  );
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 3. Every awarded row: the stored points ARE the college points now
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS championship_scored_points CASCADE;
CREATE VIEW championship_scored_points AS
SELECT
  tp.id, tp.event_id, tp.heat_id, tp.college_id, tp.squad_id, tp.profile_id, tp.relay_team_id,
  tp.place, tp.points,
  tp.points AS college_points,
  s.gender AS squad_gender,
  (e.category = 'relay') AS is_relay,
  (e.category = 'combined') AS is_combined,
  (upper(e.code) = '4X400M-MIX') AS is_mixed
FROM team_points tp
JOIN events e ON e.id = tp.event_id
JOIN squads s ON s.id = tp.squad_id;

-- ------------------------------------------------------------------------------
-- 4. Scored final-round performances (World Athletics tables), one row per athlete per event
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wa_final_performances()
RETURNS TABLE (profile_id UUID, event_id UUID, event_code TEXT, event_name TEXT, mark NUMERIC, mark_unit TEXT, wa_points INTEGER)
LANGUAGE sql STABLE AS $$
  WITH perf AS (
    -- Track and road: the time in a finished FINAL
    SELECT ha.profile_id, e.id AS event_id, MIN(tr.time_seconds) AS mark
    FROM events e
    JOIN heats h ON h.event_id = e.id AND h.stage = 'FINAL' AND h.status IN ('COMPLETED', 'OFFICIAL')
    JOIN heat_athletes ha ON ha.heat_id = h.id AND ha.profile_id IS NOT NULL
    JOIN track_results tr ON tr.heat_athlete_id = ha.id
    WHERE e.category NOT LIKE 'field%' AND e.category NOT IN ('relay', 'combined')
      AND tr.status = 'FINISHED' AND tr.time_seconds IS NOT NULL
    GROUP BY ha.profile_id, e.id
    UNION ALL
    -- Field: best valid mark / highest bar cleared in a finished FINAL
    SELECT (i->>'profile_id')::UUID, e.id, MAX((i->>'best_mark')::NUMERIC)
    FROM events e
    JOIN heats h ON h.event_id = e.id AND h.stage = 'FINAL' AND h.status IN ('COMPLETED', 'OFFICIAL')
    CROSS JOIN LATERAL jsonb_array_elements(compute_field_standings(h.id)->'standings') AS i
    WHERE e.category LIKE 'field%' AND (i->>'best_mark') IS NOT NULL
    GROUP BY 1, 2
    UNION ALL
    -- Combined events: the classified total, once the event has been scored
    SELECT (i->>'profile_id')::UUID, e.id, (i->>'total')::NUMERIC
    FROM events e
    CROSS JOIN LATERAL jsonb_array_elements(compute_combined_standings(e.id)->'standings') AS i
    WHERE e.category = 'combined'
      AND EXISTS (SELECT 1 FROM team_points tp WHERE tp.event_id = e.id)
      AND (i->>'classified')::BOOLEAN AND (i->>'total')::INTEGER > 0
  )
  SELECT p.profile_id, p.event_id, e.code, e.name, p.mark, k.mark_unit, wa_points(e.code, p.mark)
  FROM perf p
  JOIN events e ON e.id = p.event_id
  JOIN wa_scoring_coefficients k ON k.event_code = upper(e.code);
$$;

-- ------------------------------------------------------------------------------
-- 5. Standings
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_championship_standings()
RETURNS JSONB AS $$
DECLARE
  v_combined JSONB;
  v_mens JSONB;
  v_womens JSONB;
  v_best_men JSONB;
  v_best_women JSONB;
BEGIN
  -- Overall College Championship: every event, Mixed Relay included
  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_combined
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, college_name) AS rank, t.*
    FROM (
      SELECT
        c.id AS college_id, c.name AS college_name, c.code AS college_code, c.district,
        COALESCE(SUM(sc.college_points), 0) AS total_points,
        COALESCE(SUM(sc.college_points) FILTER (WHERE NOT sc.is_relay), 0) AS individual_points,
        COALESCE(SUM(sc.college_points) FILTER (WHERE sc.is_relay), 0) AS relay_points,
        COUNT(sc.id) FILTER (WHERE sc.place = 1) AS golds,
        COUNT(sc.id) FILTER (WHERE sc.place = 2) AS silvers,
        COUNT(sc.id) FILTER (WHERE sc.place = 3) AS bronzes
      FROM colleges c
      LEFT JOIN championship_scored_points sc ON sc.college_id = c.id
      GROUP BY c.id, c.name, c.code, c.district
    ) t
  ) r;

  -- Best Men's / Women's College: that division's events, relays included (Mixed Relay excluded)
  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_mens
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, college_name) AS rank, t.*
    FROM (
      SELECT
        c.id AS college_id, c.name AS college_name, c.code AS college_code,
        COALESCE(SUM(sc.college_points), 0) AS total_points,
        COUNT(sc.id) FILTER (WHERE sc.place = 1) AS golds,
        COUNT(sc.id) FILTER (WHERE sc.place = 2) AS silvers,
        COUNT(sc.id) FILTER (WHERE sc.place = 3) AS bronzes
      FROM colleges c
      JOIN squads s ON s.college_id = c.id AND s.gender = 'men'
      LEFT JOIN championship_scored_points sc ON sc.squad_id = s.id AND NOT sc.is_mixed
      GROUP BY c.id, c.name, c.code
    ) t
  ) r;

  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_womens
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, college_name) AS rank, t.*
    FROM (
      SELECT
        c.id AS college_id, c.name AS college_name, c.code AS college_code,
        COALESCE(SUM(sc.college_points), 0) AS total_points,
        COUNT(sc.id) FILTER (WHERE sc.place = 1) AS golds,
        COUNT(sc.id) FILTER (WHERE sc.place = 2) AS silvers,
        COUNT(sc.id) FILTER (WHERE sc.place = 3) AS bronzes
      FROM colleges c
      JOIN squads s ON s.college_id = c.id AND s.gender = 'women'
      LEFT JOIN championship_scored_points sc ON sc.squad_id = s.id AND NOT sc.is_mixed
      GROUP BY c.id, c.name, c.code
    ) t
  ) r;

  -- Best Male / Female Athlete: best single World Athletics score from a final, then the 2nd best
  WITH perf AS (
    SELECT f.*, ROW_NUMBER() OVER (PARTITION BY f.profile_id ORDER BY f.wa_points DESC, f.event_code) AS n
    FROM wa_final_performances() f
  ), per_athlete AS (
    SELECT
      p.id AS profile_id, p.sslc_name AS athlete_name, p.usn, p.bid_number,
      c.name AS college_name, c.code AS college_code, s.gender,
      MAX(pf.wa_points) FILTER (WHERE pf.n = 1) AS total_points,
      MAX(pf.event_name) FILTER (WHERE pf.n = 1) AS best_event,
      MAX(pf.mark) FILTER (WHERE pf.n = 1) AS best_mark,
      MAX(pf.mark_unit) FILTER (WHERE pf.n = 1) AS best_mark_unit,
      MAX(pf.wa_points) FILTER (WHERE pf.n = 2) AS second_points,
      MAX(pf.event_name) FILTER (WHERE pf.n = 2) AS second_event,
      (SELECT COUNT(*) FROM championship_scored_points sc WHERE sc.profile_id = p.id AND NOT sc.is_relay AND sc.place = 1) AS golds,
      (SELECT COUNT(*) FROM championship_scored_points sc WHERE sc.profile_id = p.id AND NOT sc.is_relay AND sc.place = 2) AS silvers,
      (SELECT COUNT(*) FROM championship_scored_points sc WHERE sc.profile_id = p.id AND NOT sc.is_relay AND sc.place = 3) AS bronzes
    FROM perf pf
    JOIN profiles p ON p.id = pf.profile_id
    JOIN squads s ON s.id = p.squad_id
    JOIN colleges c ON c.id = s.college_id
    GROUP BY p.id, p.sslc_name, p.usn, p.bid_number, c.name, c.code, s.gender
  ), ranked AS (
    SELECT ROW_NUMBER() OVER (PARTITION BY gender ORDER BY total_points DESC, second_points DESC NULLS LAST, athlete_name) AS rank, a.*
    FROM per_athlete a
  )
  SELECT
    jsonb_agg(to_jsonb(r) - 'gender' ORDER BY r.rank) FILTER (WHERE r.gender = 'men'),
    jsonb_agg(to_jsonb(r) - 'gender' ORDER BY r.rank) FILTER (WHERE r.gender = 'women')
  INTO v_best_men, v_best_women
  FROM ranked r;

  RETURN jsonb_build_object(
    'success', true,
    'combined', COALESCE(v_combined, '[]'::jsonb),
    'mens', COALESCE(v_mens, '[]'::jsonb),
    'womens', COALESCE(v_womens, '[]'::jsonb),
    'best_male_athletes', COALESCE(v_best_men, '[]'::jsonb),
    'best_female_athletes', COALESCE(v_best_women, '[]'::jsonb),
    'rules', jsonb_build_object(
      'college_individual', jsonb_build_array(5, 3, 1),
      'college_combined_and_relay', jsonb_build_array(10, 6, 2),
      'relay_counts_for', 'overall_and_division',
      'mixed_relay_counts_for', 'overall_only',
      'best_athlete', 'world_athletics_scoring_tables_2025_best_single_final_performance'
    )
  );
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 6. Re-award events already scored, so stored combined-event points become 10-6-2
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT ON (event_id) event_id, heat_id FROM team_points ORDER BY event_id LOOP
    PERFORM allocate_event_points(r.event_id, r.heat_id);
  END LOOP;
END $$;

-- Lock the new functions down like 0039
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON wa_scoring_coefficients FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON wa_scoring_coefficients FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
    GRANT ALL ON wa_scoring_coefficients TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
