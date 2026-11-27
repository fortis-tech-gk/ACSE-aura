-- =============================================================================
-- AURA 2026 — the meet in numbers (from the database)
--
-- Read-only. Run after the meet (or any time) against production:
--   psql "$PROD_DB" -X -f scripts/reports/meet_numbers.sql
-- Every figure comes from rows the system already stores with timestamps, so nothing
-- extra is recorded during the meet. Times are India time (Asia/Kolkata).
-- Traffic (requests per minute, latency, errors) comes from the API logs instead:
-- scripts/reports/meet_traffic.bq.sql.
-- =============================================================================

BEGIN TRANSACTION READ ONLY;
\pset footer off

\echo '\n== Registration =='
SELECT
  (SELECT count(DISTINCT s.college_id) FROM squads s JOIN profiles p ON p.squad_id = s.id
     WHERE p.accreditation_status <> 'WITHDrAWN')                                   AS colleges_with_athletes,
  (SELECT count(*) FROM colleges WHERE attendance_marked_at IS NOT NULL)           AS colleges_checked_in,
  (SELECT count(*) FROM profiles WHERE accreditation_status <> 'WITHDrAWN')        AS athletes,
  (SELECT count(*) FROM profiles p JOIN squads s ON s.id = p.squad_id
     WHERE s.gender = 'men' AND p.accreditation_status <> 'WITHDrAWN')             AS men,
  (SELECT count(*) FROM profiles p JOIN squads s ON s.id = p.squad_id
     WHERE s.gender = 'women' AND p.accreditation_status <> 'WITHDrAWN')           AS women,
  (SELECT count(*) FROM profiles WHERE accreditation_status = 'ACCREDITED')        AS accredited,
  (SELECT count(*) FROM profiles WHERE accreditation_status = 'WITHDrAWN')         AS withdrawn;

\echo '\n== Entries by kind =='
SELECT r.kind, count(*) AS entries, count(DISTINCT r.event_id) AS events
FROM registrations r JOIN profiles p ON p.id = r.profile_id
WHERE p.accreditation_status <> 'WITHDrAWN'
GROUP BY r.kind ORDER BY entries DESC;

\echo '\n== Fees =='
SELECT
  count(*) FILTER (WHERE status = 'VERIFIED')                          AS verified_payments,
  count(*)                                                             AS payments_submitted,
  COALESCE(sum(amount_received) FILTER (WHERE status = 'VERIFIED'), 0) AS rupees_verified,
  (SELECT count(DISTINCT s.college_id) FROM squads s WHERE s.payment_status = 'VERIFIED') AS colleges_fully_paid
FROM payments;

\echo '\n== Competition =='
SELECT
  (SELECT count(*) FROM events)                                         AS events_on_programme,
  (SELECT count(DISTINCT event_id) FROM heats)                          AS events_with_heats,
  (SELECT count(*) FROM heats)                                          AS heats,
  (SELECT count(*) FROM heat_athletes)                                  AS heat_entries,
  (SELECT count(*) FROM heat_athletes WHERE call_room_reported)         AS reported_at_call_room,
  (SELECT count(*) FROM roll_call_entries WHERE reported_at IS NOT NULL) AS roll_call_reported,
  (SELECT count(*) FROM track_results)                                  AS track_results,
  (SELECT count(*) FROM field_attempts)                                 AS field_attempts,
  (SELECT count(*) FROM vertical_jump_attempts)                         AS high_jump_pole_vault_attempts,
  (SELECT count(*) FROM call_room_substitutions)                        AS substitutions,
  (SELECT count(*) FROM result_changes)                                 AS result_changes_logged;

\echo '\n== Heats by status =='
SELECT status, count(*) AS heats FROM heats GROUP BY status ORDER BY heats DESC;

\echo '\n== Meals served (athletes + passes), by day =='
WITH meals AS (
  SELECT meal_date, meal_type, scanned_at, 'athlete' AS who FROM meal_logs
  UNION ALL
  SELECT meal_date, meal_type, scanned_at, 'pass' FROM delegate_meal_logs
)
SELECT meal_date,
       count(*) FILTER (WHERE meal_type = 'BREAKFAST') AS breakfast,
       count(*) FILTER (WHERE meal_type = 'LUNCH')     AS lunch,
       count(*) FILTER (WHERE meal_type = 'SNACKS')    AS snacks,
       count(*) FILTER (WHERE meal_type = 'DINNER')    AS dinner,
       count(*) FILTER (WHERE who = 'pass')            AS of_which_passes,
       count(*)                                        AS total
FROM meals GROUP BY meal_date ORDER BY meal_date;

\echo '\n== Busiest food-counter minutes (scans per minute) =='
WITH meals AS (
  SELECT scanned_at FROM meal_logs UNION ALL SELECT scanned_at FROM delegate_meal_logs
)
SELECT to_char(date_trunc('minute', scanned_at AT TIME ZONE 'Asia/Kolkata'), 'DD Mon HH24:MI') AS minute_ist,
       count(*) AS scans
FROM meals GROUP BY 1 ORDER BY scans DESC LIMIT 10;

\echo '\n== Food counter, overall =='
WITH meals AS (
  SELECT scanned_at FROM meal_logs UNION ALL SELECT scanned_at FROM delegate_meal_logs
), per_min AS (
  SELECT date_trunc('minute', scanned_at) AS m, count(*) AS n FROM meals GROUP BY 1
)
SELECT (SELECT count(*) FROM meals)          AS meals_total,
       max(n)                                AS peak_scans_per_minute,
       round(avg(n), 1)                      AS avg_scans_per_busy_minute,
       count(*)                              AS minutes_with_scans
FROM per_min;

\echo '\n== Hostel check-ins =='
SELECT
  (SELECT count(*) FROM profiles WHERE accommodation_checked_in)          AS athletes_checked_in,
  (SELECT count(*) FROM delegates WHERE accommodation_checked_in)         AS passes_checked_in;

\echo '\n== Passes (faculty, PEDs, volunteers, officials) =='
SELECT category,
       count(*)                                        AS passes,
       count(*) FILTER (WHERE full_name IS NULL)       AS blank_passes,
       count(*) FILTER (WHERE accreditation_status = 'WITHDRAWN') AS cancelled
FROM delegates GROUP BY category ORDER BY passes DESC;

\echo '\n== Accreditation desk scans =='
SELECT count(*) AS accreditation_scans FROM accreditation_scans;

COMMIT;
