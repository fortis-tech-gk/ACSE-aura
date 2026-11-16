import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { signPhotoFieldsDeep, signPhotoUrl } from '../utils/photo-links';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { resolveAthlete } from '../utils/athlete-resolve';
import { assertEventScope, ProgressionError } from '../utils/progression';
import { isLoginThrottled, recordLoginFailure, clearLoginFailures, THROTTLE_MESSAGE } from '../utils/login-throttle';
import { verifyPassword } from '../utils/passphrase';
import { invalidateCache } from '../middleware/cache';

export const callRoomRouter = Router();

/**
 * Strict call room (athletics is discipline):
 *   SCHEDULED      → nothing can be scanned until the call room is opened
 *   CALL_ROOM      → open: scans and status changes
 *   ON_TRACK / IN_PROGRESS → closed: no more scans (except a scan made BEFORE the close and sent
 *                    late by an offline tablet); the call room official can still correct a status
 *   COMPLETED / OFFICIAL   → results are done: only the meet admin can change anything
 */
const NOT_OPEN = ['SCHEDULED', 'DELAYED'];
const CLOSED = ['ON_TRACK', 'IN_PROGRESS'];
const FINISHED = ['COMPLETED', 'OFFICIAL'];

type HeatState = { id: string; event_id: string; status: string; call_room_closed_at: string | null };

async function heatState(heatId: string): Promise<HeatState | null> {
  const { data } = await supabase.from('heats').select('id, event_id, status, call_room_closed_at').eq('id', heatId).maybeSingle();
  return (data as HeatState) || null;
}

async function heatStateOfEntry(heatAthleteId: string): Promise<HeatState | null> {
  const { data } = await supabase
    .from('heat_athletes')
    .select('heats(id, event_id, status, call_room_closed_at)')
    .eq('id', heatAthleteId)
    .maybeSingle();
  const h: any = (data as any)?.heats;
  return (Array.isArray(h) ? h[0] : h) || null;
}

/** The time the official acted on the device (sent with every scan / correction); null if missing */
function actedAt(body: any): number | null {
  const t = Date.parse(String(body?.actedAt || ''));
  return Number.isFinite(t) && t <= Date.now() + 2 * 60_000 ? t : null;
}

callRoomRouter.use(authenticate);

/**
 * POST /api/callroom/override-close  (referee, or meet admin)
 * Body: { heatId, pin }
 * The call room tablet is offline, so its "Close" never reached the server and the referee is
 * blocked. With the CALL ROOM official's PIN typed on the referee tablet (two people agree), the
 * call room is closed from here: unreported entries become DNS. Scans the offline tablet made
 * before this moment are still accepted when it comes back online.
 */
callRoomRouter.post('/override-close', requireRole(['meet_admin', 'referee']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const heatId = String(req.body?.heatId || '');
    const pin = String(req.body?.pin || '').trim();
    if (!heatId) return res.status(400).json({ error: 'heatId is required.' });
    if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: "Enter the call room official's PIN." });

    const heat = await heatState(heatId);
    if (!heat) return res.status(404).json({ error: 'Heat not found.' });
    assertEventScope(req.user!, heat.event_id);
    if (!NOT_OPEN.includes(heat.status) && heat.status !== 'CALL_ROOM') {
      return res.status(409).json({ error: 'The call room for this heat is already closed.' });
    }

    const ip = req.ip || 'unknown';
    const key = `override|${req.user!.entityId}|${ip}`;
    if (await isLoginThrottled('pin', key, ip, 10, 30)) return res.status(429).json({ error: THROTTLE_MESSAGE });

    const { data: candidates } = await supabase
      .from('staff')
      .select('id, display_name, pin_hash')
      .eq('is_active', true)
      .eq('role', 'call_room_official')
      .not('pin_hash', 'is', null);
    let official: { id: string; display_name: string } | null = null;
    for (const c of candidates || []) {
      if (c.pin_hash && (await verifyPassword(pin, c.pin_hash))) {
        official = c;
        break;
      }
    }
    if (!official) {
      await recordLoginFailure('pin', key, ip);
      return res.status(401).json({ error: 'That is not a call room PIN. Ask the call room official to type their own PIN.' });
    }
    await clearLoginFailures('pin', key);

    const { data, error } = await supabase.rpc('advance_heat_to_track', { p_heat_id: heatId, p_official_id: official.id });
    if (error) return res.status(400).json({ error: error.message });
    await supabase
      .from('heats')
      .update({
        call_room_close_note: `Closed from the referee tablet by ${req.user!.displayName || 'the referee'} with the PIN of ${official.display_name} (call room tablet offline).`,
      })
      .eq('id', heatId);
    invalidateCache('live');
    invalidateCache('schedule');
    return res.json({ success: true, result: data, closedBy: official.display_name });
  } catch (err: any) {
    return res.status(err instanceof ProgressionError ? err.status : 500).json({ error: err.message });
  }
});

callRoomRouter.use(requireRole(['meet_admin', 'call_room_official']));

const HEAT_ATHLETE_SELECT = `
  id,
  lane_number,
  call_room_reported,
  call_room_reported_at,
  profiles(id, sslc_name, usn, bid_number, photo_url, squads(gender, colleges(name, code))),
  relay_teams(
    id,
    squads(gender, colleges(name, code)),
    relay_members(id, leg_order, is_reserve, profiles(id, sslc_name, bid_number, photo_url, accreditation_status, squads(gender)))
  ),
  call_room_inspections(id, reported_status, bib_affixed, spike_length_mm, uniform_approved, notes, inspected_at)
`;

/**
 * GET /api/callroom/heats/:heatId
 * Everyone in the heat (lane / order), their call room status and, for relays, the team lineup.
 */
callRoomRouter.get('/heats/:heatId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { heatId } = req.params;

    const { data: heat, error: heatErr } = await supabase
      .from('heats')
      .select('id, heat_number, stage, status, events(id, name, code, gender, category)')
      .eq('id', heatId)
      .single();

    if (heatErr) return res.status(400).json({ error: heatErr.message });

    const { data: athletes, error: athErr } = await supabase
      .from('heat_athletes')
      .select(HEAT_ATHLETE_SELECT)
      .eq('heat_id', heatId)
      .order('lane_number', { ascending: true });

    if (athErr) return res.status(400).json({ error: athErr.message });

    // Reserves who could come in for an athlete who has not reported (individual events only)
    const reserves: Record<string, { id: string; name: string; bib: number | null }[]> = {};
    if ((heat as any)?.events?.category !== 'relay' && ['SCHEDULED', 'DELAYED', 'CALL_ROOM'].includes((heat as any)?.status)) {
      await Promise.all(
        (athletes || [])
          .filter((a: any) => a.profiles && !a.call_room_reported)
          .map(async (a: any) => {
            const { data: list } = await supabase.rpc('eligible_reserves_for_entry', { p_heat_athlete_id: a.id });
            if (list?.length) reserves[a.id] = list.map((r: any) => ({ id: r.profile_id, name: r.sslc_name, bib: r.bid_number }));
          })
      );
    }

    await signPhotoFieldsDeep(athletes);
    return res.json({ heat, athletes: athletes || [], reserves });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/callroom/scan
 * Body: { heatId, qrToken | bib | athleteId }
 * Scan an athlete's ID card at the call room: finds their lane in this heat (or their relay
 * team) and marks them REPORTED. Safe to repeat.
 */
callRoomRouter.post('/scan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const heatId = String(req.body?.heatId || '');
    if (!heatId) return res.status(400).json({ error: 'heatId is required.' });

    const heat = await heatState(heatId);
    if (!heat) return res.status(404).json({ error: 'Heat not found.' });
    const admin = req.user!.role === 'meet_admin';
    // A scan from an offline tablet that arrives after the close counts only if it was made before it
    let lateSync = false;
    if (!admin) {
      if (NOT_OPEN.includes(heat.status)) {
        return res.status(409).json({ error: 'Open the call room first. Scanning starts when the call room is open.' });
      }
      if (FINISHED.includes(heat.status)) {
        return res.status(409).json({ error: 'Results for this heat are already done.' });
      }
      if (CLOSED.includes(heat.status)) {
        const at = actedAt(req.body);
        const closedAt = heat.call_room_closed_at ? Date.parse(heat.call_room_closed_at) : null;
        if (!(at && closedAt && at <= closedAt)) {
          return res.status(409).json({ error: 'The call room for this heat is closed. Athletes who did not report are DNS.' });
        }
        lateSync = true;
      }
    }

    const who = await resolveAthlete(req.body);
    if (!who.ok) return res.status(who.status).json({ error: who.error });

    const { data: entries, error } = await supabase
      .from('heat_athletes')
      .select('id, lane_number, profile_id, relay_team_id, call_room_reported, call_room_inspections(reported_status), relay_teams(relay_members(profile_id, leg_order, is_reserve))')
      .eq('heat_id', heatId);
    if (error) return res.status(400).json({ error: error.message });

    let entry: any = (entries || []).find((e: any) => e.profile_id === who.athleteId);
    let relayRole: string | null = null;
    if (!entry) {
      entry = (entries || []).find((e: any) => (e.relay_teams?.relay_members || []).some((m: any) => m.profile_id === who.athleteId));
      const m = entry?.relay_teams?.relay_members?.find((x: any) => x.profile_id === who.athleteId);
      if (m) relayRole = m.is_reserve ? 'Reserve' : `Leg ${m.leg_order}`;
    }

    const { data: prof } = await supabase
      .from('profiles')
      .select('sslc_name, bid_number, photo_url, squads(colleges(code))')
      .eq('id', who.athleteId)
      .maybeSingle();
    const athlete = {
      id: who.athleteId,
      name: prof?.sslc_name || 'Athlete',
      bib: prof?.bid_number ?? null,
      college: (prof as any)?.squads?.colleges?.code || null,
      photoUrl: await signPhotoUrl(prof?.photo_url),
    };

    if (!entry) {
      // Help the official send the athlete to the right place
      const { data: elsewhere } = await supabase
        .from('heat_athletes')
        .select('lane_number, heats(heat_number, stage, status, events(name))')
        .eq('profile_id', who.athleteId)
        .neq('heat_id', heatId);
      const open = (elsewhere || []).find((h: any) => !['COMPLETED', 'OFFICIAL'].includes(h.heats?.status));
      let hint = open ? ` They are in ${(open as any).heats?.events?.name}, heat ${(open as any).heats?.heat_number}.` : '';
      if (!hint) {
        const { data: res } = await supabase
          .from('registrations')
          .select('id')
          .eq('profile_id', who.athleteId)
          .eq('event_id', heat.event_id)
          .eq('kind', 'reserve')
          .maybeSingle();
        if (res) hint = ' They are a reserve for this event: tap the absent athlete of their college and choose "Use reserve".';
      }
      return res.status(404).json({ error: `Not in this heat.${hint}`, athlete });
    }

    const prior = entry.call_room_inspections?.[0]?.reported_status || (Array.isArray(entry.call_room_inspections) ? null : entry.call_room_inspections?.reported_status) || null;
    if (prior === 'SCRATCH' || prior === 'DISQUALIFIED' || (lateSync && prior && prior !== 'DNS' && prior !== 'REPORTED')) {
      return res.status(409).json({ error: `Marked ${prior === 'SCRATCH' ? 'scratched' : 'disqualified'} earlier. Change it in the list if this is wrong.`, athlete, lane: entry.lane_number });
    }
    const already = !!entry.call_room_reported;

    if (!already) {
      const { error: rpcErr } = await supabase.rpc('record_call_room_inspection', {
        p_heat_athlete_id: entry.id,
        p_official_id: req.user!.entityId,
        p_reported_status: 'REPORTED',
        p_bib_affixed: true,
        p_spike_length_mm: 9.0,
        p_uniform_approved: true,
        p_notes: [relayRole ? `Checked in by ${relayRole} runner scan` : '', lateSync ? 'Scanned before the call room closed; sent later by an offline tablet.' : '']
          .filter(Boolean)
          .join(' '),
      });
      if (rpcErr) return res.status(400).json({ error: rpcErr.message });
    }

    return res.json({ success: true, alreadyReported: already, heatAthleteId: entry.id, lane: entry.lane_number, relayRole, athlete });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/callroom/inspect
 * Set an entry's call room status by hand (REPORTED / SCRATCH / DNS / DISQUALIFIED), with kit checks.
 */
callRoomRouter.post('/inspect', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      heatAthleteId,
      reportedStatus = 'REPORTED',
      bibAffixed = true,
      spikeLengthMm = 9.0,
      uniformApproved = true,
      notes = '',
    } = req.body;

    if (!heatAthleteId) {
      return res.status(400).json({ error: 'heatAthleteId is required.' });
    }
    if (!['REPORTED', 'SCRATCH', 'DNS', 'DISQUALIFIED', 'NOT_REPORTED'].includes(reportedStatus)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const heat = await heatStateOfEntry(String(heatAthleteId));
    if (!heat) return res.status(404).json({ error: 'Entry not found in any heat.' });
    const admin = req.user!.role === 'meet_admin';
    if (!admin && NOT_OPEN.includes(heat.status)) {
      return res.status(409).json({ error: 'Open the call room first.' });
    }
    if (!admin && FINISHED.includes(heat.status)) {
      return res.status(409).json({ error: 'Results for this heat are already done. Ask the meet office to change it.' });
    }
    // After the close only the call room's own corrections are allowed (logged), never "not yet"
    const correction = CLOSED.includes(heat.status);
    if (correction && reportedStatus === 'NOT_REPORTED') {
      return res.status(409).json({ error: 'The call room is closed: an athlete who did not report is DNS.' });
    }

    // Undo a check-in made by mistake
    if (reportedStatus === 'NOT_REPORTED') {
      await supabase.from('call_room_inspections').delete().eq('heat_athlete_id', heatAthleteId);
      const { error } = await supabase
        .from('heat_athletes')
        .update({ call_room_reported: false, call_room_reported_at: null })
        .eq('id', heatAthleteId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ success: true, result: { heat_athlete_id: heatAthleteId, reported_status: null } });
    }

    const { data, error } = await supabase.rpc('record_call_room_inspection', {
      p_heat_athlete_id: heatAthleteId,
      p_official_id: req.user!.entityId,
      p_reported_status: reportedStatus,
      p_bib_affixed: bibAffixed,
      p_spike_length_mm: parseFloat(spikeLengthMm) || 9.0,
      p_uniform_approved: uniformApproved,
      p_notes: correction
        ? [notes, `Corrected after the call room closed by ${req.user!.displayName || 'the call room official'}.`].filter(Boolean).join(' ')
        : notes,
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/callroom/reserve-swap
 * Body: { heatAthleteId, reserveProfileId } — an accredited reserve of the same college takes the
 * lane of an athlete who has not reported (plan §7.3). First round only, before the call room closes.
 */
callRoomRouter.post('/reserve-swap', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { heatAthleteId, reserveProfileId } = req.body || {};
    if (!heatAthleteId || !reserveProfileId) {
      return res.status(400).json({ error: 'heatAthleteId and reserveProfileId are required.' });
    }
    const heat = await heatStateOfEntry(String(heatAthleteId));
    if (!heat) return res.status(404).json({ error: 'Entry not found in any heat.' });
    try {
      assertEventScope(req.user!, heat.event_id);
    } catch (e: any) {
      return res.status(e instanceof ProgressionError ? e.status : 403).json({ error: e.message });
    }
    const { data, error } = await supabase.rpc('substitute_reserve_in_heat', {
      p_heat_athlete_id: heatAthleteId,
      p_reserve_profile_id: reserveProfileId,
      p_official_id: req.user!.entityId,
    });
    if (error) return res.status(400).json({ error: error.message });
    invalidateCache('live');
    invalidateCache('schedule');
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/callroom/relay-swap
 * Body: { relayTeamId, legOrder, reserveProfileId } — a registered reserve replaces the runner on that leg.
 */
callRoomRouter.post('/relay-swap', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { relayTeamId, legOrder, reserveProfileId } = req.body || {};
    if (!relayTeamId || !legOrder || !reserveProfileId) {
      return res.status(400).json({ error: 'relayTeamId, legOrder and reserveProfileId are required.' });
    }
    const { data, error } = await supabase.rpc('swap_relay_runner', {
      p_relay_team_id: relayTeamId,
      p_leg_order: parseInt(legOrder, 10),
      p_reserve_profile_id: reserveProfileId,
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/callroom/advance/:heatId
 * Closes call room and marshals heat to track (unreported athletes marked DNS)
 */
callRoomRouter.post('/advance/:heatId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { heatId } = req.params;
    const heat = await heatState(heatId);
    if (!heat) return res.status(404).json({ error: 'Heat not found.' });
    if (req.user!.role !== 'meet_admin' && heat.status !== 'CALL_ROOM') {
      return res.status(409).json({
        error: NOT_OPEN.includes(heat.status) ? 'Open the call room first.' : 'The call room for this heat is already closed.',
      });
    }

    const { data, error } = await supabase.rpc('advance_heat_to_track', {
      p_heat_id: heatId,
      p_official_id: req.user!.entityId,
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
