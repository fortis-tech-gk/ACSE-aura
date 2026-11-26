-- =============================================================================
-- 0056: Mixed relay — at most 3 nominations per squad, enforced in the database too
--
-- The website already refuses a 4th Mixed Relay nominee from one squad (2 runners + 1 reserve per
-- squad, 6 per college), but enforce_registration_quotas only capped the college at 6, so two
-- simultaneous saves or a direct write could put 4 from one squad (audit 26 Nov, L4). Same
-- function as before (0031) with the per-squad check added, under the college-wide advisory lock.
-- Existing rows are not touched. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_registration_quotas()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_squad UUID;
  v_college UUID;
  v_event RECORD;
  v_is_mixed BOOLEAN;
  v_count INT;
BEGIN
  IF NEW.kind NOT IN ('regular', 'relay') THEN
    RETURN NEW;
  END IF;

  SELECT p.squad_id, s.college_id INTO v_squad, v_college
  FROM profiles p JOIN squads s ON s.id = p.squad_id
  WHERE p.id = NEW.profile_id;

  SELECT code, name, category INTO v_event FROM events WHERE id = NEW.event_id;
  IF NOT FOUND OR v_squad IS NULL THEN
    RETURN NEW; -- foreign keys reject it
  END IF;
  v_is_mixed := upper(v_event.code) = '4X400M-MIX';

  IF NEW.kind = 'regular' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('quota:' || v_squad::text || ':' || NEW.event_id::text, 0));
    SELECT count(*) INTO v_count
    FROM registrations r JOIN profiles p ON p.id = r.profile_id
    WHERE p.squad_id = v_squad AND r.event_id = NEW.event_id AND r.kind = 'regular'
      AND r.id IS DISTINCT FROM NEW.id;
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'VTU Quota Exceeded: your college already has the maximum of 2 athletes in %.', v_event.name
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF v_is_mixed THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('quota:' || v_college::text || ':' || NEW.event_id::text, 0));
    SELECT count(*) INTO v_count
    FROM registrations r JOIN profiles p ON p.id = r.profile_id JOIN squads s ON s.id = p.squad_id
    WHERE s.college_id = v_college AND r.event_id = NEW.event_id AND r.kind = 'relay'
      AND r.id IS DISTINCT FROM NEW.id;
    IF v_count >= 6 THEN
      RAISE EXCEPTION 'Your college already has the maximum of 6 nominations for the 4x400m Mixed Relay (4 runners + 2 reserves).'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Each squad fills half of the mixed team: at most 3 nominations per squad (2 runners + 1 reserve)
    SELECT count(*) INTO v_count
    FROM registrations r JOIN profiles p ON p.id = r.profile_id
    WHERE p.squad_id = v_squad AND r.event_id = NEW.event_id AND r.kind = 'relay'
      AND r.id IS DISTINCT FROM NEW.id;
    IF v_count >= 3 THEN
      RAISE EXCEPTION 'Your squad already has 3 nominations for the 4x400m Mixed Relay (2 runners + 1 reserve per squad).'
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF v_event.category = 'relay' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('quota:' || v_squad::text || ':' || NEW.event_id::text, 0));
    SELECT count(*) INTO v_count
    FROM registrations r JOIN profiles p ON p.id = r.profile_id
    WHERE p.squad_id = v_squad AND r.event_id = NEW.event_id AND r.kind = 'relay'
      AND r.id IS DISTINCT FROM NEW.id;
    IF v_count >= 6 THEN
      RAISE EXCEPTION 'Your squad already has the maximum of 6 athletes for the % (4 runners + 2 reserves).', v_event.name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
