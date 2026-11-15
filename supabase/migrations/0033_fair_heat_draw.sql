-- ==============================================================================
-- Migration: 0033_fair_heat_draw.sql
-- Description: Rewrites generate_heat_draw so the draw is fair and only puts
--              athletes who may actually compete on the start list.
--   * Only real entries: 'regular' and 'half_marathon' registrations. Reserve
--     entries never get a lane (audit D1).
--   * Only ACCREDITED athletes from squads whose payment is VERIFIED (D2, D3).
--     Relay teams: owning squad VERIFIED and at least 4 accredited members.
--   * Teammates are dealt into different heats (plan §6.1) (D4).
--   * Heats and lanes are random; with fewer athletes than lanes the centre
--     lanes are used, in random order (D5).
--   * A FINAL is never drawn over heats that already exist (use
--     qualify_next_round), and a lane-event FINAL is refused when more athletes
--     are eligible than there are lanes (D6).
--   * Mass-start, road and field events are one group (no split into "heats").
--   * The schedule link of the heats being replaced is kept.
--   * The result says how many were left out and why.
-- ==============================================================================

CREATE OR REPLACE FUNCTION generate_heat_draw(
  p_event_id UUID,
  p_stage TEXT DEFAULT 'HEATS',
  p_num_lanes INTEGER DEFAULT 8
)
RETURNS JSONB AS $$
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
  v_single_group := r_event.start_type IN ('mass', 'road') OR r_event.category LIKE 'field%';

  SELECT count(*) INTO v_active
  FROM heats WHERE event_id = p_event_id AND stage = p_stage AND status <> 'SCHEDULED';
  IF v_active > 0 THEN
    RAISE EXCEPTION 'Cannot redraw % (%): % heat(s) are already under way or finished.',
      r_event.name, p_stage, v_active;
  END IF;

  IF p_stage = 'FINAL' AND EXISTS (
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
        AND r.kind IN ('regular', 'half_marathon')
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
    IF p_stage = 'FINAL' AND v_total > p_num_lanes THEN
      RAISE EXCEPTION '% has % eligible athletes for % lanes. Draw HEATS first; the final is built from their results.',
        r_event.name, v_total, p_num_lanes;
    END IF;
    v_num_heats := CEIL(v_total::NUMERIC / p_num_lanes)::INTEGER;
  END IF;

  -- Replace the scheduled heats of this stage, keeping their schedule slot.
  SELECT schedule_item_id INTO v_schedule_item
  FROM heats
  WHERE event_id = p_event_id AND stage = p_stage AND schedule_item_id IS NOT NULL
  ORDER BY heat_number LIMIT 1;

  DELETE FROM heats WHERE event_id = p_event_id AND stage = p_stage AND status = 'SCHEDULED';

  FOR i IN 1..v_num_heats LOOP
    INSERT INTO heats (event_id, schedule_item_id, stage, heat_number, status)
    VALUES (p_event_id, v_schedule_item, p_stage, i, 'SCHEDULED')
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
    'stage', p_stage,
    'total_athletes', v_total,
    'num_heats', v_num_heats,
    'heats_created', v_heat_ids,
    'left_out', jsonb_build_object('not_accredited', v_not_accredited, 'not_paid', v_not_paid)
  );
END;
$$ LANGUAGE plpgsql;
