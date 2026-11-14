/**
 * What happens when a referee finalizes a heat / flight:
 *
 *   1. The heat is marked COMPLETED (results become public on /api/live/results).
 *   2. When every heat of that round is done, the next round is built automatically
 *      (VTU rule: the first 2 of each heat qualify — no fastest-time qualifiers; ties for
 *      2nd place both go through). The next round is the next stage on the schedule for that
 *      event (HEATS → SEMI_FINAL → FINAL), or FINAL when no semi-final is scheduled.
 *   3. When every section of the FINAL is done, championship points are awarded. A final run
 *      in several sections (e.g. 5000m) is ranked across all sections by time.
 *   4. Live results, leaderboard and schedule caches are cleared, and qualified athletes get a
 *      push notification.
 *
 * Event, stage and heat always come from the database — never from the app (audit #6).
 */
import { supabase } from '../config/supabase';
import { invalidateCache } from '../middleware/cache';
import { sendPushToProfiles } from './push';
import type { TokenPayload } from '../middleware/auth';

/** VTU rule (docs/rules/vtu_rules.txt): top 2 from each heat, no time qualifiers */
export const QUALIFY_PER_HEAT = 2;
const STAGE_ORDER = ['HEATS', 'SEMI_FINAL', 'FINAL'] as const;
const DONE = ['COMPLETED', 'OFFICIAL'];

export class ProgressionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type HeatRow = {
  id: string;
  event_id: string;
  stage: string;
  heat_number: number;
  status: string;
  events: { id: string; name: string; code: string; category: string; start_type: string; max_lanes: number | null } | null;
};

/** A referee with assigned events may only write those events (audit #5). Admins may write any. */
export function assertEventScope(user: TokenPayload, eventId: string) {
  if (user.role === 'meet_admin') return;
  const scope = user.scopeEventIds || [];
  if (scope.length && !scope.includes(eventId)) {
    throw new ProgressionError('This event is not assigned to you. Ask the meet office.', 403);
  }
}

/** Heat of a heat_athlete row, for scope and "already finalized" checks on result writes */
export async function heatOfEntry(heatAthleteId: string): Promise<{ id: string; event_id: string; status: string } | null> {
  const { data } = await supabase.from('heat_athletes').select('heats(id, event_id, status)').eq('id', heatAthleteId).maybeSingle();
  const h: any = (data as any)?.heats;
  return (Array.isArray(h) ? h[0] : h) || null;
}

/**
 * Checks before a referee writes a result for an entry: the entry exists, the event is the
 * referee's, and the heat is not finalized yet (audit #4 — results changed after finalizing
 * would not update the medals). Returns the event id.
 */
export async function assertCanWriteEntry(user: TokenPayload, heatAthleteId: string): Promise<string> {
  const heat = await heatOfEntry(heatAthleteId);
  if (!heat) throw new ProgressionError('Entry not found in any heat.', 404);
  assertEventScope(user, heat.event_id);
  if (user.role === 'meet_admin') return heat.event_id;
  if (DONE.includes(heat.status)) {
    throw new ProgressionError('This heat is already finalized. Ask the meet office to reopen it.', 409);
  }
  // Strict call room: no results until the call room has closed, and only for entries that
  // reported (a relay team counts as one entry). Mistakes are corrected by the call room.
  assertCallRoomClosed(heat.status);
  const { data: entry } = await supabase.from('heat_athletes').select('call_room_reported').eq('id', heatAthleteId).maybeSingle();
  if (!entry?.call_room_reported) {
    throw new ProgressionError('This athlete did not report to the call room, so no result can be entered. If that is a mistake, the call room official must correct it first.', 409);
  }
  return heat.event_id;
}

/** Results can be entered only after the call room closed (heat sent to the track) */
export function assertCallRoomClosed(status: string) {
  if (['SCHEDULED', 'DELAYED', 'CALL_ROOM'].includes(status)) {
    throw new ProgressionError("The call room for this heat isn't closed yet. Results can be entered after it closes.", 409);
  }
}

const isTrack = (category: string) => !category.startsWith('field');

/** Finishers of the given heats with their time, best first */
async function trackFinishers(heatIds: string[]) {
  const { data, error } = await supabase
    .from('heat_athletes')
    .select('id, heat_id, profile_id, relay_team_id, track_results(time_seconds, status)')
    .in('heat_id', heatIds);
  if (error) throw new ProgressionError(error.message);
  return (data || [])
    .map((r: any) => {
      const tr = Array.isArray(r.track_results) ? r.track_results[0] : r.track_results;
      return { heatId: r.heat_id as string, profileId: r.profile_id as string | null, relayTeamId: r.relay_team_id as string | null, status: tr?.status, time: tr?.time_seconds != null ? Number(tr.time_seconds) : null };
    })
    .filter((r) => r.status === 'FINISHED' && r.time != null)
    .sort((a, b) => a.time! - b.time!);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Lanes for one heat of seeded runners (best first), World Athletics style: the best 4 are
 * drawn into lanes 3–6, the next 2 into lanes 7–8, the rest into lanes 1–2. Fewer runners
 * use the middle lanes. Non-lane races get start positions 1..n by seed.
 */
export function assignLanes(seeded: string[], lanes: boolean, maxLanes: number): Map<string, number> {
  const out = new Map<string, number>();
  if (!lanes) {
    seeded.forEach((id, i) => out.set(id, i + 1));
    return out;
  }
  const groups: number[][] = maxLanes >= 8 ? [[3, 4, 5, 6], [7, 8], [1, 2]] : [Array.from({ length: maxLanes }, (_, i) => i + 1)];
  let k = 0;
  for (const g of groups) {
    const take = seeded.slice(k, k + g.length);
    if (!take.length) break;
    // With fewer runners than the group, use the lanes nearest the middle of the group
    const lanesHere = take.length < g.length ? [...g].sort((a, b) => Math.abs(a - 4.5) - Math.abs(b - 4.5)).slice(0, take.length) : g;
    shuffle(lanesHere).forEach((lane, i) => out.set(take[i], lane));
    k += take.length;
  }
  // Overflow (more runners than lanes) — should not happen; keep them after the last lane
  seeded.slice(k).forEach((id, i) => out.set(id, maxLanes + i + 1));
  return out;
}

type Finisher = { heatId: string; profileId: string | null; relayTeamId: string | null; time: number | null };

/** First QUALIFY_PER_HEAT finishers of each heat (ties for the last place all qualify), fastest first */
export function pickQualifiers<F extends Finisher>(heatIds: string[], finishers: F[]): F[] {
  const out: F[] = [];
  for (const id of heatIds) {
    const inHeat = finishers.filter((f) => f.heatId === id && f.time != null).sort((a, b) => a.time! - b.time!);
    const cut = inHeat[QUALIFY_PER_HEAT - 1]?.time;
    out.push(...inHeat.filter((f, i) => i < QUALIFY_PER_HEAT || (cut != null && f.time === cut)));
  }
  return out.sort((a, b) => a.time! - b.time!);
}

/** Serpentine seeding of ids (best first) into n heats: 1,2,3 / 6,5,4 / 7,8,9 … */
export function seedHeats(ids: string[], n: number): string[][] {
  const perHeat: string[][] = Array.from({ length: n }, () => []);
  ids.forEach((id, i) => {
    const row = Math.floor(i / n);
    perHeat[row % 2 === 0 ? i % n : n - 1 - (i % n)].push(id);
  });
  return perHeat;
}

/** Build the next round from a completed round. Returns null when it cannot or need not be built. */
async function buildNextRound(heat: HeatRow, roundHeats: HeatRow[]) {
  const ev = heat.events!;
  if (!isTrack(ev.category)) return null; // field events are "Trial & Final" — no rounds here
  const cur = STAGE_ORDER.indexOf(heat.stage as any);
  if (cur < 0 || heat.stage === 'FINAL') return null;

  // Next stage on the schedule for this event (fallback: FINAL)
  const { data: items } = await supabase.from('schedule_items').select('id, stage').eq('event_id', ev.id);
  const scheduled = new Set((items || []).map((i: any) => i.stage));
  const nextStage = STAGE_ORDER.slice(cur + 1).find((s) => scheduled.has(s)) || 'FINAL';
  const scheduleItemId = (items || []).find((i: any) => i.stage === nextStage)?.id ?? null;

  // Already built and under way? Leave it alone.
  const { data: existing } = await supabase.from('heats').select('id, status, heat_athletes(id, track_results(id))').eq('event_id', ev.id).eq('stage', nextStage);
  const started = (existing || []).some((h: any) => h.status !== 'SCHEDULED' || (h.heat_athletes || []).some((a: any) => (Array.isArray(a.track_results) ? a.track_results.length : a.track_results)));
  if (started) return { nextStage, skipped: 'The next round has already started — not rebuilt.' };

  const finishers = await trackFinishers(roundHeats.map((h) => h.id));
  const qualified = pickQualifiers(roundHeats.map((h) => h.id), finishers);
  if (!qualified.length) throw new ProgressionError('No finishers to qualify for the next round.');

  // How many heats: one per max_lanes runners for lane races; a single race otherwise
  const lanes = ev.start_type === 'lanes';
  const maxLanes = ev.max_lanes || 8;
  const nHeats = lanes && nextStage !== 'FINAL' ? Math.max(1, Math.ceil(qualified.length / maxLanes)) : 1;
  const perHeat = seedHeats(qualified.map((q) => (q.profileId || q.relayTeamId)!), nHeats);

  // Replace any not-started draft of the next round, then create it
  if ((existing || []).length) {
    const { error } = await supabase.from('heats').delete().in('id', (existing || []).map((h: any) => h.id));
    if (error) throw new ProgressionError(`Could not clear the old ${nextStage} draft: ${error.message}`);
  }
  const relay = ev.category === 'relay';
  const created: { heatId: string; heatNumber: number; entries: number }[] = [];
  for (let n = 0; n < nHeats; n++) {
    const { data: h, error } = await supabase
      .from('heats')
      .insert({ event_id: ev.id, stage: nextStage, heat_number: n + 1, status: 'SCHEDULED', schedule_item_id: scheduleItemId })
      .select('id')
      .single();
    if (error || !h) throw new ProgressionError(`Could not create the ${nextStage} heat: ${error?.message}`);
    const laneOf = assignLanes(perHeat[n], lanes, maxLanes);
    const rows = perHeat[n].map((id) => {
      const q = qualified.find((x) => (x.profileId || x.relayTeamId) === id)!;
      return {
        heat_id: h.id,
        profile_id: relay ? null : id,
        relay_team_id: relay ? id : null,
        lane_number: laneOf.get(id)!,
        seed_mark: q.time != null ? q.time.toFixed(2) : '',
      };
    });
    const { error: insErr } = await supabase.from('heat_athletes').insert(rows);
    if (insErr) throw new ProgressionError(`Could not place qualifiers: ${insErr.message}`);
    created.push({ heatId: h.id, heatNumber: n + 1, entries: rows.length });
  }

  // Tell the qualified athletes (relays: every runner of the team)
  const profileIds = relay
    ? ((await supabase.from('relay_members').select('profile_id').in('relay_team_id', qualified.map((q) => q.relayTeamId!))).data || []).map((m: any) => m.profile_id)
    : qualified.map((q) => q.profileId!);
  const stageName = nextStage === 'FINAL' ? 'the final' : 'the semi-final';
  sendPushToProfiles(profileIds, {
    title: `✅ Qualified — ${ev.name}`,
    body: `You are through to ${stageName}. Check the app for your heat and lane.`,
    data: { kind: 'qualified', eventId: ev.id },
  }).catch(() => {});

  return { nextStage, heats: created, qualified: qualified.length };
}

const POINTS = (code: string, category: string) =>
  code.toUpperCase() === '4X400M-MIX' ? [0, 0, 0] : category === 'relay' ? [10, 6, 2] : [5, 3, 1];

/** Points for a FINAL. One section: the database function. Several sections: ranked by time across all. */
async function awardPoints(heat: HeatRow, finalHeats: HeatRow[]) {
  const ev = heat.events!;
  if (finalHeats.length === 1 || !isTrack(ev.category)) {
    const target = finalHeats.length === 1 ? finalHeats[0].id : heat.id;
    const { data, error } = await supabase.rpc('allocate_event_points', { p_event_id: ev.id, p_heat_id: target });
    if (error) throw new ProgressionError(`Results saved, but points could not be awarded: ${error.message}`);
    return data;
  }

  // Final run in sections (audit #3): top 3 by time over every section
  const top = (await trackFinishers(finalHeats.map((h) => h.id))).slice(0, 3);
  const pts = POINTS(ev.code, ev.category);
  const rows = [];
  for (let i = 0; i < top.length; i++) {
    const t = top[i];
    let squad: any = null;
    if (t.profileId) squad = (await supabase.from('profiles').select('squads(id, college_id)').eq('id', t.profileId).maybeSingle()).data?.squads;
    else squad = (await supabase.from('relay_teams').select('squads(id, college_id)').eq('id', t.relayTeamId!).maybeSingle()).data?.squads;
    squad = Array.isArray(squad) ? squad[0] : squad;
    if (!squad) continue;
    rows.push({ event_id: ev.id, heat_id: t.heatId, college_id: squad.college_id, squad_id: squad.id, profile_id: t.profileId, relay_team_id: t.relayTeamId, place: i + 1, points: pts[i] });
  }
  const { error: delErr } = await supabase.from('team_points').delete().eq('event_id', ev.id);
  if (delErr) throw new ProgressionError(`Results saved, but points could not be awarded: ${delErr.message}`);
  if (rows.length) {
    const { error } = await supabase.from('team_points').insert(rows);
    if (error) throw new ProgressionError(`Results saved, but points could not be awarded: ${error.message}`);
  }
  return { status: 'SUCCESS', event_id: ev.id, placers_awarded: rows.length, sections: finalHeats.length };
}

/** Finalize a heat and run everything that follows from it. */
export async function finalizeHeat(heatId: string, user: TokenPayload) {
  const { data: heat, error } = await supabase
    .from('heats')
    .select('id, event_id, stage, heat_number, status, events(id, name, code, category, start_type, max_lanes)')
    .eq('id', heatId)
    .maybeSingle();
  if (error) throw new ProgressionError(error.message);
  if (!heat) throw new ProgressionError('Heat not found.', 404);
  const h = { ...(heat as any), events: Array.isArray((heat as any).events) ? (heat as any).events[0] : (heat as any).events } as HeatRow;
  assertEventScope(user, h.event_id);
  if (user.role !== 'meet_admin') assertCallRoomClosed(h.status);

  if (!DONE.includes(h.status)) {
    const { error: upErr } = await supabase.from('heats').update({ status: 'COMPLETED' }).eq('id', heatId);
    if (upErr) throw new ProgressionError(`Could not mark the heat done: ${upErr.message}`);
    h.status = 'COMPLETED';
  }

  // Every heat of this round
  const { data: round } = await supabase.from('heats').select('id, event_id, stage, heat_number, status').eq('event_id', h.event_id).eq('stage', h.stage);
  const roundHeats = ((round || []) as any[]).map((r) => ({ ...r, events: h.events })) as HeatRow[];
  const waiting = roundHeats.filter((r) => !DONE.includes(r.status)).map((r) => r.heat_number);

  let nextRound: any = null;
  let pointsAwarded: any = null;
  if (!waiting.length) {
    if (h.stage === 'FINAL') pointsAwarded = await awardPoints(h, roundHeats);
    else nextRound = await buildNextRound(h, roundHeats);
  }

  invalidateCache('live');
  invalidateCache('leaderboard');
  invalidateCache('schedule');

  return {
    success: true,
    heatId,
    status: 'COMPLETED',
    stage: h.stage,
    roundComplete: !waiting.length,
    waitingFor: waiting.sort((a, b) => a - b),
    nextRound,
    pointsAwarded,
    published: true,
  };
}
