import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getChampionshipStandings } from '../utils/standings-cache';
import { cacheResponse } from '../middleware/cache';
import { sendDbError } from '../utils/db-error';

export const publicRouter = Router();

/**
 * GET /api/events
 */
publicRouter.get('/events', cacheResponse(30), async (_req: Request, res: Response) => {
  try {
    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .order('name', { ascending: true });

    if (error) return sendDbError(res, error);
    return res.json({ events: events || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/live/heats
 * Public: Returns live heats with athletes, lane numbers, and recorded results
 */
publicRouter.get('/live/heats', cacheResponse(5), async (_req: Request, res: Response) => {
  try {
    const { data: heats, error } = await supabase
      .from('heats')
      .select(`
        id,
        heat_number,
        stage,
        status,
        wind_reading,
        events(id, name, code, gender, category),
        heat_athletes(
          id,
          lane_number,
          profiles(
            id,
            sslc_name,
            usn,
            bid_number,
            squads(colleges(name, code))
          ),
          relay_teams(
            id,
            squads(colleges(name, code))
          ),
          track_results(time_seconds, reaction_time_ms, status, dq_rule),
          field_attempts(round_number, attempt_type, mark_meters),
          combined_results(discipline, mark, status, points)
        )
      `)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return sendDbError(res, error);
    return res.json({ heats: heats || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/live/results
 * Public: Returns finalized event results and standings
 */
publicRouter.get('/live/results', cacheResponse(5), async (_req: Request, res: Response) => {
  try {
    const { data: recentCompleted, error } = await supabase
      .from('heats')
      .select(`
        id,
        heat_number,
        stage,
        status,
        wind_reading,
        events (id, name, code, gender, category),
        heat_athletes (
          id,
          lane_number,
          profiles (id, sslc_name, usn, bid_number, squads(colleges(name, code))),
          relay_teams (id, squads(colleges(name, code))),
          track_results (time_seconds, reaction_time_ms, status, dq_rule),
          field_attempts (round_number, attempt_type, mark_meters),
          combined_results (discipline, mark, status, points)
        )
      `)
      .in('status', ['COMPLETED', 'OFFICIAL'])
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return sendDbError(res, error);

    return res.json({
      status: 'ACTIVE_MEET',
      count: recentCompleted?.length || 0,
      results: recentCompleted || [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/live/leaderboard
 * Public: Real-time live team points and standings
 */
publicRouter.get('/live/leaderboard', cacheResponse(10), async (_req: Request, res: Response) => {
  try {
    let data: any;
    try {
      data = await getChampionshipStandings();
    } catch (e: any) {
      return sendDbError(res, e);
    }

    return res.json({
      status: 'ACTIVE',
      timestamp: new Date().toISOString(),
      standings: data || {},
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

