import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { isClientScanUuid, resolveAthlete } from '../utils/athlete-resolve';

export const cateringRouter = Router();

cateringRouter.use(authenticate);
cateringRouter.use(requireRole(['food_volunteer', 'meet_admin']));

/**
 * POST /api/catering/scan
 * Body: { clientScanUuid, mealType, qrToken | bib | athleteId, scannedAt? }
 * scannedAt = when the volunteer scanned (offline scans sync later) — the meal counts for that
 * India date, not the sync date. Re-sending the same clientScanUuid is safe.
 */
cateringRouter.post('/scan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clientScanUuid, mealType, scannedAt } = req.body || {};

    if (!isClientScanUuid(clientScanUuid)) {
      return res.status(400).json({ error: 'clientScanUuid (UUID) is required.' });
    }
    const validMeals = ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'];
    const normalizedMeal = String(mealType || '').toUpperCase();
    if (!validMeals.includes(normalizedMeal)) {
      return res.status(400).json({ error: `Invalid mealType. Must be one of: ${validMeals.join(', ')}` });
    }

    const who = await resolveAthlete(req.body);
    if (!who.ok) return res.status(who.status).json({ error: who.error });

    const at = scannedAt ? new Date(scannedAt) : new Date();
    const { data, error } = await supabase.rpc('scan_meal_coupon', {
      p_client_uuid: clientScanUuid,
      p_profile_id: who.athleteId,
      p_meal_type: normalizedMeal,
      p_volunteer_id: req.user!.entityId,
      p_scanned_at: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(),
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ ...(data as object), athlete_id: who.athleteId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/catering/stats
 * Real-time counts of meals served today
 */
cateringRouter.get('/stats', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabase.rpc('get_meal_stats');
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
