import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { assertCanWriteEntry, finalizeHeat, ProgressionError } from '../utils/progression';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { sendDbError } from '../utils/db-error';

export const trackRouter = Router();

trackRouter.use(authenticate);
trackRouter.use(requireRole(['meet_admin', 'referee']));

/**
 * GET /api/track/heats/:heatId
 * Fetches track heat athletes with recorded times and results
 */
trackRouter.get('/heats/:heatId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { heatId } = req.params;

    const { data: heat, error: heatErr } = await supabase
      .from('heats')
      .select('id, heat_number, stage, status, wind_reading, events(id, name, code, gender, category, start_type)')
      .eq('id', heatId)
      .single();

    if (heatErr) return sendDbError(res, heatErr);

    const { data: athletes, error: athErr } = await supabase
      .from('heat_athletes')
      .select(`
        id,
        lane_number,
        call_room_reported,
        call_room_reported_at,
        profiles(id, sslc_name, usn, bid_number, squads(colleges(name, code))),
        relay_teams(id, squads(colleges(name, code))),
        call_room_inspections(reported_status),
        track_results(
          id,
          time_seconds,
          reaction_time_ms,
          wind_reading,
          status,
          dq_rule,
          photo_finish_url
        )
      `)
      .eq('heat_id', heatId)
      .order('lane_number', { ascending: true });

    if (athErr) return sendDbError(res, athErr);

    return res.json({
      heat,
      athletes: athletes || [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/track/result
 * Submit electronic finish time (down to 1/1000s) and reaction time
 */
trackRouter.post('/result', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      heatAthleteId,
      timeSeconds,
      reactionTimeMs,
      windReading,
      status = 'FINISHED',
      dqRule = '',
    } = req.body;
    if (heatAthleteId) {
      try {
        await assertCanWriteEntry(req.user!, String(heatAthleteId));
      } catch (e: any) {
        return res.status(e instanceof ProgressionError ? e.status : 500).json({ error: e.message });
      }
    }

    if (!heatAthleteId) {
      return res.status(400).json({ error: 'heatAthleteId is required.' });
    }

    const { data, error } = await supabase.rpc('submit_track_result', {
      p_heat_athlete_id: heatAthleteId,
      p_time_seconds: timeSeconds ? parseFloat(timeSeconds) : null,
      p_reaction_ms: reactionTimeMs ? parseInt(reactionTimeMs, 10) : null,
      p_wind: windReading ? parseFloat(windReading) : null,
      p_status: status,
      p_dq_rule: dqRule,
      p_official_id: req.user!.entityId,
    });

    if (error) return sendDbError(res, error);
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/track/qualify
 * Run automatic round progression ('Q' top per heat + 'q' fastest times overall)
 */
trackRouter.post('/qualify', requireRole(['meet_admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      eventId,
      currentStage = 'HEATS',
      nextStage = 'FINAL',
      autoQPerHeat = 2, // VTU rule: top 2 of each heat
      timeQTotal = 0, // no fastest-time qualifiers
    } = req.body;

    if (!eventId) {
      return res.status(400).json({ error: 'eventId is required.' });
    }

    // Photo finish MANUAL mode: the vendor makes every round, the app must not build one
    const { data: modeRow } = await supabase.from('meet_settings').select('photo_finish_mode').limit(1).maybeSingle();
    if (modeRow?.photo_finish_mode === 'MANUAL') {
      return res.status(409).json({ error: 'Photo finish MANUAL mode is on: enter the next round (lane and bib) in Admin > Photo Finish.' });
    }

    const { data, error } = await supabase.rpc('qualify_next_round', {
      p_event_id: eventId,
      p_current_stage: currentStage,
      p_next_stage: nextStage,
      p_auto_q_per_heat: parseInt(autoQPerHeat, 10),
      p_time_q_total: parseInt(timeQTotal, 10),
    });

    if (error) return sendDbError(res, error);
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/track/finalize
 * Finalize heat, mark status COMPLETED, and award championship points if Final stage
 */
trackRouter.post('/finalize', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const heatId = String(req.body?.heatId || '');
    if (!heatId) return res.status(400).json({ error: 'heatId is required.' });
    // Event and stage come from the database; a different one in the request is refused (audit #6)
    return res.json(await finalizeHeat(heatId, req.user!, { eventId: req.body?.eventId, stage: req.body?.stage }));
  } catch (err: any) {
    return res.status(err instanceof ProgressionError ? err.status : 500).json({ error: err.message });
  }
});
