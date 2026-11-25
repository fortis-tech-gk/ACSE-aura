-- =============================================================================
-- 0052: Photo finish — heats only for sprint events, manual mode switch
--
--   * is_heat_event(code): only 100m, 200m, 400m, the hurdles (110H, 100H, 400H) and the relays
--     (4X...) have heats / rounds. Everything else — 800m, 1500m, 5000m, 10000m, half marathon,
--     walk, field events — is a single race or flight, always drawn as a straight FINAL.
--     (Before, 800m and 1500m were split into heats of 8; 0044 is superseded by this.)
--   * meet_settings.photo_finish_mode: 'APP' (default, the app draws heats) or 'MANUAL' (the
--     photo finish vendor makes the heats; the admin types lane + bib, see /admin/photo-finish).
--     In MANUAL mode generate_heat_draw refuses the heat events, so no screen can draw them by mistake.
-- Safe to re-run.
-- =============================================================================

BEGIN;

ALTER TABLE meet_settings ADD COLUMN IF NOT EXISTS photo_finish_mode TEXT NOT NULL DEFAULT 'APP';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meet_settings_photo_finish_mode_check') THEN
    ALTER TABLE meet_settings ADD CONSTRAINT meet_settings_photo_finish_mode_check CHECK (photo_finish_mode IN ('APP', 'MANUAL'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION is_heat_event(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(p_code, '')) ~ '^(100M|200M|400M|110H|100H|400H|4X)'
$$;

CREATE OR REPLACE FUNCTION public.generate_heat_draw(p_event_id uuid, p_stage text DEFAULT 'HEATS'::text, p_num_lanes integer DEFAULT 8, p_only_ids uuid[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r_event RECORD;
  v_is_relay BOOLEAN;
  v_single_group BOOLEAN;
  v_ids UUID[];
  v_total INTEGER;
  v_num_heats INTEGER;
  v_heat_ids UUID[] := ARRAY[]::UUID[];
  v_heat_id UUID;
  v_members UUID[];
  v_k INTEGER;
  v_schedule_item UUID;
  v_active INTEGER;
  v_not_accredited INTEGER := 0;
  v_not_paid INTEGER := 0;
  v_stage TEXT := p_stage;
  v_heat_event BOOLEAN;
  v_mode TEXT;
  i INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('generate_heat_draw_' || p_event_id::text || '_' || p_stage));

  IF p_num_lanes IS NULL OR p_num_lanes < 1 THEN
    RAISE EXCEPTION 'Number of lanes must be at least 1.';
  END IF;

  SELECT id, name, code, category, start_type INTO r_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  v_is_relay := r_event.category = 'relay';
  v_heat_event := is_heat_event(r_event.code);

  -- Heats exist only for 100m, 200m, 400m, the hurdles and the relays. Every other event
  -- (800m and up, road, walk, field) is ONE race / one flight and is always a straight FINAL.
  IF NOT v_heat_event THEN
    v_stage := 'FINAL';
    DELETE FROM heats WHERE event_id = p_event_id AND stage <> 'FINAL' AND status = 'SCHEDULED';
  END IF;
  v_single_group := NOT v_heat_event OR r_event.category LIKE 'field%';

  -- Manual photo finish mode: the vendor makes the heats, the admin types lane + bib instead
  SELECT COALESCE((SELECT photo_finish_mode FROM meet_settings LIMIT 1), 'APP') INTO v_mode;
  IF v_heat_event AND v_mode = 'MANUAL' THEN
    RAISE EXCEPTION 'Photo finish MANUAL mode is on: the heats of % come from the photo finish vendor. Enter lane and bib in Admin > Photo Finish, or switch back to App mode.', r_event.name;
  END IF;

  SELECT count(*) INTO v_active
  FROM heats WHERE event_id = p_event_id AND stage = v_stage AND status <> 'SCHEDULED';
  IF v_active > 0 THEN
    RAISE EXCEPTION 'Cannot redraw % (%): % heat(s) are already under way or finished.',
      r_event.name, v_stage, v_active;
  END IF;

  IF v_stage = 'FINAL' AND EXISTS (
    SELECT 1 FROM heats WHERE event_id = p_event_id AND stage <> 'FINAL'
  ) THEN
    RAISE EXCEPTION '% already has earlier rounds. Build the final from their results (qualify the top athletes), do not draw it.',
      r_event.name;
  END IF;

  -- Eligible entrants, grouped by college (random college order, random within a
  -- college) so that dealing them round-robin puts teammates in different heats.
  IF v_is_relay THEN
    WITH e AS (
      SELECT rt.id, s.college_id
      FROM relay_teams rt
      JOIN squads s ON s.id = rt.squad_id
      WHERE rt.event_id = p_event_id
        AND s.payment_status = 'VERIFIED'
        AND (p_only_ids IS NULL OR rt.id = ANY(p_only_ids))
        AND (SELECT count(*) FROM relay_members rm JOIN profiles p ON p.id = rm.profile_id
             WHERE rm.relay_team_id = rt.id AND p.accreditation_status = 'ACCREDITED') >= 4
    ), c AS (
      SELECT college_id, random() AS rc FROM (SELECT DISTINCT college_id FROM e) x
    )
    SELECT array_agg(e.id ORDER BY c.rc, random()) INTO v_ids FROM e JOIN c USING (college_id);

    SELECT count(*) FILTER (WHERE s.payment_status <> 'VERIFIED') INTO v_not_paid
    FROM relay_teams rt JOIN squads s ON s.id = rt.squad_id WHERE rt.event_id = p_event_id;
    SELECT count(*) - COALESCE(array_length(v_ids, 1), 0) - v_not_paid INTO v_not_accredited
    FROM relay_teams rt WHERE rt.event_id = p_event_id;
  ELSE
    WITH e AS (
      SELECT DISTINCT p.id, s.college_id
      FROM registrations r
      JOIN profiles p ON p.id = r.profile_id
      JOIN squads s ON s.id = p.squad_id
      WHERE r.event_id = p_event_id
        -- A roll call passes the athletes who reported; a reserve who came in for an absent
        -- teammate there is drawn on their reserve entry
        AND (r.kind IN ('regular', 'half_marathon') OR (p_only_ids IS NOT NULL AND r.kind = 'reserve'))
        AND (p_only_ids IS NULL OR p.id = ANY(p_only_ids))
        AND p.accreditation_status = 'ACCREDITED'
        AND s.payment_status = 'VERIFIED'
    ), c AS (
      SELECT college_id, random() AS rc FROM (SELECT DISTINCT college_id FROM e) x
    )
    SELECT array_agg(e.id ORDER BY c.rc, random()) INTO v_ids FROM e JOIN c USING (college_id);

    SELECT count(DISTINCT p.id) FILTER (WHERE s.payment_status <> 'VERIFIED'),
           count(DISTINCT p.id) FILTER (WHERE s.payment_status = 'VERIFIED'
                                          AND p.accreditation_status = 'REGISTERED')
    INTO v_not_paid, v_not_accredited
    FROM registrations r
    JOIN profiles p ON p.id = r.profile_id
    JOIN squads s ON s.id = p.squad_id
    WHERE r.event_id = p_event_id
      AND r.kind IN ('regular', 'half_marathon')
      AND p.accreditation_status <> 'WITHDrAWN';
  END IF;

  v_total := COALESCE(array_length(v_ids, 1), 0);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'No one can be drawn for % yet: % not accredited, % from colleges whose payment is not verified.',
      r_event.name, v_not_accredited, v_not_paid;
  END IF;

  IF v_single_group THEN
    v_num_heats := 1;
  ELSE
    IF v_stage = 'FINAL' AND v_total > p_num_lanes THEN
      RAISE EXCEPTION '% has % eligible athletes for % lanes. Draw HEATS first; the final is built from their results.',
        r_event.name, v_total, p_num_lanes;
    END IF;
    v_num_heats := CEIL(v_total::NUMERIC / p_num_lanes)::INTEGER;
  END IF;

  -- Replace the scheduled heats of this stage, keeping their schedule slot.
  SELECT schedule_item_id INTO v_schedule_item
  FROM heats
  WHERE event_id = p_event_id AND stage = v_stage AND schedule_item_id IS NOT NULL
  ORDER BY heat_number LIMIT 1;

  IF v_schedule_item IS NULL AND NOT v_heat_event THEN
    -- one race: it runs in the event's first slot on the schedule
    SELECT id INTO v_schedule_item FROM schedule_items WHERE event_id = p_event_id
    ORDER BY CASE stage WHEN 'QUALIFYING' THEN 1 WHEN 'HEATS' THEN 1 WHEN 'SEMI_FINAL' THEN 2 ELSE 3 END, scheduled_time NULLS LAST LIMIT 1;
  END IF;

  DELETE FROM heats WHERE event_id = p_event_id AND stage = v_stage AND status = 'SCHEDULED';

  FOR i IN 1..v_num_heats LOOP
    INSERT INTO heats (event_id, schedule_item_id, stage, heat_number, status)
    VALUES (p_event_id, v_schedule_item, v_stage, i, 'SCHEDULED')
    RETURNING id INTO v_heat_id;
    v_heat_ids := array_append(v_heat_ids, v_heat_id);

    -- Round-robin deal: entrant n goes to heat ((n-1) mod H) + 1.
    SELECT array_agg(x.id ORDER BY x.ord) INTO v_members
    FROM unnest(v_ids) WITH ORDINALITY AS x(id, ord)
    WHERE (x.ord - 1) % v_num_heats = i - 1;
    v_k := COALESCE(array_length(v_members, 1), 0);

    -- Lanes: the v_k most central lanes (or positions 1..v_k for one-group
    -- events), handed out in random order.
    WITH m AS (
      SELECT id, row_number() OVER (ORDER BY random()) AS rn FROM unnest(v_members) AS id
    ), l AS (
      SELECT lane, row_number() OVER (
               ORDER BY CASE WHEN v_single_group THEN lane ELSE abs(lane - (p_num_lanes + 1) / 2.0) END, lane
             ) AS rn
      FROM generate_series(1, CASE WHEN v_single_group THEN v_k ELSE GREATEST(p_num_lanes, v_k) END) AS lane
    )
    INSERT INTO heat_athletes (heat_id, profile_id, relay_team_id, lane_number)
    SELECT v_heat_id,
           CASE WHEN v_is_relay THEN NULL ELSE m.id END,
           CASE WHEN v_is_relay THEN m.id ELSE NULL END,
           l.lane
    FROM m JOIN l USING (rn);
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'event_id', p_event_id,
    'stage', v_stage,
    'total_athletes', v_total,
    'num_heats', v_num_heats,
    'heats_created', v_heat_ids,
    'left_out', jsonb_build_object('not_accredited', v_not_accredited, 'not_paid', v_not_paid)
  );
END;
$function$;


REVOKE EXECUTE ON FUNCTION is_heat_event(TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION is_heat_event(TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION is_heat_event(TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION is_heat_event(TEXT) TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
