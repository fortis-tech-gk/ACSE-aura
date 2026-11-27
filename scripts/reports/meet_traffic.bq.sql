-- =============================================================================
-- AURA 2026 — API traffic during the meet (BigQuery, from the log sink)
--
-- The log sink `aura-api-logs` (DEPLOY.md → "Logs and meet numbers") copies every Cloud Run
-- log line of the API into dataset `aura_logs`, kept long after Cloud Logging's 30 days:
--   run_googleapis_com_requests — Cloud Run's own record of EVERY request (status, latency in seconds),
--                                  even ones that crashed before our code logged anything
--   run_googleapis_com_stdout    — our structured line per request (route, role, error, scan id)
--
-- Run one block at a time in the BigQuery console (project aura-2026-514120), or:
--   bq query --use_legacy_sql=false < scripts/reports/meet_traffic.bq.sql
-- Change the dates / service below for another window (staging = 'aura-api-staging').
-- =============================================================================

DECLARE svc STRING DEFAULT 'aura-api';
DECLARE t0 TIMESTAMP DEFAULT TIMESTAMP('2026-12-06 00:00:00', 'Asia/Kolkata');
DECLARE t1 TIMESTAMP DEFAULT TIMESTAMP('2026-12-11 00:00:00', 'Asia/Kolkata');

-- 1. Requests per day ---------------------------------------------------------
SELECT
  DATE(timestamp, 'Asia/Kolkata')                                     AS day_ist,
  COUNT(*)                                                            AS requests,
  COUNTIF(httpRequest.status >= 500)                                  AS server_errors,
  ROUND(100 * COUNTIF(httpRequest.status >= 500) / COUNT(*), 3)       AS error_pct,
  ROUND(APPROX_QUANTILES(httpRequest.latency * 1000, 100)[OFFSET(50)]) AS p50_ms,
  ROUND(APPROX_QUANTILES(httpRequest.latency * 1000, 100)[OFFSET(95)]) AS p95_ms
FROM `aura_logs.run_googleapis_com_requests`
WHERE resource.labels.service_name = svc AND timestamp >= t0 AND timestamp < t1
GROUP BY day_ist ORDER BY day_ist;

-- 2. Per-minute traffic: peak, average, and the 10 busiest minutes -------------
WITH per_min AS (
  SELECT TIMESTAMP_TRUNC(timestamp, MINUTE) AS m, COUNT(*) AS n
  FROM `aura_logs.run_googleapis_com_requests`
  WHERE resource.labels.service_name = svc AND timestamp >= t0 AND timestamp < t1
  GROUP BY m
)
SELECT
  MAX(n)                                              AS peak_requests_per_minute,
  ROUND(MAX(n) / 60, 1)                               AS peak_requests_per_second_avg_in_that_minute,
  ROUND(AVG(n), 1)                                    AS avg_requests_per_active_minute,
  ROUND(SUM(n) / (TIMESTAMP_DIFF(t1, t0, MINUTE)), 1) AS avg_requests_per_minute_whole_window,
  COUNT(*)                                            AS minutes_with_traffic
FROM per_min;

SELECT FORMAT_TIMESTAMP('%d %b %H:%M', m, 'Asia/Kolkata') AS minute_ist, requests
FROM (
  SELECT TIMESTAMP_TRUNC(timestamp, MINUTE) AS m, COUNT(*) AS requests
  FROM `aura_logs.run_googleapis_com_requests`
  WHERE resource.labels.service_name = svc AND timestamp >= t0 AND timestamp < t1
  GROUP BY m
)
ORDER BY requests DESC LIMIT 10;

-- 3. Hour-of-day profile (shows the meal and call-room rushes) -----------------
SELECT EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Asia/Kolkata') AS hour_ist,
       COUNT(*)                                                    AS requests,
       ROUND(COUNT(*) / COUNT(DISTINCT DATE(timestamp, 'Asia/Kolkata')) / 60, 1) AS avg_per_minute_in_that_hour
FROM `aura_logs.run_googleapis_com_requests`
WHERE resource.labels.service_name = svc AND timestamp >= t0 AND timestamp < t1
GROUP BY hour_ist ORDER BY hour_ist;

-- 4. Busiest routes, with speed and errors (our structured lines) --------------
SELECT jsonPayload.route                                              AS route,
       COUNT(*)                                                       AS requests,
       ROUND(APPROX_QUANTILES(jsonPayload.ms, 100)[OFFSET(95)])       AS p95_ms,
       COUNTIF(jsonPayload.status >= 500)                             AS server_errors,
       COUNTIF(jsonPayload.status = 429)                              AS rate_limited
FROM `aura_logs.run_googleapis_com_stdout`
WHERE resource.labels.service_name = svc AND timestamp >= t0 AND timestamp < t1
  AND jsonPayload.type = 'request'
GROUP BY route ORDER BY requests DESC LIMIT 25;

-- 5. Who used it: requests by role ---------------------------------------------
SELECT jsonPayload.role AS role, COUNT(*) AS requests, COUNT(DISTINCT jsonPayload.device) AS devices
FROM `aura_logs.run_googleapis_com_stdout`
WHERE resource.labels.service_name = svc AND timestamp >= t0 AND timestamp < t1
  AND jsonPayload.type = 'request'
GROUP BY role ORDER BY requests DESC;

-- 6. Every server error, newest first (what broke, where, when) -----------------
SELECT FORMAT_TIMESTAMP('%d %b %H:%M:%S', timestamp, 'Asia/Kolkata') AS at_ist,
       jsonPayload.route, jsonPayload.status, jsonPayload.errorText, jsonPayload.role, jsonPayload.trace
FROM `aura_logs.run_googleapis_com_stdout`
WHERE resource.labels.service_name = svc AND timestamp >= t0 AND timestamp < t1
  AND severity = 'ERROR'
ORDER BY timestamp DESC LIMIT 200;

-- 7. Availability: minutes where more than 5% of requests failed ---------------
WITH per_min AS (
  SELECT TIMESTAMP_TRUNC(timestamp, MINUTE) AS m, COUNT(*) AS n, COUNTIF(httpRequest.status >= 500) AS bad
  FROM `aura_logs.run_googleapis_com_requests`
  WHERE resource.labels.service_name = svc AND timestamp >= t0 AND timestamp < t1
  GROUP BY m
)
SELECT COUNT(*)                                        AS minutes_with_traffic,
       COUNTIF(bad / n > 0.05)                         AS bad_minutes,
       ROUND(100 * (1 - COUNTIF(bad / n > 0.05) / COUNT(*)), 3) AS good_minute_pct
FROM per_min;
