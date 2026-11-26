/**
 * Data for the official result sheets (lib/result-sheets.ts): every finished FINAL of a group,
 * ranked with the same rules the points table uses (migration 0034):
 *   - track / road / relay: by time across all sections of the final, ties share the place;
 *   - field: compute_field_standings (best mark, then the rest of the series / countback);
 *   - decathlon / heptathlon: compute_combined_standings (classified athletes only).
 * Server-only (service-role client, signed photo links).
 */
import { supabaseAdmin } from '@/lib/supabase';
import { signAthletePhotos } from '@/lib/photo-links';
import { placesByValue, showTime, type EventSheet, type SheetPerson, type SheetRow } from '@/lib/result-sheets';

const DONE = ['COMPLETED', 'OFFICIAL'];
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const PERSON = 'id, sslc_name, usn, phone, photo_url, bid_number, squads(colleges(code, name))';

function person(p: any): SheetPerson {
  return { bib: p?.bid_number ?? null, name: p?.sslc_name || 'Athlete', usn: p?.usn || '', phone: p?.phone || '', photo: p?.photo_url || null };
}

function whenText(h: any): string | null {
  const si = one<any>(h.schedule_items);
  if (!si?.scheduled_time) return null;
  const d = new Date(si.scheduled_time);
  if (Number.isNaN(d.getTime())) return String(si.scheduled_time);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Finished finals of `group` ('men' or 'women' also include the 4x400m Mixed Relay, so each
 * pack covers every event that group runs). `eventCode` narrows it to one event.
 */
export async function loadResultSheets(group: 'men' | 'women' | 'mixed', eventCode?: string): Promise<EventSheet[]> {
  let q = supabaseAdmin
    .from('heats')
    .select(
      `id, stage, heat_number, status, wind_reading,
       events!inner(id, code, name, gender, category),
       schedule_items(scheduled_time),
       heat_athletes(id, lane_number,
         profiles(${PERSON}),
         relay_teams(id, squads(colleges(code, name)), relay_members(leg_order, is_reserve, profiles(${PERSON}))),
         track_results(time_seconds, status, dq_rule),
         field_attempts(attempt_type, mark_meters),
         vertical_jump_attempts(bar_height_meters, result),
         combined_results(status))`
    )
    .eq('stage', 'FINAL')
    .in('events.gender', group === 'mixed' ? ['mixed'] : [group, 'mixed']);
  if (eventCode) q = q.ilike('events.code', eventCode);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // Group final heats (sections) by event; an event prints once every section is finalized
  const byEvent = new Map<string, { ev: any; heats: any[] }>();
  for (const h of (data || []) as any[]) {
    const ev = one<any>(h.events);
    if (!ev) continue;
    const g = byEvent.get(ev.id) || { ev, heats: [] };
    g.heats.push(h);
    byEvent.set(ev.id, g);
  }

  const sheets: EventSheet[] = [];
  for (const { ev, heats } of byEvent.values()) {
    if (!heats.every((h) => DONE.includes(h.status))) continue;
    heats.sort((a, b) => a.heat_number - b.heat_number);
    const cat = String(ev.category || '');
    const field = cat.startsWith('field');
    const vertical = cat === 'field_vertical_jump';

    // Database standings for field and combined events
    const fieldRank = new Map<string, number>();
    const combined = new Map<string, any>();
    if (field) {
      for (const h of heats) {
        const { data: st } = await supabaseAdmin.rpc('compute_field_standings', { p_heat_id: h.id });
        for (const s of (st as any)?.standings || []) if (s.best_mark != null) fieldRank.set(s.heat_athlete_id, Number(s.rank));
      }
    } else if (cat === 'combined') {
      const { data: st } = await supabaseAdmin.rpc('compute_combined_standings', { p_event_id: ev.id });
      for (const s of (st as any)?.standings || []) combined.set(s.heat_athlete_id, s);
    }

    // Rows (lane order within each section)
    const rowsByHeat = heats.map((h) =>
      [...(h.heat_athletes || [])]
        .sort((a: any, b: any) => (a.lane_number ?? 999) - (b.lane_number ?? 999))
        .map((a: any) => {
          const p = one<any>(a.profiles);
          const team = one<any>(a.relay_teams);
          const college = one<any>(one<any>((p || team)?.squads)?.colleges);
          let runners: SheetPerson[] | undefined;
          if (team) {
            const members = (team.relay_members || []) as any[];
            const legs = members.filter((m) => !m.is_reserve && m.leg_order != null).sort((x, y) => x.leg_order - y.leg_order);
            runners = (legs.length ? legs : members).map((m) => person(one<any>(m.profiles)));
          }
          let mark = '';
          let note = '';
          let time: number | null = null;
          if (vertical) {
            const tries = (a.vertical_jump_attempts || []) as any[];
            const cleared = tries.filter((x) => x.result === 'O').map((x) => Number(x.bar_height_meters));
            mark = cleared.length ? `${Math.max(...cleared).toFixed(2)} m` : tries.length ? 'NM' : 'DNS';
          } else if (field) {
            const tries = (a.field_attempts || []) as any[];
            const marks = tries.filter((x) => x.attempt_type === 'VALID' && x.mark_meters != null).map((x) => Number(x.mark_meters));
            mark = marks.length ? `${Math.max(...marks).toFixed(2)} m` : tries.length ? 'NM' : 'DNS';
          } else if (cat === 'combined') {
            const st = combined.get(a.id);
            mark = st && (a.combined_results || []).length ? `${st.total} pts` : 'DNS';
            if (st && !st.classified && (a.combined_results || []).length) note = 'Not classified';
          } else {
            const tr = one<any>(a.track_results);
            if (tr?.status === 'FINISHED' && tr.time_seconds != null) {
              time = Number(tr.time_seconds);
              mark = showTime(time);
            } else {
              mark = tr?.status || 'DNS';
              if (tr?.status === 'DQ') note = tr.dq_rule || '';
            }
          }
          const row: SheetRow & { _id: string; _time: number | null } = {
            ...person(p),
            ...(team ? { bib: null, name: `${college?.code || ''} relay team`, usn: '', phone: '', photo: null } : {}),
            order: a.lane_number ?? null,
            college: college?.name || '',
            collegeCode: college?.code || '',
            mark,
            note,
            place: null,
            runners,
            _id: a.id,
            _time: time,
          };
          return row;
        })
    );

    // Places
    const all = rowsByHeat.flat();
    if (field) for (const r of all) r.place = fieldRank.get(r._id) ?? null;
    else if (cat === 'combined')
      for (const r of all) {
        const st = combined.get(r._id);
        r.place = st?.classified ? Number(st.rank) : null;
      }
    else {
      const places = placesByValue(all, (r) => r._time, false);
      for (const r of all) r.place = places.get(r) ?? null;
    }

    sheets.push({
      code: ev.code,
      name: ev.name,
      gender: ev.gender,
      category: cat,
      when: whenText(heats[0]),
      wind: heats[0].wind_reading != null ? `${Number(heats[0].wind_reading) > 0 ? '+' : ''}${Number(heats[0].wind_reading).toFixed(1)} m/s` : null,
      sections: rowsByHeat.map((rows, i) => ({
        label: heats.length > 1 ? `Final — Section ${heats[i].heat_number || i + 1}` : 'Final',
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        rows: rows.map(({ _id, _time, ...r }) => r),
      })),
    });
  }

  // Swap stored photo URLs for signed links (private bucket)
  const people: SheetPerson[] = sheets.flatMap((s) => s.sections.flatMap((sec) => sec.rows.flatMap((r) => [r, ...(r.runners || [])])));
  const withUrl = people.map((p) => ({ p, photo_url: p.photo }));
  await signAthletePhotos(withUrl);
  for (const w of withUrl) w.p.photo = w.photo_url;

  return sheets;
}
