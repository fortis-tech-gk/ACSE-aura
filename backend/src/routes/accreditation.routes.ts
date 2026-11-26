import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { isClientScanUuid, resolveAthlete } from '../utils/athlete-resolve';
import { sendDbError } from '../utils/db-error';

export const accreditationRouter = Router();

accreditationRouter.use(authenticate);
accreditationRouter.use(requireRole(['meet_admin', 'accreditation_volunteer']));

/**
 * POST /api/accreditation/scan
 * Body: { clientScanUuid, qrToken | bib | athleteId, deviceTimestamp? }
 * College check-in (migration 0054): scanning ANY one athlete checks in the whole college and
 * accredits every athlete of its fee-verified squads. The RPC refuses a college whose fee is not
 * verified, and is idempotent per clientScanUuid (offline retries).
 */
accreditationRouter.post('/scan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clientScanUuid, deviceTimestamp } = req.body || {};

    if (!isClientScanUuid(clientScanUuid)) {
      return res.status(400).json({ error: 'clientScanUuid (UUID) is required.' });
    }
    const who = await resolveAthlete(req.body);
    if (!who.ok) return res.status(who.status).json({ error: who.error });

    const { data, error } = await supabase.rpc('process_accreditation_scan', {
      p_client_uuid: clientScanUuid,
      p_profile_id: who.athleteId,
      p_volunteer_id: req.user!.entityId,
      p_device_timestamp: deviceTimestamp || new Date().toISOString(),
    });

    if (error) return sendDbError(res, error);
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/accreditation/stats
 * Colleges checked in vs still to come (colleges with a verified fee), and accredited athletes.
 */
accreditationRouter.get('/stats', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const active = () =>
      supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('accreditation_status', 'WITHDrAWN');
    const [all, done, paid] = await Promise.all([
      active(),
      active().eq('accreditation_status', 'ACCREDITED'),
      supabase.from('squads').select('college_id, colleges ( attendance_marked_at )').eq('payment_status', 'VERIFIED'),
    ]);
    const err = all.error || done.error || paid.error;
    if (err) return sendDbError(res, err);

    const colleges = new Map<string, boolean>();
    for (const sq of (paid.data || []) as any[]) {
      const c = Array.isArray(sq.colleges) ? sq.colleges[0] : sq.colleges;
      colleges.set(sq.college_id, Boolean(c?.attendance_marked_at));
    }
    const present = [...colleges.values()].filter(Boolean).length;

    const total = all.count || 0;
    const accredited = done.count || 0;
    return res.json({
      collegesPresent: present,
      collegesPending: colleges.size - present,
      collegesTotal: colleges.size,
      totalAthletes: total,
      accreditedAthletes: accredited,
      pendingAccreditation: total - accredited,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
