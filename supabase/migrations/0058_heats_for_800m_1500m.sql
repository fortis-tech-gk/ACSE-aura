-- 0058: 800m and 1500m are run in heats + final, as in the official Order of Events
-- (800m: heats Day 1 morning, final Day 1 15:50; 1500m: heats Day 3, final Day 4).
--
-- Until now is_heat_event() allowed heats only for 100m–400m, the hurdles and the relays, so the
-- roll call drew every 800m / 1500m entrant into ONE straight final (38 runners in one 800m in the
-- 27-11-2026 rehearsal) and the scheduled final slot stayed empty.
--
-- Heat size comes from events.max_lanes (the roll call and the admin draw pass it as p_num_lanes;
-- progression.ts sizes the final with it too):
--   800m  (waterfall start): at most 12 per heat, final of 12
--   1500m (mass start):      at most 15 per heat, final of 15
-- With QUALIFY_PER_HEAT = 2 the final is the first 2 of each heat (Q) plus the fastest losers (q).
-- 5000m, 10000m, road, walk and field events stay one race / one flight (straight FINAL).

CREATE OR REPLACE FUNCTION public.is_heat_event(p_code text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT upper(COALESCE(p_code, '')) ~ '^(100M|200M|400M|800M|1500M|110H|100H|400H|4X)'
$function$;

UPDATE events SET max_lanes = 12 WHERE code IN ('800M-M', '800M-W');
UPDATE events SET max_lanes = 15 WHERE code IN ('1500M-M', '1500M-W');
