import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { invalidateCache } from '../middleware/cache';
import { resolveAthlete } from '../utils/athlete-resolve';
import { assertEventScope, ProgressionError } from '../utils/progression';
import { signPhotoFieldsDeep, signPhotoUrl } from '../utils/photo-links';
import { sendPushToProfiles } from '../utils/push';
import { fetchAll } from '../utils/fetch-all';
import { istIso } from './officials.routes';
import { notifyPedsRollCallClosed } from '../utils/ped-alerts';
import { sendDbError } from '../utils/db-error';

/**
 * Event roll call (first round of an event, 25-11-2026):
 *   1. The call room opens the roll call: every eligible entrant of the event is on it.
 *   2. Athletes scan in (a relay team reports when any of its runners scans). A reserve of the same
 *      college can come in for an absent athlete.
 *   3. "Prepare heats" draws the heats from the athletes who reported only and sends them straight
 *      to the referee (their call room is closed). Everyone else is DNS.
 * Later rounds keep the per-heat call room (/api/callroom/heats/...).
 */
export const rollCallRouter = Router();
rollCallRouter.use(authenticate);
rollCallRouter.use(requireRole(['meet_admin', 'call_room_official']));

const STAGE_RANK: Record<string, number> = { QUALIFYING: 1, HEATS: 1, SEMI_FINAL: 2, FINAL: 3 };
const DEFAULT_CALL_ROOM_LEAD_MIN = 30;

function sendError(res: Response, err: any) {
  return res.status(err instanceof ProgressionError ? err.status : 500).json({ error: err.message });
}

function kindOf(category: string) {
  if (category === 'relay') return 'relay';
  if (category === 'field_vertical_jump') return 'vertical';
  if (category.startsWith('field')) return 'field';
  return 'track';
}

async function rollCallOf(eventId: string, stage: string) {
  const { data } = await supabase.from('roll_calls').select('id, event_id, stage, status, opened_at, drawn_at, num_heats').eq('event_id', eventId).eq('stage', stage).maybeSingle();
  return data;
}

/**
 * GET /api/callroom/rollcalls
 * The first round of every event (not combined events), with its time and roll call state:
 * NOT_OPEN, OPEN, DRAWN (heats prepared here) or UNDER_WAY (heats drawn by the meet office and started).
 */
rollCallRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [items, rollCalls, heats] = await Promise.all([
      fetchAll<any>((from, to) =>
        supabase
          .from('schedule_items')
          .select('id, event_id, stage, scheduled_time, call_room_time, schedule_sessions(session_date), events(id, name, code, gender, category)')
          .order('id')
          .range(from, to) as any
      ),
      fetchAll<any>((from, to) => supabase.from('roll_calls').select('id, event_id, stage, status, num_heats, roll_call_entries(status)').order('id').range(from, to) as any),
      fetchAll<any>((from, to) => supabase.from('heats').select('event_id, stage, status').order('id').range(from, to) as any),
    ]);
    const scope = req.user!.role === 'meet_admin' ? [] : req.user!.scopeEventIds || [];

    // First round of each event = the earliest stage on the schedule
    const first = new Map<string, any>();
    for (const i of items) {
      const ev = i.events;
      if (!ev || ev.category === 'combined' || !(i.stage in STAGE_RANK)) continue;
      if (scope.length && !scope.includes(i.event_id)) continue;
      const prev = first.get(i.event_id);
      if (!prev || STAGE_RANK[i.stage] < STAGE_RANK[prev.stage]) first.set(i.event_id, i);
    }

    const list = [...first.values()].map((i) => {
      const date = i.schedule_sessions?.session_date || null;
      const startAt = istIso(date, i.scheduled_time);
      let callRoomAt = istIso(date, i.call_room_time);
      if (!callRoomAt && startAt) callRoomAt = new Date(new Date(startAt).getTime() - DEFAULT_CALL_ROOM_LEAD_MIN * 60000).toISOString();
      const rc = rollCalls.find((r) => r.event_id === i.event_id && r.stage === i.stage);
      const started = heats.some((h) => h.event_id === i.event_id && h.stage === i.stage && h.status !== 'SCHEDULED');
      const entries: { status: string }[] = rc?.roll_call_entries || [];
      return {
        eventId: i.event_id,
        eventName: i.events.name,
        eventCode: i.events.code,
        gender: i.events.gender,
        category: i.events.category,
        kind: kindOf(i.events.category),
        stage: i.stage,
        startAt,
        callRoomAt,
        state: rc ? rc.status : started ? 'UNDER_WAY' : 'NOT_OPEN',
        entries: entries.length,
        reported: entries.filter((e) => e.status === 'REPORTED').length,
        numHeats: rc?.num_heats ?? null,
      };
    });
    list.sort((a, b) => (a.startAt && b.startAt ? a.startAt.localeCompare(b.startAt) : a.startAt ? -1 : b.startAt ? 1 : a.eventName.localeCompare(b.eventName)));
    return res.json({ generatedAt: new Date().toISOString(), rollCalls: list });
  } catch (err: any) {
    return sendError(res, err);
  }
});

/** POST /api/callroom/rollcalls/open  { eventId, stage } — opens (or refreshes) the roll call */
rollCallRouter.post('/open', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = String(req.body?.eventId || '');
    const stage = String(req.body?.stage || 'HEATS');
    if (!eventId) return res.status(400).json({ error: 'eventId is required.' });
    assertEventScope(req.user!, eventId);
    const { data, error } = await supabase.rpc('open_roll_call', { p_event_id: eventId, p_stage: stage, p_official_id: req.user!.entityId });
    if (error) return sendDbError(res, error);
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return sendError(res, err);
  }
});

const ENTRY_SELECT = `
  id, status, reported_at, notes, substituted_for,
  profiles!roll_call_entries_profile_id_fkey(id, sslc_name, bid_number, photo_url, squad_id, squads(colleges(name, code))),
  relay_teams(id, squads(colleges(name, code)), relay_members(id, leg_order, is_reserve, profiles(id, sslc_name, bid_number)))
`;

/**
 * GET /api/callroom/rollcalls/:eventId?stage=HEATS
 * The roll call with every entrant and their status; reserves who could come in for each absent athlete.
 */
rollCallRouter.get('/:eventId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    const stage = String(req.query.stage || 'HEATS');
    assertEventScope(req.user!, eventId);
    const { data: event } = await supabase.from('events').select('id, name, code, gender, category, max_lanes').eq('id', eventId).maybeSingle();
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    const rc = await rollCallOf(eventId, stage);
    if (!rc) return res.json({ event, stage, rollCall: null, entries: [], reserves: {} });

    const { data: entries, error } = await supabase.from('roll_call_entries').select(ENTRY_SELECT).eq('roll_call_id', rc.id);
    if (error) return sendDbError(res, error);
    const rows = (entries || []) as any[];
    rows.sort((a, b) => {
      const ca = a.profiles?.squads?.colleges?.code || a.relay_teams?.squads?.colleges?.code || '';
      const cb = b.profiles?.squads?.colleges?.code || b.relay_teams?.squads?.colleges?.code || '';
      return ca.localeCompare(cb) || (a.profiles?.bid_number ?? 0) - (b.profiles?.bid_number ?? 0);
    });

    // Reserves of the same squad registered for this event, not on the roll call yet
    const reserves: Record<string, { id: string; name: string; bib: number | null }[]> = {};
    if (rc.status === 'OPEN' && event.category !== 'relay') {
      const { data: regs } = await supabase
        .from('registrations')
        .select('profiles(id, sslc_name, bid_number, squad_id, accreditation_status, squads(payment_status))')
        .eq('event_id', eventId)
        .eq('kind', 'reserve');
      const onList = new Set(rows.map((r) => r.profiles?.id).filter(Boolean));
      const pool = ((regs || []) as any[])
        .map((r) => r.profiles)
        .filter((p) => p && p.accreditation_status === 'ACCREDITED' && p.squads?.payment_status === 'VERIFIED' && !onList.has(p.id));
      for (const r of rows) {
        if (!r.profiles || r.status === 'REPORTED') continue;
        const mine = pool.filter((p) => p.squad_id === r.profiles.squad_id);
        if (mine.length) reserves[r.id] = mine.map((p) => ({ id: p.id, name: p.sslc_name, bib: p.bid_number }));
      }
    }

    await signPhotoFieldsDeep(rows);
    return res.json({ event, stage, rollCall: rc, entries: rows, reserves });
  } catch (err: any) {
    return sendError(res, err);
  }
});

/**
 * POST /api/callroom/rollcalls/scan  { eventId, stage, qrToken | bib | athleteId, actedAt }
 * Marks the athlete (or their relay team) REPORTED. Safe to repeat.
 */
rollCallRouter.post('/scan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = String(req.body?.eventId || '');
    const stage = String(req.body?.stage || 'HEATS');
    if (!eventId) return res.status(400).json({ error: 'eventId is required.' });
    assertEventScope(req.user!, eventId);
    const rc = await rollCallOf(eventId, stage);
    if (!rc) return res.status(409).json({ error: 'Open the roll call first.' });
    if (rc.status !== 'OPEN') return res.status(409).json({ error: 'The heats are already prepared. Athletes who did not report are DNS.' });

    const who = await resolveAthlete(req.body);
    if (!who.ok) return res.status(who.status).json({ error: who.error });

    const { data: prof } = await supabase.from('profiles').select('sslc_name, bid_number, photo_url, squads(colleges(code))').eq('id', who.athleteId).maybeSingle();
    const athlete = {
      id: who.athleteId,
      name: prof?.sslc_name || 'Athlete',
      bib: prof?.bid_number ?? null,
      college: (prof as any)?.squads?.colleges?.code || null,
      photoUrl: await signPhotoUrl(prof?.photo_url),
    };

    let { data: entry } = await supabase.from('roll_call_entries').select('id, status').eq('roll_call_id', rc.id).eq('profile_id', who.athleteId).maybeSingle();
    let relayRole: string | null = null;
    if (!entry) {
      const { data: member } = await supabase
        .from('relay_members')
        .select('leg_order, is_reserve, relay_team_id, relay_teams!inner(event_id)')
        .eq('profile_id', who.athleteId)
        .eq('relay_teams.event_id', eventId)
        .maybeSingle();
      if (member) {
        relayRole = member.is_reserve ? 'Reserve' : `Leg ${member.leg_order}`;
        ({ data: entry } = await supabase.from('roll_call_entries').select('id, status').eq('roll_call_id', rc.id).eq('relay_team_id', member.relay_team_id).maybeSingle());
      }
    }
    if (!entry) {
      const { data: reserve } = await supabase.from('registrations').select('id').eq('profile_id', who.athleteId).eq('event_id', eventId).eq('kind', 'reserve').maybeSingle();
      const hint = reserve ? ' They are a reserve for this event: tap the absent athlete of their college and choose "Use reserve".' : '';
      return res.status(404).json({ error: `Not entered in this event.${hint}`, athlete });
    }
    if (entry.status === 'SCRATCH') {
      return res.status(409).json({ error: 'Marked scratched earlier. Change it in the list if this is wrong.', athlete });
    }
    const already = entry.status === 'REPORTED';
    if (!already) {
      const { error } = await supabase
        .from('roll_call_entries')
        .update({ status: 'REPORTED', reported_at: new Date().toISOString(), marked_by: req.user!.entityId, notes: relayRole ? `Checked in by ${relayRole} runner scan` : '' })
        .eq('id', entry.id);
      if (error) return sendDbError(res, error);
    }
    return res.json({ success: true, alreadyReported: already, entryId: entry.id, relayRole, athlete });
  } catch (err: any) {
    return sendError(res, err);
  }
});

/** POST /api/callroom/rollcalls/mark  { entryId, status: REPORTED | PENDING | SCRATCH } */
rollCallRouter.post('/mark', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entryId = String(req.body?.entryId || '');
    const status = String(req.body?.status || '');
    if (!entryId || !['REPORTED', 'PENDING', 'SCRATCH'].includes(status)) return res.status(400).json({ error: 'entryId and a valid status are required.' });
    const { data: entry } = await supabase.from('roll_call_entries').select('id, roll_calls(event_id, status)').eq('id', entryId).maybeSingle();
    const rc: any = (entry as any)?.roll_calls;
    if (!entry || !rc) return res.status(404).json({ error: 'Entry not found on any roll call.' });
    assertEventScope(req.user!, rc.event_id);
    if (rc.status !== 'OPEN') return res.status(409).json({ error: 'The heats are already prepared. Ask the meet office to change an entry now.' });
    const { error } = await supabase
      .from('roll_call_entries')
      .update({ status, reported_at: status === 'REPORTED' ? new Date().toISOString() : null, marked_by: req.user!.entityId })
      .eq('id', entryId);
    if (error) return sendDbError(res, error);
    return res.json({ success: true });
  } catch (err: any) {
    return sendError(res, err);
  }
});

/** POST /api/callroom/rollcalls/reserve-swap  { entryId, reserveProfileId } */
rollCallRouter.post('/reserve-swap', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entryId, reserveProfileId } = req.body || {};
    if (!entryId || !reserveProfileId) return res.status(400).json({ error: 'entryId and reserveProfileId are required.' });
    const { data: entry } = await supabase.from('roll_call_entries').select('roll_calls(event_id)').eq('id', entryId).maybeSingle();
    const eventId = (entry as any)?.roll_calls?.event_id;
    if (!eventId) return res.status(404).json({ error: 'Entry not found on any roll call.' });
    assertEventScope(req.user!, eventId);
    const { data, error } = await supabase.rpc('roll_call_reserve_swap', { p_entry_id: entryId, p_reserve_profile_id: reserveProfileId, p_official_id: req.user!.entityId });
    if (error) return sendDbError(res, error);
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return sendError(res, err);
  }
});

/**
 * POST /api/callroom/rollcalls/prepare  { eventId, stage }
 * Draws the heats from the athletes who reported and sends them to the referee. Each athlete gets
 * a push with their heat and lane.
 */
rollCallRouter.post('/prepare', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = String(req.body?.eventId || '');
    const stage = String(req.body?.stage || 'HEATS');
    if (!eventId) return res.status(400).json({ error: 'eventId is required.' });
    assertEventScope(req.user!, eventId);
    const { data: event } = await supabase.from('events').select('name, category, max_lanes').eq('id', eventId).maybeSingle();
    if (!event) return res.status(404).json({ error: 'Event not found.' });

    const { data, error } = await supabase.rpc('prepare_heats_from_roll_call', {
      p_event_id: eventId,
      p_stage: stage,
      p_num_lanes: event.max_lanes || 8,
      p_official_id: req.user!.entityId,
    });
    if (error) return sendDbError(res, error);

    invalidateCache('live');
    invalidateCache('schedule');
    // College PEDs: who did not report and is now DNS
    notifyPedsRollCallClosed(eventId, stage);

    // Tell each athlete their heat and lane (best effort)
    const heatIds: string[] = (data as any)?.heats_created || [];
    const field = event.category.startsWith('field');
    supabase
      .from('heat_athletes')
      .select('lane_number, profile_id, heats(heat_number), relay_teams(relay_members(profile_id))')
      .in('heat_id', heatIds)
      .then(({ data: rows }) => {
        for (const r of (rows || []) as any[]) {
          const ids = r.profile_id ? [r.profile_id] : (r.relay_teams?.relay_members || []).map((m: any) => m.profile_id);
          const heatNo = (Array.isArray(r.heats) ? r.heats[0] : r.heats)?.heat_number;
          const where = field ? `order ${r.lane_number}` : heatIds.length > 1 ? `heat ${heatNo}, lane ${r.lane_number}` : `lane ${r.lane_number}`;
          sendPushToProfiles(ids, {
            title: `📋 ${event.name}: ${where}`,
            body: 'The heats are drawn. Stay with the call room official — you go to the start from here.',
            data: { kind: 'heat_drawn', eventId },
          }).catch(() => {});
        }
      });

    return res.json({ success: true, result: data });
  } catch (err: any) {
    return sendError(res, err);
  }
});
