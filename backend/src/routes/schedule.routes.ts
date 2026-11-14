import { Router, Response } from 'express';
import { notifyHeatStatusChange } from '../utils/push';
import { supabase } from '../config/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { cacheResponse, invalidateCache } from '../middleware/cache';

export const scheduleRouter = Router();

/**
 * GET /api/schedule/sessions
 * Public / Authenticated: Returns full schedule with sessions and events
 */
scheduleRouter.get('/sessions', cacheResponse(15), async (_req, res: Response) => {
  try {
    const { data: sessions, error } = await supabase
      .from('schedule_sessions')
      .select(`
        id,
        session_name,
        session_date,
        start_time,
        end_time,
        schedule_items(
          id,
          stage,
          scheduled_time,
          estimated_duration_min,
          call_room_time,
          status,
          events(id, name, code, gender, category, start_type)
        )
      `)
      .order('session_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ sessions: sessions || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/schedule/heats/:eventId
 * Public / Authenticated: Get all heats and lane assignments for a specific event
 */
scheduleRouter.get('/heats/:eventId', cacheResponse(10), async (req, res: Response) => {
  try {
    const { eventId } = req.params;
    const stage = (req.query.stage as string) || 'HEATS';

    const { data: heats, error } = await supabase
      .from('heats')
      .select(`
        id,
        stage,
        heat_number,
        wind_reading,
        status,
        heat_athletes(
          id,
          lane_number,
          call_room_reported,
          call_room_reported_at,
          seed_mark,
          profiles(
            id,
            sslc_name,
            usn,
            bid_number,
            squads(gender, colleges(name, code))
          ),
          relay_teams(
            id,
            squads(colleges(name, code))
          )
        )
      `)
      .eq('event_id', eventId)
      .eq('stage', stage)
      .order('heat_number', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ heats: heats || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Admin / Call Room Official Operations below
 */
scheduleRouter.use(authenticate);

/**
 * POST /api/schedule/draw
 * Meet Admin: Trigger automated heat draw & lane seeding (Serpentine + World Athletics Rule 166.4)
 */
scheduleRouter.post('/draw', requireRole(['meet_admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId, stage = 'HEATS', numLanes = 8 } = req.body;

    if (!eventId) {
      return res.status(400).json({ error: 'eventId is required.' });
    }

    const { data, error } = await supabase.rpc('generate_heat_draw', {
      p_event_id: eventId,
      p_stage: stage,
      p_num_lanes: parseInt(numLanes, 10) || 8,
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true, draw: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/schedule/heats/:heatId/status
 * Update heat operational status (e.g. CALL_ROOM, ON_TRACK, IN_PROGRESS, OFFICIAL)
 */
scheduleRouter.patch('/heats/:heatId/status', requireRole(['meet_admin', 'call_room_official', 'referee']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { heatId } = req.params;
    const { status, windReading } = req.body;
    const role = req.user!.role;

    // Strict call room: officials can't move a heat through its steps by hand.
    //  - Referees never set a status here (results go through /finalize).
    //  - The call room can only OPEN a heat that has not started; closing is /callroom/advance.
    //  - The meet admin can set anything.
    if (role !== 'meet_admin') {
      if (role !== 'call_room_official' || status !== 'CALL_ROOM') {
        return res.status(403).json({ error: 'Only the call room can open a heat here; it closes with "Close & send to track".' });
      }
      const { data: cur } = await supabase.from('heats').select('status').eq('id', heatId).maybeSingle();
      if (!cur) return res.status(404).json({ error: 'Heat not found.' });
      if (cur.status === 'CALL_ROOM') return res.json({ success: true, heat: cur });
      if (!['SCHEDULED', 'DELAYED'].includes(cur.status)) {
        return res.status(409).json({ error: 'The call room for this heat has already been closed.' });
      }
    }

    const updates: any = {};
    if (status) updates.status = status;
    if (status === 'CALL_ROOM') updates.call_room_opened_at = new Date().toISOString();
    if (windReading !== undefined && role === 'meet_admin') updates.wind_reading = windReading;

    const { data, error } = await supabase
      .from('heats')
      .update(updates)
      .eq('id', heatId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    // AURA Athletes: push "call room open" to everyone in the heat (best effort, non-blocking)
    if (status) notifyHeatStatusChange(heatId, status);
    return res.json({ success: true, heat: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/schedule/call-room/:heatAthleteId
 * Call Room Official: Mark athlete attendance / reported to call room
 */
scheduleRouter.patch('/call-room/:heatAthleteId', requireRole(['meet_admin', 'call_room_official']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { heatAthleteId } = req.params;
    const { reported } = req.body;

    const { data, error } = await supabase
      .from('heat_athletes')
      .update({
        call_room_reported: reported !== undefined ? reported : true,
        call_room_reported_at: reported ? new Date().toISOString() : null,
      })
      .eq('id', heatAthleteId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true, athlete: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
