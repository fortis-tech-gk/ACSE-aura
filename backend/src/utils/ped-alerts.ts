/**
 * Call room picture and push alerts for college PEDs (PED login in the AURA Athletes app).
 *
 * How athletes report differs by round (see routes/rollcall.routes.ts):
 *   - FIRST ROUND: an event roll call. Athletes check in for the whole event; "Prepare heats" then
 *     draws heats from those who reported (straight to the referee) and marks the rest DNS on the
 *     roll call. Heats drawn earlier by the meet office are thrown away and redrawn.
 *   - LATER ROUNDS (and a first round run without a roll call): the per-heat call room.
 * buildUnits() turns this into "units" — one per heat, or one per first-round roll call (before
 * it opens: the registered entrants) — used by the attendance screen and the alerts:
 *
 *   T30 / T20 / T10  — before the call room time: athletes of the college not yet reported
 *   CLOSED           — call room closed / heats prepared from the roll call: athletes marked DNS
 *   RESULT           — a heat is finalized: the college's marks and places
 *
 * Every alert is sent at most once per unit and college: it is "claimed" by inserting a row in
 * ped_alerts_sent first, so two API instances (or a cron call + the in-process timer) never
 * send the same alert twice. Sending is best-effort and never fails the request that caused it.
 */
import { supabase } from '../config/supabase';
import { fetchAll } from './fetch-all';
import { sendPushToColleges } from './push';
import { bestOf } from './result-marks';

const IST_OFFSET = '+05:30';
const DEFAULT_CALL_ROOM_LEAD_MIN = 30;
export const PED_ALERT_OFFSETS_MIN = [30, 20, 10] as const;
const OPEN_STATUSES = ['SCHEDULED', 'DELAYED', 'CALL_ROOM'];
const STAGE_RANK: Record<string, number> = { QUALIFYING: 1, HEATS: 1, SEMI_FINAL: 2, FINAL: 3 };
const WITHDRAWN = 'WITHDrAWN';
const MAX_NAMES = 8;

export function istIso(date?: string | null, time?: string | null): string | null {
  if (!date || !time) return null;
  const t = String(time).slice(0, 8);
  const iso = `${date}T${t.length === 5 ? `${t}:00` : t}${IST_OFFSET}`;
  return isNaN(new Date(iso).getTime()) ? null : iso;
}

export function istDate(ms = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ms));
}

const one = <T>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

/** Call room and start time from a schedule item (call room defaults to 30 min before the start) */
export function heatTimes(scheduleItem: any): { startAt: string | null; callRoomAt: string | null; callRoomEstimated: boolean; sessionName: string | null } {
  const si = one(scheduleItem) as any;
  const sess = one(si?.schedule_sessions as any) as any;
  const date = sess?.session_date as string | undefined;
  const startAt = istIso(date, si?.scheduled_time);
  let callRoomAt = istIso(date, si?.call_room_time);
  const callRoomEstimated = !callRoomAt && !!startAt;
  if (!callRoomAt && startAt) callRoomAt = new Date(new Date(startAt).getTime() - DEFAULT_CALL_ROOM_LEAD_MIN * 60000).toISOString();
  return { startAt, callRoomAt, callRoomEstimated, sessionName: sess?.session_name || null };
}

/**
 * REPORTED · NOT_REPORTED · DNS · SCRATCH · DQ (call room)
 * NOT_ACCREDITED / PAYMENT_PENDING — registered but cannot be on the roll call
 * NOT_ON_ROLL_CALL — registered but missing from an open roll call · REPLACED — a reserve came in
 */
export type EntryState = string;

export type PedEntry = {
  heatAthleteId: string;
  collegeId: string | null;
  gender: string | null;
  isMixedTeam: boolean;
  lane: number | null;
  profileId: string | null;
  relayTeamId: string | null;
  name: string;
  bib: number | null;
  state: EntryState;
};

/** The select used for heat entries everywhere in the PED views */
export const PED_ENTRY_SELECT = `
  id, heat_id, lane_number, call_room_reported, profile_id, relay_team_id,
  profiles ( id, sslc_name, bid_number, squads ( college_id, gender ) ),
  relay_teams ( id, squads ( college_id, gender ), relay_members ( leg_order, is_reserve, profiles ( sslc_name, bid_number ) ) ),
  call_room_inspections ( reported_status )
`;

function teamName(team: any, eventName: string): string {
  const runners = ((team?.relay_members || []) as any[])
    .filter((m) => !m.is_reserve)
    .sort((a, b) => (a.leg_order || 0) - (b.leg_order || 0))
    .map((m) => one(m.profiles as any) as any)
    .filter(Boolean)
    .map((pr: any) => pr.sslc_name);
  return `${eventName} team${runners.length ? ` (${runners.join(', ')})` : ''}`;
}

/** One heat_athletes row (PED_ENTRY_SELECT) → PedEntry */
export function toPedEntry(ha: any, eventName: string, isMixed = false): PedEntry {
  const insp = one(ha.call_room_inspections) as any;
  const inspStatus: string | null = insp?.reported_status || null;
  const state: EntryState = inspStatus && inspStatus !== 'REPORTED' ? inspStatus : ha.call_room_reported ? 'REPORTED' : 'NOT_REPORTED';
  const p = one(ha.profiles) as any;
  if (p) {
    const sq = one(p.squads) as any;
    return { heatAthleteId: ha.id, collegeId: sq?.college_id || null, gender: sq?.gender || null, isMixedTeam: false, lane: ha.lane_number ?? null, profileId: p.id, relayTeamId: null, name: p.sslc_name, bib: p.bid_number ?? null, state };
  }
  const team = one(ha.relay_teams) as any;
  const sq = one(team?.squads) as any;
  return {
    heatAthleteId: ha.id,
    collegeId: sq?.college_id || null,
    gender: sq?.gender || null,
    isMixedTeam: isMixed,
    lane: ha.lane_number ?? null,
    profileId: null,
    relayTeamId: team?.id || ha.relay_team_id || null,
    name: teamName(team, eventName),
    bib: null,
    state,
  };
}

// --------------------------------------------------------------------------------------------
// Units: heats and first-round roll calls
// --------------------------------------------------------------------------------------------

export type PedUnit = {
  /** 'heat:<id>' or 'rc:<event>:<stage>' — also the alert key */
  key: string;
  mode: 'HEAT' | 'ROLL_CALL' | 'NOT_OPEN';
  heatId: string | null;
  eventId: string;
  eventName: string;
  category: string;
  stage: string;
  heatNumber: number | null;
  /** HEAT: the heat status · ROLL_CALL: ROLL_CALL_OPEN | ROLL_CALL_DONE · NOT_OPEN: SCHEDULED */
  status: string;
  startAt: string | null;
  callRoomAt: string | null;
  callRoomEstimated: boolean;
  sessionName: string | null;
  entries: PedEntry[];
};

export type UnitScope = { collegeId: string; gender: 'men' | 'women' } | null;

const RC_ENTRY_SELECT = `
  id, status, substituted_for, profile_id, relay_team_id,
  profiles!roll_call_entries_profile_id_fkey ( id, sslc_name, bid_number, squads ( college_id, gender ) ),
  relay_teams ( id, squads ( college_id, gender ), relay_members ( leg_order, is_reserve, profiles ( sslc_name, bid_number ) ) )
`;

/** Units for these events. With a scope, only that college + squad's entries (mixed relay: either squad). */
export async function buildUnits(eventIds: string[], scope: UnitScope): Promise<PedUnit[]> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  if (!ids.length) return [];

  // The scope's athletes (registrations are read for them only)
  let scopeProfileIds: string[] | null = null;
  if (scope) {
    const { data: sq } = await supabase.from('squads').select('id').eq('college_id', scope.collegeId).eq('gender', scope.gender).maybeSingle();
    const { data: profs } = sq ? await supabase.from('profiles').select('id').eq('squad_id', sq.id) : { data: [] as any[] };
    scopeProfileIds = (profs || []).map((p: any) => p.id);
  }

  const regSelect = 'event_id, kind, profiles ( id, sslc_name, bid_number, accreditation_status, squads ( college_id, gender, payment_status ) )';
  const regChunks: Promise<any[]>[] = [];
  if (scopeProfileIds) {
    for (let i = 0; i < scopeProfileIds.length; i += 150) {
      const chunk = scopeProfileIds.slice(i, i + 150);
      regChunks.push(
        fetchAll<any>((from, to) =>
          supabase.from('registrations').select(regSelect).in('event_id', ids).in('profile_id', chunk).in('kind', ['regular', 'half_marathon']).order('id').range(from, to) as any
        )
      );
    }
  } else {
    regChunks.push(
      fetchAll<any>((from, to) => supabase.from('registrations').select(regSelect).in('event_id', ids).in('kind', ['regular', 'half_marathon']).order('id').range(from, to) as any)
    );
  }

  const [{ data: events }, items, heats, rollCalls, teams, regParts] = await Promise.all([
    supabase.from('events').select('id, name, code, category').in('id', ids),
    fetchAll<any>((from, to) =>
      supabase.from('schedule_items').select('id, event_id, stage, scheduled_time, call_room_time, schedule_sessions ( session_date, session_name )').in('event_id', ids).order('id').range(from, to) as any
    ),
    fetchAll<any>((from, to) =>
      supabase.from('heats').select(`id, event_id, stage, heat_number, status, schedule_item_id, heat_athletes ( ${PED_ENTRY_SELECT} )`).in('event_id', ids).order('id').range(from, to) as any
    ),
    fetchAll<any>((from, to) =>
      supabase.from('roll_calls').select(`id, event_id, stage, status, roll_call_entries ( ${RC_ENTRY_SELECT} )`).in('event_id', ids).order('id').range(from, to) as any
    ),
    fetchAll<any>((from, to) =>
      supabase
        .from('relay_teams')
        .select('id, event_id, squads ( college_id, gender, payment_status ), relay_members ( leg_order, is_reserve, profiles ( sslc_name, bid_number ) )')
        .in('event_id', ids)
        .order('id')
        .range(from, to) as any
    ),
    Promise.all(regChunks).then((parts) => parts.flat()),
  ]);

  const inScope = (e: PedEntry) =>
    !scope || (e.collegeId === scope.collegeId && (e.isMixedTeam || e.gender === scope.gender));

  // Schedule: by item id, and the earliest item per event + stage (heats without a schedule link)
  const itemById = new Map<string, any>(items.map((i) => [i.id, i]));
  const itemByStage = new Map<string, any>();
  for (const i of items) {
    const k = `${i.event_id}|${i.stage}`;
    const prev = itemByStage.get(k);
    const at = istIso(one(i.schedule_sessions as any)?.session_date, i.scheduled_time);
    const prevAt = prev ? istIso(one(prev.schedule_sessions as any)?.session_date, prev.scheduled_time) : null;
    if (!prev || String(at) < String(prevAt)) itemByStage.set(k, i);
  }

  const units: PedUnit[] = [];
  for (const ev of (events || []) as any[]) {
    const isMixed = String(ev.code || '').toUpperCase() === '4X400M-MIX';
    const evHeats = heats.filter((h) => h.event_id === ev.id);
    const stages = [...items.filter((i) => i.event_id === ev.id).map((i) => i.stage), ...evHeats.map((h) => h.stage)].filter((s) => s in STAGE_RANK);
    const firstStage = stages.sort((a, b) => STAGE_RANK[a] - STAGE_RANK[b])[0] || 'HEATS';
    const rc = rollCalls.find((r) => r.event_id === ev.id && r.stage === firstStage) || null;
    const firstItem = itemByStage.get(`${ev.id}|${firstStage}`) || null;

    // Heats (a first round with an OPEN roll call: its pre-drawn heats are redrawn, not shown)
    for (const h of evHeats) {
      if (h.stage === firstStage && rc && rc.status === 'OPEN') continue;
      const si = (h.schedule_item_id && itemById.get(h.schedule_item_id)) || itemByStage.get(`${ev.id}|${h.stage}`) || null;
      const entries = ((h.heat_athletes || []) as any[]).map((r) => toPedEntry(r, ev.name, isMixed)).filter(inScope);
      if (!entries.length) continue;
      entries.sort((a, b) => (a.lane ?? 99) - (b.lane ?? 99));
      units.push({
        key: `heat:${h.id}`,
        mode: 'HEAT',
        heatId: h.id,
        eventId: ev.id,
        eventName: ev.name,
        category: ev.category,
        stage: h.stage,
        heatNumber: h.heat_number ?? null,
        status: h.status,
        ...heatTimes(si),
        entries,
      });
    }

    const firstHasHeats = evHeats.some((h) => h.stage === firstStage);
    if (!rc && firstHasHeats) continue; // first round run on per-heat call rooms (done above)

    // Registered entrants of the first round (individual) or relay teams
    const regEntries: PedEntry[] = [];
    if (ev.category === 'relay') {
      for (const t of teams.filter((x) => x.event_id === ev.id)) {
        const sq = one(t.squads) as any;
        regEntries.push({
          heatAthleteId: `team:${t.id}`,
          collegeId: sq?.college_id || null,
          gender: sq?.gender || null,
          isMixedTeam: isMixed,
          lane: null,
          profileId: null,
          relayTeamId: t.id,
          name: teamName(t, ev.name),
          bib: null,
          state: sq?.payment_status !== 'VERIFIED' ? 'PAYMENT_PENDING' : 'NOT_REPORTED',
        });
      }
    } else {
      for (const r of regParts.filter((x) => x.event_id === ev.id)) {
        const p = one(r.profiles) as any;
        if (!p || p.accreditation_status === WITHDRAWN) continue;
        const sq = one(p.squads) as any;
        regEntries.push({
          heatAthleteId: `reg:${p.id}`,
          collegeId: sq?.college_id || null,
          gender: sq?.gender || null,
          isMixedTeam: false,
          lane: null,
          profileId: p.id,
          relayTeamId: null,
          name: p.sslc_name,
          bib: p.bid_number ?? null,
          state: p.accreditation_status !== 'ACCREDITED' ? 'NOT_ACCREDITED' : sq?.payment_status !== 'VERIFIED' ? 'PAYMENT_PENDING' : 'NOT_REPORTED',
        });
      }
    }

    let entries: PedEntry[];
    let mode: PedUnit['mode'];
    let status: string;
    if (rc) {
      mode = 'ROLL_CALL';
      status = rc.status === 'OPEN' ? 'ROLL_CALL_OPEN' : 'ROLL_CALL_DONE';
      const rcEntries = ((rc.roll_call_entries || []) as any[]).map((en): PedEntry => {
        const st = en.status === 'PENDING' ? 'NOT_REPORTED' : en.status;
        const p = one(en.profiles) as any;
        if (p) {
          const sq = one(p.squads) as any;
          return { heatAthleteId: `rce:${en.id}`, collegeId: sq?.college_id || null, gender: sq?.gender || null, isMixedTeam: false, lane: null, profileId: p.id, relayTeamId: null, name: p.sslc_name, bib: p.bid_number ?? null, state: st };
        }
        const t = one(en.relay_teams) as any;
        const sq = one(t?.squads) as any;
        return { heatAthleteId: `rce:${en.id}`, collegeId: sq?.college_id || null, gender: sq?.gender || null, isMixedTeam: isMixed, lane: null, profileId: null, relayTeamId: t?.id || en.relay_team_id, name: teamName(t, ev.name), bib: null, state: st };
      });
      const onList = new Set(rcEntries.map((e) => e.profileId || e.relayTeamId));
      const replaced = new Set(((rc.roll_call_entries || []) as any[]).map((en) => en.substituted_for).filter(Boolean));
      const missing = regEntries
        .filter((e) => !onList.has(e.profileId || e.relayTeamId))
        .map((e) => ({ ...e, state: e.profileId && replaced.has(e.profileId) ? 'REPLACED' : e.state === 'NOT_REPORTED' ? 'NOT_ON_ROLL_CALL' : e.state }));
      entries = [...rcEntries, ...missing];
    } else {
      mode = 'NOT_OPEN';
      status = 'SCHEDULED';
      entries = regEntries;
    }
    entries = entries.filter(inScope).sort((a, b) => a.name.localeCompare(b.name));
    if (!entries.length) continue;
    units.push({
      key: `rc:${ev.id}:${firstStage}`,
      mode,
      heatId: null,
      eventId: ev.id,
      eventName: ev.name,
      category: ev.category,
      stage: firstStage,
      heatNumber: null,
      status,
      ...heatTimes(firstItem),
      entries,
    });
  }

  return units.sort((a, b) => String(a.callRoomAt || a.startAt || '9').localeCompare(String(b.callRoomAt || b.startAt || '9')));
}

/** A unit whose call room is still to come or open (alerts and "Upcoming & live") */
export function unitIsOpen(u: PedUnit): boolean {
  if (u.mode === 'NOT_OPEN') return true;
  if (u.mode === 'ROLL_CALL') return u.status === 'ROLL_CALL_OPEN';
  return OPEN_STATUSES.includes(u.status);
}

// --------------------------------------------------------------------------------------------
// Sending
// --------------------------------------------------------------------------------------------

const ALERT_STATES = new Set(['NOT_REPORTED', 'NOT_ACCREDITED', 'PAYMENT_PENDING', 'NOT_ON_ROLL_CALL']);
const STATE_NOTE: Record<string, string> = {
  NOT_ACCREDITED: 'not accredited',
  PAYMENT_PENDING: 'payment not verified',
  NOT_ON_ROLL_CALL: 'not on the roll call',
};

function listNames(entries: PedEntry[]): string {
  const names = entries.map((e) => `${e.bib != null ? `${e.name} (#${e.bib})` : e.name}${STATE_NOTE[e.state] ? ` — ${STATE_NOTE[e.state]}` : ''}`);
  if (names.length <= MAX_NAMES) return names.join(', ');
  return `${names.slice(0, MAX_NAMES).join(', ')} and ${names.length - MAX_NAMES} more`;
}

function stageText(stage: string, heatNumber: number | null): string {
  if (stage === 'FINAL') return 'Final';
  const s = stage === 'SEMI_FINAL' ? 'Semi-final' : stage === 'QUALIFYING' ? 'Qualifying' : 'Heat';
  return heatNumber ? `${s} ${heatNumber}` : s === 'Heat' ? 'Round 1' : s;
}

function unitLabel(u: { eventName: string; stage: string; heatNumber: number | null }): string {
  return `${u.eventName} — ${stageText(u.stage, u.heatNumber)}`;
}

/** Take the alert for (key, college, kind). false when it was already sent. */
async function claim(alertKey: string, collegeId: string, kind: string): Promise<boolean> {
  const { error } = await supabase.from('ped_alerts_sent').insert({ alert_key: alertKey, college_id: collegeId, kind });
  if (!error) return true;
  if ((error as any).code !== '23505') console.warn('ped_alerts_sent claim failed:', error.message);
  return false;
}

function byCollege(entries: PedEntry[]): Map<string, PedEntry[]> {
  const m = new Map<string, PedEntry[]>();
  for (const e of entries) {
    if (!e.collegeId) continue;
    const list = m.get(e.collegeId) || [];
    list.push(e);
    m.set(e.collegeId, list);
  }
  return m;
}

/**
 * Sends the 30 / 20 / 10 minute alerts that are due now. Called every minute (Cloud Scheduler
 * → POST /api/internal/ped-alerts/tick, plus an in-process timer in production).
 * A tick that comes late sends only the most recent alert that is due (no burst of three).
 */
export async function runPedReminderTick(nowMs = Date.now()): Promise<{ units: number; sent: number }> {
  const today = istDate(nowMs);
  const { data: sessions } = await supabase.from('schedule_sessions').select('id').eq('session_date', today);
  const sessionIds = (sessions || []).map((s: any) => s.id);
  if (!sessionIds.length) return { units: 0, sent: 0 };
  const { data: items } = await supabase.from('schedule_items').select('event_id').in('session_id', sessionIds);
  const eventIds = Array.from(new Set((items || []).map((i: any) => i.event_id)));
  if (!eventIds.length) return { units: 0, sent: 0 };

  const units = await buildUnits(eventIds, null);
  let checked = 0;
  let sent = 0;
  for (const u of units) {
    if (!u.callRoomAt || !unitIsOpen(u)) continue;
    const minutesLeft = (new Date(u.callRoomAt).getTime() - nowMs) / 60000;
    if (minutesLeft <= 0 || minutesLeft > PED_ALERT_OFFSETS_MIN[0]) continue;
    const crossed = PED_ALERT_OFFSETS_MIN.filter((o) => minutesLeft <= o);
    const latest = Math.min(...crossed);
    checked += 1;

    for (const [collegeId, list] of byCollege(u.entries.filter((e) => ALERT_STATES.has(e.state)))) {
      // Claim every alert already due; send only if the latest one was not sent before
      let sendNow = false;
      for (const o of crossed) {
        const ok = await claim(u.key, collegeId, `T${o}`);
        if (o === latest) sendNow = ok;
      }
      if (!sendNow) continue;
      const mins = Math.max(1, Math.round(minutesLeft));
      sent += await sendPushToColleges([collegeId], {
        title: `⏰ Call room in ${mins} min — ${unitLabel(u)}`,
        body: `Not reported yet: ${listNames(list)}.`,
        data: { kind: 'ped-call-room', key: u.key, offset: latest },
      });
    }
  }
  return { units: checked, sent };
}

async function sendClosed(alertKey: string, label: string, dns: PedEntry[]) {
  for (const [collegeId, list] of byCollege(dns)) {
    if (!(await claim(alertKey, collegeId, 'CLOSED'))) continue;
    await sendPushToColleges([collegeId], {
      title: `🚨 Not reported — ${label}`,
      body: `Call room closed. Marked DNS: ${listNames(list)}.`,
      data: { kind: 'ped-call-room-closed', key: alertKey },
    });
  }
}

async function loadHeat(heatId: string): Promise<{ heat: any; entries: PedEntry[] } | null> {
  const { data: heat } = await supabase
    .from('heats')
    .select(`id, stage, heat_number, status, events ( id, name, code, category ), heat_athletes ( ${PED_ENTRY_SELECT} )`)
    .eq('id', heatId)
    .maybeSingle();
  if (!heat) return null;
  const ev = one((heat as any).events) as any;
  const isMixed = String(ev?.code || '').toUpperCase() === '4X400M-MIX';
  return { heat, entries: (((heat as any).heat_athletes || []) as any[]).map((r) => toPedEntry(r, ev?.name || 'Relay', isMixed)) };
}

/** Fire-and-forget after a heat's call room closes: who was marked DNS, per college */
export function notifyPedsCallRoomClosed(heatId: string): void {
  (async () => {
    const loaded = await loadHeat(heatId);
    if (!loaded) return;
    const ev = one(loaded.heat.events) as any;
    await sendClosed(`heat:${heatId}`, unitLabel({ eventName: ev?.name || 'Event', stage: loaded.heat.stage, heatNumber: loaded.heat.heat_number }), loaded.entries.filter((e) => e.state === 'DNS'));
  })().catch((err) => console.warn('notifyPedsCallRoomClosed failed:', err?.message));
}

/** Fire-and-forget after heats are prepared from a roll call: who was marked DNS, per college */
export function notifyPedsRollCallClosed(eventId: string, stage: string): void {
  (async () => {
    const units = await buildUnits([eventId], null);
    const u = units.find((x) => x.key === `rc:${eventId}:${stage}`);
    if (!u) return;
    await sendClosed(u.key, unitLabel(u), u.entries.filter((e) => e.state === 'DNS'));
  })().catch((err) => console.warn('notifyPedsRollCallClosed failed:', err?.message));
}

// --------------------------------------------------------------------------------------------
// Results
// --------------------------------------------------------------------------------------------

export function formatMark(value: number | null, category: string): string | null {
  if (value == null) return null;
  if (category === 'combined') return `${Math.round(value)} pts`;
  if (category.startsWith('field_')) return `${value.toFixed(2)} m`;
  if (value >= 60) {
    const m = Math.floor(value / 60);
    const s = value - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }
  return `${value.toFixed(2)} s`;
}

export function ordinal(n: number): string {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${suf}`;
}

export const RESULT_SELECT = `
  id, heat_id,
  track_results ( time_seconds, status, reaction_time_ms, wind_reading, dq_rule ),
  field_attempts ( round_number, attempt_type, mark_meters, wind_reading ),
  vertical_jump_attempts ( bar_height_meters, attempt_number, result )
`;

/** Mark and place in the heat of every entry (combined events: no places here) */
export function placeEntries(resultRows: any[], category: string): Map<string, { mark: string | null; status: string | null; place: number | null }> {
  const out = new Map<string, { mark: string | null; status: string | null; place: number | null }>();
  if (category === 'combined') return out;
  const lowerIsBetter = !category.startsWith('field_');
  const scored = resultRows.map((r) => ({ id: r.id as string, ...bestOf(r, category) }));
  for (const s of scored) {
    let place: number | null = null;
    if (s.value != null) {
      place = 1 + scored.filter((o) => o.value != null && (lowerIsBetter ? o.value < s.value! : o.value > s.value!)).length;
    }
    out.set(s.id, { mark: formatMark(s.value, category), status: s.status, place });
  }
  return out;
}

/** Fire-and-forget after a heat is finalized: each college's marks and places */
export function notifyPedsResults(heatId: string): void {
  (async () => {
    const loaded = await loadHeat(heatId);
    if (!loaded) return;
    const ev = one(loaded.heat.events) as any;
    const category: string = ev?.category || 'track_sprint';
    const { data: results } = await supabase.from('heat_athletes').select(RESULT_SELECT).eq('heat_id', heatId);
    const marks = placeEntries(results || [], category);
    const label = unitLabel({ eventName: ev?.name || 'Event', stage: loaded.heat.stage, heatNumber: loaded.heat.heat_number });
    for (const [collegeId, list] of byCollege(loaded.entries)) {
      if (!(await claim(`heat:${heatId}`, collegeId, 'RESULT'))) continue;
      const lines = list.map((e) => {
        const r = marks.get(e.heatAthleteId);
        if (e.state !== 'REPORTED' && e.state !== 'NOT_REPORTED') return `${e.name}: ${e.state}`;
        if (!r) return e.name;
        if (r.mark) return `${e.name}: ${r.mark}${r.place ? ` (${ordinal(r.place)})` : ''}`;
        return `${e.name}: ${r.status || '—'}`;
      });
      await sendPushToColleges([collegeId], {
        title: `🏁 Results — ${label}`,
        body: category === 'combined' ? 'Results are in. Open the app for points.' : lines.join(' · '),
        data: { kind: 'ped-result', heatId },
      });
    }
  })().catch((err) => console.warn('notifyPedsResults failed:', err?.message));
}
