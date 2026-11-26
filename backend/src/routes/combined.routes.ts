import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { assertCanWriteEntry, finalizeHeat, ProgressionError } from '../utils/progression';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { sendDbError } from '../utils/db-error';

/**
 * Decathlon / Heptathlon referee endpoints. Marks are saved per athlete per discipline and the
 * points come from the database (World Athletics tables, migration 0045) — the app only shows them.
 */
export const combinedRouter = Router();

combinedRouter.use(authenticate);
combinedRouter.use(requireRole(['meet_admin', 'referee']));

/**
 * GET /api/combined/heats/:heatId
 * The heat's athletes with every saved mark, the disciplines (with their coefficients so the app
 * can show points while offline) and the running standings.
 */
combinedRouter.get('/heats/:heatId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { heatId } = req.params;

    const { data: heat, error: heatErr } = await supabase
      .from('heats')
      .select('id, heat_number, stage, status, events(id, name, code, gender, category)')
      .eq('id', heatId)
      .single();
    if (heatErr) return sendDbError(res, heatErr);
    const ev: any = Array.isArray((heat as any).events) ? (heat as any).events[0] : (heat as any).events;

    const [disc, ath, st] = await Promise.all([
      supabase.from('combined_disciplines').select('*').eq('event_code', String(ev?.code || '').toUpperCase()).order('seq'),
      supabase
        .from('heat_athletes')
        .select(
          `id, lane_number, call_room_reported,
           profiles(id, sslc_name, usn, bid_number, squads(colleges(name, code))),
           call_room_inspections(reported_status),
           combined_results(discipline, mark, status, points)`
        )
        .eq('heat_id', heatId)
        .order('lane_number', { ascending: true }),
      supabase.rpc('compute_combined_standings', { p_event_id: ev?.id }),
    ]);
    if (disc.error) return sendDbError(res, disc.error);
    if (ath.error) return sendDbError(res, ath.error);
    if (!(disc.data || []).length) return res.status(400).json({ error: 'This event has no combined-event scoring table. Apply migration 0045.' });

    return res.json({
      heat,
      disciplines: disc.data,
      athletes: ath.data || [],
      standings: (st.data as any)?.standings || [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/combined/result  { heatAthleteId, discipline, mark, status }
 * status: FINISHED (needs a mark) | NM (no valid mark, 0 points) | DNF | DQ | DNS
 * Marks in seconds (track) or metres (field). Safe to send twice.
 */
combinedRouter.post('/result', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { heatAthleteId, discipline, mark, status = 'FINISHED' } = req.body || {};
    if (!heatAthleteId || !discipline) return res.status(400).json({ error: 'heatAthleteId and discipline are required.' });
    try {
      await assertCanWriteEntry(req.user!, String(heatAthleteId));
    } catch (e: any) {
      return res.status(e instanceof ProgressionError ? e.status : 500).json({ error: e.message });
    }
    const m = mark === null || mark === undefined || mark === '' ? null : Number(mark);
    if (m !== null && !Number.isFinite(m)) return res.status(400).json({ error: 'The mark is not a number.' });

    const { data, error } = await supabase.rpc('submit_combined_result', {
      p_heat_athlete_id: heatAthleteId,
      p_discipline: String(discipline),
      p_mark: m,
      p_status: String(status),
      p_official_id: req.user!.entityId,
    });
    if (error) return sendDbError(res, error);
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /api/combined/finalize { heatId } — mark the heat done and award championship points */
combinedRouter.post('/finalize', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const heatId = String(req.body?.heatId || '');
    if (!heatId) return res.status(400).json({ error: 'heatId is required.' });
    return res.json(await finalizeHeat(heatId, req.user!, { eventId: req.body?.eventId, stage: req.body?.stage }));
  } catch (err: any) {
    return res.status(err instanceof ProgressionError ? err.status : 500).json({ error: err.message });
  }
});
