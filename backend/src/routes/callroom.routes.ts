import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { resolveAthlete } from '../utils/athlete-resolve';

export const callRoomRouter = Router();

callRoomRouter.use(authenticate);
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

    return res.json({ heat, athletes: athletes || [] });
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
      photoUrl: prof?.photo_url || null,
    };

    if (!entry) {
      // Help the official send the athlete to the right place
      const { data: elsewhere } = await supabase
        .from('heat_athletes')
        .select('lane_number, heats(heat_number, stage, status, events(name))')
        .eq('profile_id', who.athleteId)
        .neq('heat_id', heatId);
      const open = (elsewhere || []).find((h: any) => !['COMPLETED', 'OFFICIAL'].includes(h.heats?.status));
      const hint = open ? ` They are in ${(open as any).heats?.events?.name}, heat ${(open as any).heats?.heat_number}.` : '';
      return res.status(404).json({ error: `Not in this heat.${hint}`, athlete });
    }

    const prior = entry.call_room_inspections?.[0]?.reported_status || (Array.isArray(entry.call_room_inspections) ? null : entry.call_room_inspections?.reported_status) || null;
    if (prior === 'SCRATCH' || prior === 'DISQUALIFIED') {
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
        p_notes: relayRole ? `Checked in by ${relayRole} runner scan` : '',
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
      p_notes: notes,
    });

    if (error) return res.status(400).json({ error: error.message });
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
