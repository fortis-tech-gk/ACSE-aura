import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { invalidateCache } from '../middleware/cache';
import { fetchAll } from '../utils/fetch-all';
import { sendPushToProfiles } from '../utils/push';
import { passwordFingerprint } from '../utils/passphrase';
import {
  buildUnits,
  heatTimes,
  toPedEntry,
  PED_ENTRY_SELECT,
  RESULT_SELECT,
  placeEntries,
  type PedEntry,
} from '../utils/ped-alerts';

/**
 * College PED in the AURA Athletes app. One login per college (role 'ped', collegeId in the
 * token); every request names the squad it works on with ?gender=men|women (or in the body).
 *
 *   GET  /api/ped/me                      college + its squads
 *   GET  /api/ped/entries?gender=         athletes, individual events (entries + reserves), relay teams, deadlines
 *   POST /api/ped/reserve-swap            { eventId, outProfileId, reserveProfileId, giveUpEventId? }
 *   POST /api/ped/relay-runners           { relayTeamId, runnerIds: [leg1, leg2, leg3, leg4] }
 *   GET  /api/ped/attendance?gender=      every heat with the squad's athletes: call room state per athlete
 *   GET  /api/ped/results?gender=         finished heats: the squad's marks and places
 *   POST/DELETE /api/ped/push-token       register this phone for PED alerts
 *
 * Reserve swaps and relay runners close at 22:00 IST the day before the event (enforced in the
 * database: ped_swap_reserve / ped_set_relay_runners, migration 0053).
 */
export const pedRouter = Router();
pedRouter.use(authenticate);
pedRouter.use(requireRole(['ped']));

// The token stays valid only while the password it was issued with is still a squad password of
// the college: an admin password reset logs the PED out everywhere.
pedRouter.use(async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { data: squads } = await supabase.from('squads').select('passphrase_hash').eq('college_id', req.user!.collegeId!);
    const ok = !!req.user!.pwv && (squads || []).some((s: any) => s.passphrase_hash && passwordFingerprint(s.passphrase_hash) === req.user!.pwv);
    if (!ok) return res.status(401).json({ error: 'Your college password was changed. Please log in again.' });
    return next();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

const WITHDRAWN = 'WITHDrAWN';
const DONE = ['COMPLETED', 'OFFICIAL'];
const one = <T>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

type Gender = 'men' | 'women';
function genderOf(v: unknown): Gender | null {
  const g = String(v || '').toLowerCase();
  return g === 'men' || g === 'women' ? g : null;
}

async function squadOf(collegeId: string, gender: Gender): Promise<{ id: string; gender: Gender } | null> {
  const { data } = await supabase.from('squads').select('id, gender').eq('college_id', collegeId).eq('gender', gender).maybeSingle();
  return (data as any) || null;
}

/** 22:00 IST the day before the event's first scheduled session (null: not on the schedule yet) */
async function deadlines(eventIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>(eventIds.map((id) => [id, null]));
  if (!eventIds.length) return out;
  const { data } = await supabase.from('schedule_items').select('event_id, schedule_sessions ( session_date )').in('event_id', eventIds);
  const first = new Map<string, string>();
  for (const r of (data || []) as any[]) {
    const d = one(r.schedule_sessions as any) as any;
    const date: string | undefined = d?.session_date;
    if (!date) continue;
    const cur = first.get(r.event_id);
    if (!cur || date < cur) first.set(r.event_id, date);
  }
  for (const [eventId, date] of first) {
    const prev = new Date(`${date}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    out.set(eventId, `${prev.toISOString().slice(0, 10)}T22:00:00+05:30`);
  }
  return out;
}

/** Events in which a heat has already left SCHEDULED (call room opened or later) */
async function startedEvents(eventIds: string[]): Promise<Set<string>> {
  if (!eventIds.length) return new Set();
  const { data } = await supabase.from('heats').select('event_id, status').in('event_id', eventIds).not('status', 'in', '(SCHEDULED,DELAYED)');
  return new Set((data || []).map((h: any) => h.event_id));
}

function dbError(res: Response, error: any) {
  const msg = String(error?.message || 'Could not save the change.');
  if (error?.hint === 'GIVE_UP_REQUIRED') return res.status(409).json({ error: msg, code: 'GIVE_UP_REQUIRED' });
  return res.status(400).json({ error: msg });
}

/**
 * GET /api/ped/me
 */
pedRouter.get('/me', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const collegeId = req.user!.collegeId!;
    const [{ data: college }, { data: squads }] = await Promise.all([
      supabase.from('colleges').select('id, name, code').eq('id', collegeId).maybeSingle(),
      supabase.from('squads').select('id, gender, ped_name').eq('college_id', collegeId),
    ]);
    if (!college) return res.status(404).json({ error: 'College not found.' });
    return res.json({ college, squads: squads || [], serverTime: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ped/entries?gender=men
 */
pedRouter.get('/entries', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const collegeId = req.user!.collegeId!;
    const gender = genderOf(req.query.gender);
    if (!gender) return res.status(400).json({ error: 'Choose Men or Women.' });
    const squad = await squadOf(collegeId, gender);
    if (!squad) return res.json({ athletes: [], events: [], relays: [], serverTime: new Date().toISOString() });

    const { data: athletes } = await supabase
      .from('profiles')
      .select('id, sslc_name, bid_number, accreditation_status, registrations ( event_id, kind, events ( id, name, code, category ) )')
      .eq('squad_id', squad.id)
      .neq('accreditation_status', WITHDRAWN)
      .order('sslc_name');

    type Ath = { id: string; name: string; bib: number | null; accredited: boolean; regulars: { id: string; name: string }[]; reserve: { id: string; name: string } | null };
    const aths: Ath[] = (athletes || []).map((a: any) => {
      const regs = (a.registrations || []) as any[];
      const regulars = regs.filter((r) => r.kind === 'regular' && r.events).map((r) => ({ id: r.events.id, name: r.events.name }));
      const res = regs.find((r) => r.kind === 'reserve' && r.events);
      return { id: a.id, name: a.sslc_name, bib: a.bid_number ?? null, accredited: a.accreditation_status === 'ACCREDITED', regulars, reserve: res ? { id: res.events.id, name: res.events.name } : null };
    });

    // Individual events: the squad's entries and reserves
    const eventMap = new Map<string, { id: string; name: string; code: string; entries: Ath[]; reserves: Ath[] }>();
    for (const a of athletes || []) {
      for (const r of ((a as any).registrations || []) as any[]) {
        if (!r.events || (r.kind !== 'regular' && r.kind !== 'reserve')) continue;
        const ev = eventMap.get(r.events.id) || { id: r.events.id, name: r.events.name, code: r.events.code, entries: [], reserves: [] };
        const ath = aths.find((x) => x.id === (a as any).id)!;
        (r.kind === 'regular' ? ev.entries : ev.reserves).push(ath);
        eventMap.set(r.events.id, ev);
      }
    }

    // Relay teams: the squad's own (divisional) + the college's mixed team
    const { data: teams } = await supabase
      .from('relay_teams')
      .select('id, squad_id, events ( id, name, code ), squads!inner ( college_id ), relay_members ( profile_id, leg_order, is_reserve, profiles ( sslc_name, bid_number, accreditation_status, squads ( gender ) ) )')
      .eq('squads.college_id', collegeId);
    const relays = ((teams || []) as any[])
      .map((t) => {
        const ev = one(t.events) as any;
        const isMixed = String(ev?.code || '').toUpperCase() === '4X400M-MIX';
        return { t, ev, isMixed };
      })
      .filter(({ t, isMixed }) => isMixed || t.squad_id === squad.id);

    const eventIds = [...eventMap.keys(), ...relays.map((r) => r.ev?.id).filter(Boolean)];
    const [dl, started] = await Promise.all([deadlines(eventIds), startedEvents(eventIds)]);
    const now = Date.now();
    const isOpen = (eventId: string) => {
      const d = dl.get(eventId);
      return !started.has(eventId) && (!d || now <= new Date(d).getTime());
    };

    const events = [...eventMap.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        id: e.id,
        name: e.name,
        code: e.code,
        deadline: dl.get(e.id) || null,
        open: isOpen(e.id),
        entries: e.entries.map((a) => ({ id: a.id, name: a.name, bib: a.bib })),
        reserves: e.reserves.map((a) => ({
          id: a.id,
          name: a.name,
          bib: a.bib,
          // The roll call lists accredited athletes only: a reserve swapped in must be accredited in time
          accredited: a.accredited,
          // The events this reserve could give up (if they already have 2)
          regulars: a.regulars.map((r) => ({ ...r, open: isOpen(r.id) })),
        })),
      }));

    return res.json({
      squad,
      athletes: aths,
      events,
      relays: relays
        .sort((a, b) => String(a.ev?.name).localeCompare(String(b.ev?.name)))
        .map(({ t, ev, isMixed }) => ({
          teamId: t.id,
          eventId: ev?.id,
          eventName: ev?.name,
          isMixed,
          deadline: dl.get(ev?.id) || null,
          open: isOpen(ev?.id),
          members: ((t.relay_members || []) as any[])
            .map((m) => {
              const p = one(m.profiles as any) as any;
              return {
                id: m.profile_id,
                name: p?.sslc_name || '',
                bib: p?.bid_number ?? null,
                gender: (one(p?.squads as any) as any)?.gender || null,
                withdrawn: p?.accreditation_status === WITHDRAWN,
                leg: m.leg_order ?? null,
                isReserve: !!m.is_reserve,
              };
            })
            .sort((a, b) => (a.leg ?? 9) - (b.leg ?? 9) || a.name.localeCompare(b.name)),
        })),
      serverTime: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ped/reserve-swap  { eventId, outProfileId, reserveProfileId, giveUpEventId? }
 */
pedRouter.post('/reserve-swap', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId, outProfileId, reserveProfileId, giveUpEventId } = req.body || {};
    if (!eventId || !outProfileId || !reserveProfileId) {
      return res.status(400).json({ error: 'Choose the event, the athlete going out and the reserve coming in.' });
    }
    const { data, error } = await supabase.rpc('ped_swap_reserve', {
      p_college_id: req.user!.collegeId,
      p_event_id: eventId,
      p_out_profile_id: outProfileId,
      p_reserve_profile_id: reserveProfileId,
      p_give_up_event_id: giveUpEventId || null,
    });
    if (error) return dbError(res, error);
    invalidateCache('schedule');
    invalidateCache('live');
    // Both athletes' apps refetch their events and reschedule call room reminders
    const r: any = data || {};
    sendPushToProfiles([reserveProfileId], {
      title: `✅ You are in: ${r.event}`,
      body: `Your college PED entered you in ${r.event} in place of ${r.out}.${r.gaveUp ? ` You no longer run ${r.gaveUp}.` : ''} Check your events in the app.`,
      data: { kind: 'schedule-changed' },
    }).catch(() => {});
    sendPushToProfiles([outProfileId], {
      title: `Removed from ${r.event}`,
      body: `Your college PED replaced you in ${r.event} with ${r.in}.`,
      data: { kind: 'schedule-changed' },
    }).catch(() => {});
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ped/relay-runners  { relayTeamId, runnerIds: [leg1, leg2, leg3, leg4] }
 */
pedRouter.post('/relay-runners', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { relayTeamId, runnerIds } = req.body || {};
    if (!relayTeamId || !Array.isArray(runnerIds) || runnerIds.length !== 4 || runnerIds.some((x: unknown) => typeof x !== 'string')) {
      return res.status(400).json({ error: 'Choose exactly 4 runners, in leg order.' });
    }
    const { data, error } = await supabase.rpc('ped_set_relay_runners', {
      p_college_id: req.user!.collegeId,
      p_relay_team_id: relayTeamId,
      p_runner_ids: runnerIds,
    });
    if (error) return dbError(res, error);
    invalidateCache('schedule');
    invalidateCache('live');
    // Every member of the team learns their leg (or that they are a reserve)
    const evName = (data as any)?.event || 'Relay';
    supabase
      .from('relay_members')
      .select('profile_id, leg_order, is_reserve')
      .eq('relay_team_id', relayTeamId)
      .then(({ data: members }) => {
        for (const m of (members || []) as any[]) {
          sendPushToProfiles([m.profile_id], {
            title: `${evName}: ${m.is_reserve ? 'you are a reserve' : `you run leg ${m.leg_order}`}`,
            body: 'Your college PED set the relay line-up.',
            data: { kind: 'schedule-changed' },
          }).catch(() => {});
        }
      });
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** The squad's heat entries (individual + relay teams, incl. the college's mixed relay team) */
async function squadHeatEntries(collegeId: string, squadId: string): Promise<any[]> {
  const [{ data: profiles }, { data: teams }] = await Promise.all([
    supabase.from('profiles').select('id').eq('squad_id', squadId),
    supabase.from('relay_teams').select('id, squad_id, events ( code ), squads!inner ( college_id )').eq('squads.college_id', collegeId),
  ]);
  const profileIds = (profiles || []).map((p: any) => p.id);
  const teamIds = ((teams || []) as any[])
    .filter((t) => t.squad_id === squadId || String((one(t.events) as any)?.code || '').toUpperCase() === '4X400M-MIX')
    .map((t) => t.id);

  const heatSelect = `${PED_ENTRY_SELECT.trim()},
    heats ( id, stage, heat_number, status, events ( id, name, code, category ), schedule_items ( scheduled_time, call_room_time, schedule_sessions ( session_date, session_name ) ) )`;
  const chunks: string[][] = [];
  for (let i = 0; i < profileIds.length; i += 150) chunks.push(profileIds.slice(i, i + 150));
  const results = await Promise.all([
    ...chunks.map((ids) => fetchAll<any>((from, to) => supabase.from('heat_athletes').select(heatSelect).in('profile_id', ids).order('id').range(from, to))),
    teamIds.length ? fetchAll<any>((from, to) => supabase.from('heat_athletes').select(heatSelect).in('relay_team_id', teamIds).order('id').range(from, to)) : Promise.resolve([] as any[]),
  ]);
  return results.flat();
}

type HeatView = {
  heatId: string;
  eventId: string;
  eventName: string;
  category: string;
  stage: string;
  heatNumber: number | null;
  status: string;
  startAt: string | null;
  callRoomAt: string | null;
  callRoomEstimated: boolean;
  sessionName: string | null;
  entries: (PedEntry & { mark?: string | null; place?: number | null; resultStatus?: string | null })[];
};

function groupByHeat(rows: any[]): HeatView[] {
  const byHeat = new Map<string, HeatView>();
  for (const r of rows) {
    const h = one(r.heats) as any;
    if (!h) continue;
    const ev = one(h.events) as any;
    let v = byHeat.get(h.id);
    if (!v) {
      const t = heatTimes(h.schedule_items);
      const si = one(h.schedule_items) as any;
      v = {
        heatId: h.id,
        eventId: ev?.id,
        eventName: ev?.name || 'Event',
        category: ev?.category || '',
        stage: h.stage,
        heatNumber: h.heat_number ?? null,
        status: h.status,
        ...t,
        sessionName: (one(si?.schedule_sessions) as any)?.session_name || null,
        entries: [],
      };
      byHeat.set(h.id, v);
    }
    if (!v.entries.some((e) => e.heatAthleteId === r.id)) v.entries.push(toPedEntry(r, v.eventName));
  }
  const list = [...byHeat.values()];
  for (const v of list) v.entries.sort((a, b) => (a.lane ?? 99) - (b.lane ?? 99));
  return list.sort((a, b) => String(a.callRoomAt || a.startAt || '9').localeCompare(String(b.callRoomAt || b.startAt || '9')));
}

/**
 * GET /api/ped/attendance?gender=men
 * One card per heat, or per first-round roll call (or, before it opens, the registered entrants),
 * with each athlete's call room state. See buildUnits() in utils/ped-alerts.ts.
 */
pedRouter.get('/attendance', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const collegeId = req.user!.collegeId!;
    const gender = genderOf(req.query.gender);
    if (!gender) return res.status(400).json({ error: 'Choose Men or Women.' });
    const squad = await squadOf(collegeId, gender);
    if (!squad) return res.json({ units: [], serverTime: new Date().toISOString() });

    // Every event the squad is in: own entries (incl. reserves — a reserve may be brought in at the
    // call room), its relay teams and the college's mixed relay team
    const { data: profiles } = await supabase.from('profiles').select('id, registrations ( event_id )').eq('squad_id', squad.id);
    const eventIds = new Set<string>();
    for (const p of (profiles || []) as any[]) for (const r of p.registrations || []) eventIds.add(r.event_id);
    const { data: teams } = await supabase.from('relay_teams').select('event_id, squads!inner ( college_id )').eq('squads.college_id', collegeId);
    for (const t of (teams || []) as any[]) eventIds.add(t.event_id);

    const units = await buildUnits([...eventIds], { collegeId, gender });
    return res.json({ units, serverTime: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ped/results?gender=men
 */
pedRouter.get('/results', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const collegeId = req.user!.collegeId!;
    const gender = genderOf(req.query.gender);
    if (!gender) return res.status(400).json({ error: 'Choose Men or Women.' });
    const squad = await squadOf(collegeId, gender);
    if (!squad) return res.json({ heats: [], serverTime: new Date().toISOString() });

    const heats = groupByHeat(await squadHeatEntries(collegeId, squad.id)).filter((h) => DONE.includes(h.status));
    if (heats.length) {
      const all = await fetchAll<any>((from, to) => supabase.from('heat_athletes').select(RESULT_SELECT).in('heat_id', heats.map((h) => h.heatId)).order('id').range(from, to));
      for (const h of heats) {
        const marks = placeEntries(all.filter((r) => r.heat_id === h.heatId), h.category);
        for (const e of h.entries) {
          const m = marks.get(e.heatAthleteId);
          e.mark = m?.mark ?? null;
          e.place = m?.place ?? null;
          e.resultStatus = m?.status ?? null;
        }
      }
    }
    heats.reverse(); // latest first
    return res.json({ heats, serverTime: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ped/push-token  { token, platform }
 */
pedRouter.post('/push-token', async (req: AuthenticatedRequest, res: Response) => {
  const token = String(req.body?.token || '').trim();
  const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
  if (!/^Expo(nent)?PushToken\[[^\]]{10,}\]$/.test(token)) {
    return res.status(400).json({ error: 'Invalid push token.' });
  }
  const { error } = await supabase.from('device_push_tokens').upsert(
    {
      expo_push_token: token,
      app: 'athletes',
      profile_id: null,
      staff_id: null,
      college_id: req.user!.collegeId,
      platform,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'expo_push_token' }
  );
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

/**
 * DELETE /api/ped/push-token  { token }
 */
pedRouter.delete('/push-token', async (req: AuthenticatedRequest, res: Response) => {
  const token = String(req.body?.token || '').trim();
  if (token) {
    await supabase.from('device_push_tokens').delete().eq('expo_push_token', token).eq('college_id', req.user!.collegeId!);
  }
  return res.json({ success: true });
});
