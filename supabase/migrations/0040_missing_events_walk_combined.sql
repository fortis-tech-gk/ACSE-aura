-- ==============================================================================
-- 0040: Seed events that only full_schema_setup.sql had
-- ------------------------------------------------------------------------------
-- 20 km Walk Race (Men / Women), Decathlon (Men) and Heptathlon (Women) were
-- never added by a migration, so databases built from migrations (staging)
-- lacked them. Idempotent: existing rows are left untouched.
-- ==============================================================================

INSERT INTO events (name, code, gender, category, measurement_unit, start_type, max_lanes, has_rounds, is_multi_attempt, is_progressive_height, max_attempts_per_height)
VALUES
  ('20km Walk Men', '20KM-W-M', 'men', 'road', 'seconds', 'road', NULL, FALSE, FALSE, FALSE, NULL),
  ('20km Walk Women', '20KM-W-W', 'women', 'road', 'seconds', 'road', NULL, FALSE, FALSE, FALSE, NULL),
  ('Decathlon Men', 'DEC-M', 'men', 'combined', 'points', 'mass', NULL, FALSE, FALSE, FALSE, NULL),
  ('Heptathlon Women', 'HEP-W', 'women', 'combined', 'points', 'mass', NULL, FALSE, FALSE, FALSE, NULL)
ON CONFLICT (code) DO NOTHING;
