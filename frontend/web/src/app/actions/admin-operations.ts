'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, requireFinance } from '@/lib/auth-guard';
import { revalidatePath } from 'next/cache';
import { calculateFeesForSquads, emptySquadFees, reviewPayment } from '@/lib/payments';
import { searchAthletesPage, searchAllAthletes, type AthleteFilters } from '@/lib/admin-athletes';
import { signPaymentProofLinks } from '@/lib/payment-proofs';
import { normalizePaymentStatus, totalCredited } from '@/lib/payment-status';
import { tryMakeAthleteQrToken } from '@/lib/athlete-qr';
import { signAthletePhotos } from '@/lib/photo-links';
import { OFFICIAL_UPI_ID, OFFICIAL_ACCOUNT_NAME } from '@/lib/payment-config';
import { VTU_DIVISIONS, collegeDivision } from '@/lib/college-regions';

/** Athletes registered from one VTU division, split Men / Women. */
export interface DivisionAthleteCount {
  division: string;
  men: number;
  women: number;
  /** Colleges of this division with at least one athlete */
  colleges: number;
}

export interface AdminDashboardStats {
  registrationOpen: boolean;
  registrationClosedAt: string | null;
  totalAthletes: number;
  totalColleges: number;
  totalSquads: number;
  verifiedSquadsCount: number;
  pendingSquadsCount: number;
  rejectedSquadsCount: number;
  draftSquadsCount: number;
  totalBibsGenerated: number;
  /** Division-wise Men / Women athlete counts (VTU divisions, then 'Unassigned' if any) */
  divisionCounts: DivisionAthleteCount[];
}

/**
 * Logs an administrative event to the audit log.
 */
async function logAudit(action: string, details: Record<string, any> = {}, performedBy = 'Administrator') {
  try {
    // Ensure audit table exists
    const { error } = await supabaseAdmin.from('admin_audit_logs').insert({
      action,
      details,
      performed_by: performedBy,
    });
    // supabase-js reports failures via `error` (it does not throw) — surface them in logs
    if (error) console.warn('Audit log not written:', action, error.message);
  } catch (err) {
    console.warn('Audit logging notice (non-fatal):', err);
  }
}

/**
 * 1. Fetches real-time operational metrics for the Admin Dashboard.
 */
export async function getAdminDashboardStatsAction(): Promise<AdminDashboardStats> {
  await requireAdmin();

  // Five independent reads (settings, athlete / college counts, squads, bibs): fetched together
  const [{ data: settings }, { count: totalAthletes }, { count: totalColleges }, { data: squads }, { count: totalBibsGenerated }] =
    await Promise.all([
      supabaseAdmin.from('meet_settings').select('registration_open, registration_closed_at').limit(1).maybeSingle(),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('colleges').select('id', { count: 'exact', head: true }),
      // Few hundred squads (well under the 1,000-row cap); profiles(count) = athletes per squad
      supabaseAdmin.from('squads').select('id, gender, payment_status, roster_locked, colleges (code, region), profiles (count)'),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).not('bid_number', 'is', null),
    ]);

  const totalSquads = squads?.length || 0;
  const verifiedSquadsCount = squads?.filter((s) => s.payment_status === 'VERIFIED').length || 0;
  const pendingSquadsCount = squads?.filter((s) => s.payment_status === 'SUBMITTED').length || 0;
  const rejectedSquadsCount = squads?.filter((s) => s.payment_status === 'REJECTED').length || 0;
  const draftSquadsCount = squads?.filter((s) => normalizePaymentStatus(s.payment_status) === 'DRAFT').length || 0;

  // Division-wise Men / Women counts: division from colleges.region, else the built-in code map
  const byDivision = new Map<string, { men: number; women: number; colleges: Set<string> }>();
  for (const d of [...VTU_DIVISIONS, 'Unassigned']) byDivision.set(d, { men: 0, women: 0, colleges: new Set() });
  for (const sq of (squads || []) as any[]) {
    const college = Array.isArray(sq.colleges) ? sq.colleges[0] : sq.colleges;
    const athletes = Number(sq.profiles?.[0]?.count ?? 0);
    if (!athletes) continue;
    const row = byDivision.get(collegeDivision(college?.code, college?.region) || 'Unassigned')!;
    if (sq.gender === 'women') row.women += athletes;
    else row.men += athletes;
    row.colleges.add(college?.code || sq.id);
  }
  const divisionCounts: DivisionAthleteCount[] = [...byDivision]
    .filter(([d, r]) => d !== 'Unassigned' || r.men + r.women > 0)
    .map(([division, r]) => ({ division, men: r.men, women: r.women, colleges: r.colleges.size }));

  return {
    registrationOpen: settings?.registration_open ?? true,
    registrationClosedAt: settings?.registration_closed_at || null,
    totalAthletes: totalAthletes || 0,
    totalColleges: totalColleges || 0,
    totalSquads,
    verifiedSquadsCount,
    pendingSquadsCount,
    rejectedSquadsCount,
    draftSquadsCount,
    totalBibsGenerated: totalBibsGenerated || 0,
    divisionCounts,
  };
}

/**
 * 2. Toggles registration status between OPEN and CLOSED (single toggle button).
 */
export async function toggleRegistrationStatusAction(): Promise<{
  success: boolean;
  isOpen: boolean;
  error?: string;
}> {
  const admin = await requireAdmin();

  const { data: currentSettings } = await supabaseAdmin
    .from('meet_settings')
    .select('id, registration_open')
    .limit(1)
    .maybeSingle();

  const currentOpen = currentSettings ? currentSettings.registration_open : true;
  const newStatus = !currentOpen;

  const updatePayload: any = {
    registration_open: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (!newStatus) {
    updatePayload.registration_closed_at = new Date().toISOString();
  } else {
    updatePayload.registration_closed_at = null;
  }

  // Guaranteed WHERE filter for meet_settings update
  let updateError = null;
  if (currentSettings?.id) {
    const { error } = await supabaseAdmin
      .from('meet_settings')
      .update(updatePayload)
      .eq('id', currentSettings.id);
    updateError = error;
  } else {
    // If no row returned from maybeSingle, check if any row exists or insert default
    const { data: existingRows } = await supabaseAdmin
      .from('meet_settings')
      .select('id')
      .limit(1);

    if (existingRows && existingRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('meet_settings')
        .update(updatePayload)
        .eq('id', existingRows[0].id);
      updateError = error;
    } else {
      const { error } = await supabaseAdmin
        .from('meet_settings')
        .insert({
          ...updatePayload,
          meet_name: 'VTU Inter-Collegiate Athletics Meet 2026',
          venue: 'VTU Campus Stadium',
          host_upi_id: OFFICIAL_UPI_ID,
          host_account_name: OFFICIAL_ACCOUNT_NAME,
        });
      updateError = error;
    }
  }

  if (updateError) {
    return { success: false, isOpen: currentOpen, error: updateError.message };
  }

  // If closing registration, also lock all squad rosters
  if (!newStatus) {
    const lockAll = await supabaseAdmin
      .from('squads')
      .update({ roster_locked: true, late_entry_open: false, updated_at: new Date().toISOString() })
      .not('id', 'is', null);
    // Before migration 0017 the late_entry_open column does not exist yet
    if (lockAll.error) {
      await supabaseAdmin
        .from('squads')
        .update({ roster_locked: true, updated_at: new Date().toISOString() })
        .not('id', 'is', null);
    }
  }

  // Re-opening: closing locked EVERY roster, including colleges that never paid. Give those
  // (payment still DRAFT — nothing submitted, verified or rejected) their editing back.
  // Squads that submitted a payment stay locked, exactly as they were before the close.
  let reopenedSquads = 0;
  if (newStatus) {
    const { data: unlocked, error: unlockErr } = await supabaseAdmin
      .from('squads')
      .update({ roster_locked: false, updated_at: new Date().toISOString() })
      .in('payment_status', ['DRAFT', 'DrAFT'])
      .eq('roster_locked', true)
      .select('id');
    if (unlockErr) console.error('Re-open: unlocking unpaid squads failed:', unlockErr.message);
    reopenedSquads = unlocked?.length || 0;
  }

  await logAudit(
    newStatus ? 'OPENED_REGISTRATION' : 'CLOSED_REGISTRATION',
    {
      previousStatus: currentOpen ? 'OPEN' : 'CLOSED',
      newStatus: newStatus ? 'OPEN' : 'CLOSED',
      ...(newStatus ? { unpaidSquadsUnlocked: reopenedSquads } : {}),
    },
    admin.displayName || 'Administrator'
  );

  revalidatePath('/admin');
  revalidatePath('/squad/dashboard');
  revalidatePath('/squad/athletes');
  revalidatePath('/');

  return { success: true, isOpen: newStatus };
}

/**
 * 3. Assigns bib numbers via the single database path (close_registration_and_generate_bids,
 * migration 0017). Append-only: athletes that already have a number keep it; only athletes of
 * VERIFIED + locked squads without a number get the next free one (Men 100+, Women 2001+).
 * Safe to run repeatedly — e.g. after late payment verification or a late entry.
 */
export async function generateBibNumbersAction(): Promise<{
  success: boolean;
  assignedCount?: number;
  lateEntries?: number;
  error?: string;
  unverifiedSquads?: string[];
}> {
  const admin = await requireAdmin();

  const { data: settings } = await supabaseAdmin
    .from('meet_settings')
    .select('registration_open')
    .limit(1)
    .maybeSingle();

  if (settings?.registration_open) {
    return {
      success: false,
      error: 'Registration is currently OPEN. You must CLOSE registration before generating bib numbers.',
    };
  }

  const { data, error } = await supabaseAdmin.rpc('close_registration_and_generate_bids');
  if (error) return { success: false, error: error.message };

  const result: any = data || {};
  const assignedCount = (result.total_men_bids_assigned || 0) + (result.total_women_bids_assigned || 0);
  const pending: string[] = (Array.isArray(result.pending_squads) ? result.pending_squads : []).map((p: any) => {
    const why =
      p.payment_status === 'VERIFIED' && !p.roster_locked
        ? 'roster unlocked (late-entry window open)'
        : `payment ${normalizePaymentStatus(p.payment_status)}`;
    return `${p.college} (${p.squad_code}) — ${p.waiting} athlete(s) waiting: ${why}`;
  });

  await logAudit('GENERATED_BIB_NUMBERS', {
    assignedCount,
    menAssigned: result.total_men_bids_assigned || 0,
    womenAssigned: result.total_women_bids_assigned || 0,
    lateEntries: result.late_entries_numbered || 0,
    pendingSquads: pending.length,
  }, admin.displayName || 'Administrator');

  revalidatePath('/admin');
  revalidatePath('/admin/athletes');
  revalidatePath('/admin/id-cards');
  revalidatePath('/admin/bids');
  revalidatePath('/admin/amendments');

  return {
    success: true,
    assignedCount,
    lateEntries: result.late_entries_numbered || 0,
    unverifiedSquads: pending,
  };
}

/**
 * 4. Athletes Management / ID Cards: one page of athletes that match the filters (the filtering
 * runs in the database; only the rows shown are read, and only their photos are signed).
 */
export async function listAthletesPageAction(filters: AthleteFilters, page = 1) {
  await requireAdmin();
  const { rows, total } = await searchAthletesPage(filters, page);
  return { rows: await signAthletePhotos(rows), total };
}

/**
 * Every athlete matching the filters (or the whole roster) for the Excel / PDF downloads —
 * read only when a download button is clicked. Aadhaar / passport numbers leave the server
 * masked to their last 4 characters (the export shows only those).
 */
export async function exportAthletesAction(filters: AthleteFilters | null) {
  await requireAdmin();
  const rows = await searchAllAthletes(filters || {}, 'aadhaar_number');
  return rows.map((a: any) => ({ ...a, aadhaar_number: a.aadhaar_number ? String(a.aadhaar_number).slice(-4) : null }));
}

/** ID Cards Studio: every athlete matching the filters, with signed photos and QR tokens. */
export async function listIdCardAthletesAction(filters: AthleteFilters) {
  await requireAdmin();
  const rows = await searchAllAthletes(filters);
  return signAthletePhotos(rows.map((a: any) => ({ ...a, qr_token: tryMakeAthleteQrToken(a.id) })));
}

/** Payment Verification modal: one squad's athletes, read when the squad is opened. */
export async function getSquadRosterAction(squadId: string) {
  await requireFinance();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, sslc_name, usn, bid_number, registrations(id, kind, events(name, code))')
    .eq('squad_id', squadId)
    .order('sslc_name');
  if (error) return { athletes: [], error: error.message };
  return { athletes: data || [] };
}

/**
 * Delegation check-in sheets: every squad with its athletes and events. Fees, payments and proof
 * links are not needed here (they made this page as slow as Payment Verification).
 */
export async function listDelegationsAction() {
  await requireAdmin();
  const { data, error } = await supabaseAdmin
    .from('squads')
    .select(`
      id, gender, squad_code, ped_name, ped_phone, ped_email,
      colleges (name, code, district, region),
      profiles (id, sslc_name, usn, semester, bid_number, registrations (kind, events (name, code)))
    `)
    .order('squad_code', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 5. Lists all college squads and their payment submissions for Payment Verification.
 */
export async function listPaymentsForAdminAction() {
  await requireFinance();

  // Fetch squads with colleges and athlete counts
  const { data: squads, error: sqErr } = await supabaseAdmin
    .from('squads')
    .select(`
      id,
      gender,
      squad_code,
      ped_name,
      ped_phone,
      ped_email,
      roster_locked,
      payment_status,
      colleges (*),
      profiles (count),
      payments (*)
    `)
    .order('squad_code', { ascending: true });

  if (sqErr) throw new Error(sqErr.message);

  // Same fee engine as the squad's Fee Settlement page (₹100 per relay member, first 4 per team,
  // reserves free, mixed relay ₹100 per squad member up to 2) so Finance and PED see one number —
  // computed for every squad in a few bulk reads, not one set of queries per squad.
  const feesBySquad = await calculateFeesForSquads((squads || []).map((sq: any) => sq.id));

  // ONE PAYMENT PER COLLEGE: expected fee, verified total and balance are the college's
  // (Men + Women). Each squad row shows the college figures; its own share is in feeBreakdown.
  const collegeKey = (sq: any) => sq.colleges?.id || sq.id;
  const collegeFee = new Map<string, number>();
  const collegePayments = new Map<string, any[]>();
  for (const sq of squads || []) {
    const k = collegeKey(sq);
    collegeFee.set(k, (collegeFee.get(k) || 0) + (feesBySquad.get(sq.id) || emptySquadFees()).totalAmount);
    collegePayments.set(k, [...(collegePayments.get(k) || []), ...(sq.payments || [])]);
  }

  const squadGender = new Map((squads || []).map((s: any) => [s.id, s.gender]));
  const enrichedSquads = (squads || []).map(
    (sq: any) => {
      const fees = feesBySquad.get(sq.id) || emptySquadFees();
      const expectedFee = collegeFee.get(collegeKey(sq)) || 0;

      // Latest payment submission (embedded rows are unordered, so sort explicitly)
      const sortedPayments = [...(sq.payments || [])].sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const latestPayment = sortedPayments[0] || null;
      const pendingPayment = sortedPayments.find((p: any) => p.status === 'SUBMITTED') || null;
      const totalVerified = totalCredited(collegePayments.get(collegeKey(sq)) || []);
      // One payment per college: when the receipt was sent from the other division's login, the
      // row shows that receipt instead of "No submission yet".
      const collegeLatest = [...(collegePayments.get(collegeKey(sq)) || [])].sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0] || null;
      const otherDivisionPayment =
        !latestPayment && collegeLatest && collegeLatest.squad_id !== sq.id
          ? { ...collegeLatest, fromGender: squadGender.get(collegeLatest.squad_id) || null }
          : null;

      const { profiles, ...rest } = sq;
      return {
        ...rest,
        // athletes are read only when the squad is opened (getSquadRosterAction)
        athleteCount: Number(profiles?.[0]?.count || 0),
        payments: sortedPayments,
        expectedFee,
        ownFee: fees.totalAmount,
        feeBreakdown: fees,
        totalVerified,
        balanceDue: Math.max(0, expectedFee - totalVerified),
        latestPayment,
        pendingPayment,
        otherDivisionPayment,
      };
    }
  );

  // Payment proofs are in a private bucket: hand the admin page 1-hour signed links
  await signPaymentProofLinks(enrichedSquads.flatMap((sq: any) => sq.payments || []));

  return enrichedSquads;
}

/**
 * 6. Approves or Rejects a college squad payment transaction.
 */
export async function verifySquadPaymentAction(
  squadId: string,
  status: 'VERIFIED' | 'REJECTED',
  rejectionReason?: string,
  amountReceived?: number,
  /** The receipt the desk is showing. Repeat payments are allowed, so a squad can have several pending. */
  paymentId?: string
): Promise<{ success: boolean; error?: string }> {
  const adminSession = await requireFinance();

  // Decide exactly the receipt the desk showed (its UTR, proof and amount), never "the oldest/latest
  // pending one": with two pending receipts that verified the wrong UTR with the other one's amount.
  let pendingQuery = supabaseAdmin
    .from('payments')
    .select('id, amount_submitted, utr_number')
    .eq('squad_id', squadId)
    .eq('status', 'SUBMITTED');
  if (paymentId) pendingQuery = pendingQuery.eq('id', paymentId);
  const { data: pendingRows, error: findErr } = await pendingQuery.order('created_at', { ascending: true });

  if (findErr) return { success: false, error: findErr.message };
  if (!pendingRows || pendingRows.length === 0) {
    return { success: false, error: 'This receipt is no longer awaiting verification. It may already have been processed — reload the page.' };
  }
  if (!paymentId && pendingRows.length > 1) {
    return { success: false, error: `This squad has ${pendingRows.length} receipts awaiting verification. Reload the page and decide each receipt separately.` };
  }
  const pendingPayment = pendingRows[0];

  const result = await reviewPayment(pendingPayment.id, status, rejectionReason, adminSession.entityId, amountReceived);
  if (!result.success) return result;

  await logAudit(
    status === 'VERIFIED' ? 'PAYMENT_APPROVED' : 'PAYMENT_REJECTED',
    {
      squadId,
      paymentId: pendingPayment.id,
      utr: pendingPayment.utr_number,
      status,
      amountClaimed: pendingPayment.amount_submitted,
      amountReceived: status === 'VERIFIED' ? amountReceived : null,
      mismatch: status === 'VERIFIED' && amountReceived !== pendingPayment.amount_submitted,
      rejectionReason: rejectionReason || 'None',
    },
    adminSession.displayName || 'Administrator'
  );

  revalidatePath('/admin/payments');
  revalidatePath('/admin');
  revalidatePath('/squad/payment');
  revalidatePath('/squad/dashboard');

  return { success: true };
}

/**
 * 7. Draws every lane event (sprints, hurdles, relays) through the database draw
 *    (generate_heat_draw): only accredited athletes of paid colleges, teammates in different
 *    heats, random lanes. An event that fits in one race is drawn straight as a FINAL; a
 *    bigger one gets HEATS. Events that are already under way are left alone.
 */
export async function generateTrackHeatsAction(): Promise<{
  success: boolean;
  totalHeatsCreated?: number;
  totalAthletesSeeded?: number;
  skipped?: string[];
  error?: string;
}> {
  const admin = await requireAdmin();

  const { data: ms } = await supabaseAdmin.from('meet_settings').select('photo_finish_mode').limit(1).maybeSingle();
  if ((ms as any)?.photo_finish_mode === 'MANUAL') {
    return { success: false, error: 'Photo finish MANUAL mode is on: the vendor makes the heats. Enter them in Admin > Photo Finish, or switch back to App mode there.' };
  }

  const { data: trackEvents, error: evErr } = await supabaseAdmin
    .from('events')
    .select('id, name, code, max_lanes, start_type, heats(status)')
    .eq('start_type', 'lanes')
    .order('code', { ascending: true });

  if (evErr || !trackEvents || trackEvents.length === 0) {
    return { success: false, error: evErr?.message || 'No lane-based track events found.' };
  }

  let totalHeatsCreated = 0;
  let totalAthletesSeeded = 0;
  const skipped: string[] = [];

  const draw = async (eventId: string, stage: 'HEATS' | 'FINAL', lanes: number) =>
    supabaseAdmin.rpc('generate_heat_draw', { p_event_id: eventId, p_stage: stage, p_num_lanes: lanes });

  for (const event of trackEvents as any[]) {
    if ((event.heats || []).some((h: any) => h.status !== 'SCHEDULED')) {
      skipped.push(`${event.name}: already under way`);
      continue;
    }
    const lanes = event.max_lanes || 8;

    // Nothing has started: clear the old draft so the event is drawn from scratch
    if ((event.heats || []).length) {
      const { error: delErr } = await supabaseAdmin.from('heats').delete().eq('event_id', event.id).eq('status', 'SCHEDULED');
      if (delErr) {
        skipped.push(`${event.name}: could not clear the old draw (${delErr.message})`);
        continue;
      }
    }

    // Straight final when everyone fits in one race; otherwise heats
    let { data, error } = await draw(event.id, 'FINAL', lanes);
    if (error && /Draw HEATS first/i.test(error.message)) {
      ({ data, error } = await draw(event.id, 'HEATS', lanes));
    }

    if (error) {
      skipped.push(`${event.name}: ${error.message}`);
      continue;
    }
    totalHeatsCreated += Number((data as any)?.num_heats) || 0;
    totalAthletesSeeded += Number((data as any)?.total_athletes) || 0;
  }

  await logAudit('GENERATED_TRACK_HEATS', { totalHeatsCreated, totalAthletesSeeded, skipped }, admin.displayName || 'Administrator');

  revalidatePath('/admin/heats');
  revalidatePath('/admin/schedule');

  return { success: true, totalHeatsCreated, totalAthletesSeeded, skipped };
}

/**
 * 8. Fetches the administrative audit log.
 */
export async function listAuditLogsAction() {
  await requireAdmin();

  // Try fetching from admin_audit_logs, fallback to empty array
  const { data, error } = await supabaseAdmin
    .from('admin_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return [];
  }
  return data || [];
}
