-- =============================================================================
-- 0042: Team (college) points are 10-6-2 for every event win; the athlete's own
--       points stay 5-3-1 (individual events only).
--
--   * A college gets 10 / 6 / 2 for a 1st / 2nd / 3rd place in ANY event (individual or relay).
--   * An athlete gets 5 / 3 / 1 for an individual 1st / 2nd / 3rd (Best Male / Female Athlete).
--   * Overall = individual + relay college points (mixed relay scores nothing).
--   * Best Men's / Women's College Team = that division's individual-event college points (no relays).
--   * Stored team_points.points is untouched (athlete-facing); standings read the view columns.
-- Safe to re-run.
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS championship_scored_points CASCADE;
CREATE VIEW championship_scored_points AS
SELECT
  tp.id,
  tp.event_id,
  tp.heat_id,
  tp.college_id,
  tp.squad_id,
  tp.profile_id,
  tp.relay_team_id,
  tp.place,
  tp.points,
  -- College (team) championship points: 10-6-2 for ANY event, mixed relay scores nothing
  CASE WHEN upper(e.code) = '4X400M-MIX' THEN 0
       ELSE (CASE tp.place WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 2 ELSE 0 END) END::NUMERIC AS college_points,
  -- Athlete's own points: 5-3-1, individual events only
  CASE WHEN e.category = 'relay' THEN 0
       ELSE (CASE tp.place WHEN 1 THEN 5 WHEN 2 THEN 3 WHEN 3 THEN 1 ELSE 0 END) END::NUMERIC AS athlete_points,
  s.gender AS squad_gender,
  (e.category = 'relay') AS is_relay,
  (upper(e.code) = '4X400M-MIX') AS is_mixed
FROM team_points tp
JOIN events e ON e.id = tp.event_id
JOIN squads s ON s.id = tp.squad_id;

-- ------------------------------------------------------------------------------
-- 3. get_championship_standings with the new inclusion rules
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

  -- Overall College Championship: individual + 4x100/4x400 relays (mixed relay excluded)
  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_combined
  FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, college_name) AS rank,
      t.*
    FROM (
      SELECT
        c.id AS college_id,
        c.name AS college_name,
        c.code AS college_code,
        c.district,
        COALESCE(SUM(sc.college_points) FILTER (WHERE NOT sc.is_mixed), 0) AS total_points,
        COALESCE(SUM(sc.college_points) FILTER (WHERE NOT sc.is_relay), 0) AS individual_points,
        COALESCE(SUM(sc.college_points) FILTER (WHERE sc.is_relay AND NOT sc.is_mixed), 0) AS relay_points,
        COUNT(sc.id) FILTER (WHERE sc.place = 1 AND NOT sc.is_mixed) AS golds,
        COUNT(sc.id) FILTER (WHERE sc.place = 2 AND NOT sc.is_mixed) AS silvers,
        COUNT(sc.id) FILTER (WHERE sc.place = 3 AND NOT sc.is_mixed) AS bronzes
      FROM colleges c
      LEFT JOIN championship_scored_points sc ON sc.college_id = c.id
      GROUP BY c.id, c.name, c.code, c.district
    ) t
  ) r;

  -- Best Men's / Women's College Team: individual events of that division only (no relays)
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
      LEFT JOIN championship_scored_points sc ON sc.squad_id = s.id AND NOT sc.is_relay
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
      LEFT JOIN championship_scored_points sc ON sc.squad_id = s.id AND NOT sc.is_relay
      GROUP BY c.id, c.name, c.code
    ) t
  ) r;

  -- Best Male / Female Athlete: individual points only (relay points never count here)
  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_best_men
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, athlete_name) AS rank, t.*
    FROM (
      SELECT
        p.id AS profile_id, p.sslc_name AS athlete_name, p.usn, p.bid_number,
        c.name AS college_name, c.code AS college_code,
        SUM(sc.athlete_points) AS total_points,
        COUNT(*) FILTER (WHERE sc.place = 1) AS golds,
        COUNT(*) FILTER (WHERE sc.place = 2) AS silvers,
        COUNT(*) FILTER (WHERE sc.place = 3) AS bronzes
      FROM championship_scored_points sc
      JOIN profiles p ON p.id = sc.profile_id
      JOIN colleges c ON c.id = sc.college_id
      WHERE NOT sc.is_relay AND sc.squad_gender = 'men'
      GROUP BY p.id, p.sslc_name, p.usn, p.bid_number, c.name, c.code
    ) t
  ) r;

  SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank)
  INTO v_best_women
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY total_points DESC, golds DESC, silvers DESC, bronzes DESC, athlete_name) AS rank, t.*
    FROM (
      SELECT
        p.id AS profile_id, p.sslc_name AS athlete_name, p.usn, p.bid_number,
        c.name AS college_name, c.code AS college_code,
        SUM(sc.athlete_points) AS total_points,
        COUNT(*) FILTER (WHERE sc.place = 1) AS golds,
        COUNT(*) FILTER (WHERE sc.place = 2) AS silvers,
        COUNT(*) FILTER (WHERE sc.place = 3) AS bronzes
      FROM championship_scored_points sc
      JOIN profiles p ON p.id = sc.profile_id
      JOIN colleges c ON c.id = sc.college_id
      WHERE NOT sc.is_relay AND sc.squad_gender = 'women'
      GROUP BY p.id, p.sslc_name, p.usn, p.bid_number, c.name, c.code
    ) t
  ) r;

  RETURN jsonb_build_object(
    'success', true,
    'combined', COALESCE(v_combined, '[]'::jsonb),
    'mens', COALESCE(v_mens, '[]'::jsonb),
    'womens', COALESCE(v_womens, '[]'::jsonb),
    'best_male_athletes', COALESCE(v_best_men, '[]'::jsonb),
    'best_female_athletes', COALESCE(v_best_women, '[]'::jsonb),
    'rules', jsonb_build_object(
      'athlete_individual', jsonb_build_array(5, 3, 1),
      'college_team', jsonb_build_array(10, 6, 2),
      'relay_counts_for', 'overall_only',
      'mixed_relay_counts_for', 'none'
    )
  );
END;
$$ LANGUAGE plpgsql;

COMMIT;

NOTIFY pgrst, 'reload schema';
