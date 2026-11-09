import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { isClientScanUuid, resolveAthlete } from '../utils/athlete-resolve';

export const accreditationRouter = Router();

accreditationRouter.use(authenticate);
accreditationRouter.use(requireRole(['meet_admin', 'accreditation_volunteer']));

/**
 * POST /api/accreditation/scan
 * Body: { clientScanUuid, qrToken | bib | athleteId, deviceTimestamp? }
 * Accreditation needs the college's fee to be verified.
 */
accreditationRouter.post('/scan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clientScanUuid, deviceTimestamp } = req.body || {};

    if (!isClientScanUuid(clientScanUuid)) {
      return res.status(400).json({ error: 'clientScanUuid (UUID) is required.' });
    }
    const who = await resolveAthlete(req.body);
    if (!who.ok) return res.status(who.status).json({ error: who.error });

    // A re-sent scan (offline retry) must succeed even if checked before — the RPC handles that.
    const { data: prior } = await supabase
      .from('accreditation_scans')
      .select('id')
      .eq('client_scan_uuid', clientScanUuid)
      .maybeSingle();
    if (!prior) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('squads ( payment_status, colleges ( code ) )')
        .eq('id', who.athleteId)
        .maybeSingle();
      const squad: any = (prof as any)?.squads;
      if (!prof) return res.status(404).json({ error: 'Athlete profile not found.' });
      if (squad?.payment_status !== 'VERIFIED') {
        return res.status(400).json({
          error: `Fees for ${squad?.colleges?.code || 'this college'} are not verified yet. Send the team manager to the finance desk.`,
        });
      }
    }

    const { data, error } = await supabase.rpc('process_accreditation_scan', {
      p_client_uuid: clientScanUuid,
      p_profile_id: who.athleteId,
      p_volunteer_id: req.user!.entityId,
      p_device_timestamp: deviceTimestamp || new Date().toISOString(),
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/accreditation/stats
 */
accreditationRouter.get('/stats', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const active = () =>
      supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('accreditation_status', 'WITHDrAWN');
    const [all, done] = await Promise.all([active(), active().eq('accreditation_status', 'ACCREDITED')]);
    const err = all.error || done.error;
    if (err) return res.status(400).json({ error: err.message });

    const total = all.count || 0;
    const accredited = done.count || 0;
    return res.json({
      totalAthletes: total,
      accreditedAthletes: accredited,
      pendingAccreditation: total - accredited,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
