import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { fetchAll } from '../utils/fetch-all';
import { isClientScanUuid, resolveAthlete } from '../utils/athlete-resolve';
import { sendDbError } from '../utils/db-error';

export const accommodationRouter = Router();

accommodationRouter.use(authenticate);
accommodationRouter.use(requireRole(['meet_admin', 'warden']));

/**
 * GET /api/accommodation/hostels
 * Returns all hostels with total capacity, checked-in count, and remaining capacity
 */
accommodationRouter.get('/hostels', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: hostels, error: hostelErr } = await supabase
      .from('hostels')
      .select('*')
      .order('name');

    if (hostelErr) return sendDbError(res, hostelErr);

    // Fetch scan counts per hostel
    const scans = await fetchAll<{ hostel_id: string; profile_id: string }>((from, to) =>
      supabase.from('accommodation_scans').select('hostel_id, profile_id').order('id').range(from, to)
    );

    // One bed per athlete, however many times they were scanned
    const seen: Record<string, Set<string>> = {};
    (scans || []).forEach((s) => {
      (seen[s.hostel_id] ||= new Set()).add(s.profile_id);
    });
    const countMap: Record<string, number> = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size]));

    const enrichedHostels = (hostels || []).map((h) => {
      const occupied = countMap[h.id] || 0;
      return {
        ...h,
        occupied,
        available: Math.max(0, h.total_capacity - occupied),
      };
    });

    return res.json({ hostels: enrichedHostels });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/accommodation/checkin
 * Body: { clientScanUuid, qrToken | bib | athleteId, hostelId?, roomAssigned?, cautionDeposit?,
 *         cautionReceiptNo?, deviceTimestamp? }
 * hostelId defaults to the hostel allotted to the athlete's squad. Idempotent per clientScanUuid.
 */
accommodationRouter.post('/checkin', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clientScanUuid, roomAssigned, cautionDeposit, cautionReceiptNo, deviceTimestamp } = req.body || {};
    let hostelId: string | undefined = req.body?.hostelId || undefined;

    if (!isClientScanUuid(clientScanUuid)) {
      return res.status(400).json({ error: 'clientScanUuid (UUID) is required.' });
    }
    const who = await resolveAthlete(req.body);
    if (!who.ok) return res.status(who.status).json({ error: who.error });

    let roomRange: string | null = null;
    if (!hostelId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('squad_id, accommodation_checked_in')
        .eq('id', who.athleteId)
        .maybeSingle();
      if (!prof) return res.status(404).json({ error: 'Athlete profile not found.' });
      const { data: alloc } = await supabase
        .from('hostel_allocations')
        .select('hostel_id, room_range')
        .eq('squad_id', prof.squad_id)
        .maybeSingle();
      // Already checked in: the RPC reports where, so no hostel needs to be chosen
      if (!alloc && !prof.accommodation_checked_in) {
        return res.status(400).json({ error: 'No hostel is allotted to this athlete\'s college yet. Pick the hostel in the app and scan again.' });
      }
      hostelId = alloc?.hostel_id;
      roomRange = alloc?.room_range || null;
    }

    const { data, error } = await supabase.rpc('process_accommodation_checkin', {
      p_client_uuid: clientScanUuid,
      p_profile_id: who.athleteId,
      p_hostel_id: hostelId ?? null,
      p_warden_id: req.user!.entityId,
      p_room_assigned: roomAssigned || roomRange || 'General Dorm',
      // No caution deposit is collected for this meet unless the warden records one
      p_caution_deposit: cautionDeposit ? parseFloat(cautionDeposit) : 0,
      p_caution_receipt_no: cautionReceiptNo || '',
      p_device_timestamp: deviceTimestamp || new Date().toISOString(),
    });

    if (error) return sendDbError(res, error);
    return res.json({ success: true, result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/accommodation/stats
 * Aggregate dashboard stats for hostel administration
 */
accommodationRouter.get('/stats', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const active = () =>
      supabase.from('profiles').select('id, squads!inner(gender)', { count: 'exact', head: true }).neq('accreditation_status', 'WITHDrAWN');
    const [all, inn, men, women] = await Promise.all([
      active(),
      active().eq('accommodation_checked_in', true),
      active().eq('accommodation_checked_in', true).eq('squads.gender', 'men'),
      active().eq('accommodation_checked_in', true).eq('squads.gender', 'women'),
    ]);
    const err = all.error || inn.error || men.error || women.error;
    if (err) return sendDbError(res, err);

    const deposits = await fetchAll<{ caution_deposit: string | number }>((from, to) =>
      supabase.from('accommodation_scans').select('caution_deposit').order('id').range(from, to)
    );
    const totalCautionCollected = deposits.reduce((acc, s) => acc + (parseFloat(String(s.caution_deposit)) || 0), 0);

    const total = all.count || 0;
    const checkedIn = inn.count || 0;
    return res.json({
      totalAthletes: total,
      checkedInAthletes: checkedIn,
      pendingCheckIn: total - checkedIn,
      menCheckedIn: men.count || 0,
      womenCheckedIn: women.count || 0,
      totalCautionCollected,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/accommodation/scans
 * Recent check-in scans audit log
 */
accommodationRouter.get('/scans', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const { data, error } = await supabase
      .from('accommodation_scans')
      .select(`
        id,
        client_scan_uuid,
        room_assigned,
        caution_deposit,
        caution_receipt_no,
        synced_at,
        device_timestamp,
        profiles(id, sslc_name, usn, bid_number, squads(gender, colleges(name))),
        hostels(id, name, gender)
      `)
      .order('synced_at', { ascending: false })
      .limit(limit);

    if (error) return sendDbError(res, error);
    return res.json({ scans: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
