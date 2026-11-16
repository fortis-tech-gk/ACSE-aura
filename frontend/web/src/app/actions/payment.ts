'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireSquad, requireStaff } from '@/lib/auth-guard';
import { revalidatePath } from 'next/cache';
import { calculateCollegeFees, reviewPayment } from '@/lib/payments';
import { resolveHostUpiId, resolveHostAccountName } from '@/lib/payment-config';
import { normalizePaymentStatus, totalCredited, type SquadPaymentStatus } from '@/lib/payment-status';
import { fetchAllRows } from '@/lib/db-fetch-all';

export interface FeeBreakdown {
  regularEventsCount: number;
  regularFeeRate: number;
  reserveEventsCount: number;
  hmCount: number;
  hmFeeRate: number;
  relayTeamsCount: number;
  /** ₹ per relay member, charged for the first 4 members of each team */
  relayFeeRate: number;
  /** Members charged across all relay teams (max 4 per team) */
  relayMembersBilled: number;
  relayFeeTotal: number;
  relayTeams: { eventId: string; code: string; name: string; members: number; billedMembers: number; fee: number }[];
  totalAmount: number;
  totalPaid: number;
  balanceDue: number;
  hostUpiId: string;
  hostAccountName: string;
  squadPaymentStatus: SquadPaymentStatus;
  hasPendingPayment: boolean;
  /** One payment per college: each division's share of the combined fee (Men + Women) */
  divisions: { squadId: string; gender: string; squadCode: string; athletes: number; fee: number; isMine: boolean }[];
  registrationOpen: boolean;
  rosterLocked: boolean;
  collegeName?: string;
  collegeCode?: string;
  district?: string;
  gender?: string;
  pedName?: string;
  pedPhone?: string;
  pedEmail?: string;
  athletesCount?: number;
}

export type { SquadPaymentStatus } from '@/lib/payment-status';

export interface PaymentRecord {
  id: string;
  amount_submitted: number;
  amount_expected: number;
  /** Bank-confirmed amount entered by Finance at verification (migration 0018) */
  amount_received?: number | null;
  utr_number: string;
  screenshot_url: string;
  status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
  rejection_reason?: string;
  created_at: string;
  verified_at?: string;
}

/**
 * Calculates current squad fee breakdown and fetches meet host UPI details.
 */
export async function getSquadFeeBreakdownAction(): Promise<{
  breakdown: FeeBreakdown;
  payments: PaymentRecord[];
}> {
  const session = await requireSquad();

  // ONE PAYMENT PER COLLEGE: fees, athletes and payments of both divisions (Men + Women) are
  // combined, so whichever PED pays settles the whole college.
  const { squadIds, bySquad, combined: feeCalc } = await calculateCollegeFees(session.squadId);
  const [
    { data: settings },
    { data: squad },
    { data: collegeSquads },
    { data: athleteRows },
    { data: payments },
  ] = await Promise.all([
    supabaseAdmin
      .from('meet_settings')
      .select('host_upi_id, host_account_name, registration_open')
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('squads')
      .select(`
        payment_status,
        roster_locked,
        gender,
        ped_name,
        ped_phone,
        ped_email,
        squad_code,
        colleges (
          id,
          name,
          code,
          district
        )
      `)
      .eq('id', session.squadId)
      .single(),
    supabaseAdmin.from('squads').select('id, gender, squad_code').in('id', squadIds),
    supabaseAdmin.from('profiles').select('squad_id').in('squad_id', squadIds),
    supabaseAdmin
      .from('payments')
      .select('*')
      .in('squad_id', squadIds)
      .order('created_at', { ascending: false }),
  ]);

  const totalPaid = totalCredited(payments as any[]);

  const totalAmount = feeCalc.totalAmount;
  const balanceDue = Math.max(0, totalAmount - totalPaid);

  const athletesBySquad = new Map<string, number>();
  for (const r of athleteRows || []) athletesBySquad.set(r.squad_id, (athletesBySquad.get(r.squad_id) || 0) + 1);
  const divisions = (collegeSquads || [])
    .map((sq: any) => ({
      squadId: sq.id,
      gender: sq.gender || '',
      squadCode: sq.squad_code || '',
      athletes: athletesBySquad.get(sq.id) || 0,
      fee: bySquad.get(sq.id)?.totalAmount || 0,
      isMine: sq.id === session.squadId,
    }))
    .sort((x, y) => (x.gender === 'men' ? -1 : 1) - (y.gender === 'men' ? -1 : 1));
  const athletesCount = (athleteRows || []).length;

  const college = squad?.colleges as any;

  return {
    breakdown: {
      regularEventsCount: feeCalc.regularEventsCount,
      regularFeeRate: feeCalc.regularFeeRate,
      reserveEventsCount: feeCalc.reserveEventsCount,
      hmCount: feeCalc.hmCount,
      hmFeeRate: feeCalc.hmFeeRate,
      relayTeamsCount: feeCalc.relayTeamsCount,
      relayFeeRate: feeCalc.relayFeeRate,
      relayMembersBilled: feeCalc.relayMembersBilled,
      relayFeeTotal: feeCalc.relayFeeTotal,
      relayTeams: feeCalc.relayTeams,
      totalAmount,
      totalPaid,
      balanceDue,
      hostUpiId: resolveHostUpiId(settings?.host_upi_id),
      hostAccountName: resolveHostAccountName(settings?.host_account_name),
      squadPaymentStatus: normalizePaymentStatus(squad?.payment_status),
      hasPendingPayment: (payments || []).some((p: any) => p.status === 'SUBMITTED'),
      divisions,
      registrationOpen: settings?.registration_open !== false,
      rosterLocked: squad?.roster_locked === true,
      collegeName: college?.name || 'VTU Affiliated Institution',
      collegeCode: college?.code || '',
      district: college?.district || '',
      gender: squad?.gender || '',
      pedName: squad?.ped_name || '',
      pedPhone: squad?.ped_phone || '',
      pedEmail: squad?.ped_email || '',
      athletesCount: athletesCount || 0,
    },
    payments: payments || [],
  };
}

/**
 * Submits an offline UPI payment transaction for verification by the host college finance desk.
 */
/** Set once the payment-proofs bucket was confirmed in this server instance. */
let paymentBucketEnsured = false;

export async function submitPaymentAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSquad();

    const rawUtr = (formData.get('utrNumber') as string || '').trim();
    const utrClean = rawUtr.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const amountSubmitted = parseInt(formData.get('amountSubmitted') as string, 10);
    const screenshotData = formData.get('screenshotData') as string;

    // UTR must be 8–30 alphanumeric characters (spaces/dashes are stripped, other symbols rejected)
    if (!/^[A-Za-z0-9\s-]+$/.test(rawUtr) || utrClean.length < 8 || utrClean.length > 30) {
      return { success: false, error: 'Please enter a valid 8 to 30 character alphanumeric UTR / Bank reference number.' };
    }

    if (!/^\d+$/.test(String(formData.get('amountSubmitted') || '').trim()) || isNaN(amountSubmitted) || amountSubmitted <= 0) {
      return { success: false, error: 'Amount must be a whole number of rupees greater than zero.' };
    }

    if (!screenshotData && !formData.get('screenshot')) {
      return { success: false, error: 'Please upload the payment transaction screenshot or receipt.' };
    }

    // ONE PAYMENT PER COLLEGE: the balance covers both divisions (Men + Women), a pending receipt
    // from either division blocks a second one, and paying locks both rosters.
    const { squadIds, combined: feeCalc } = await calculateCollegeFees(session.squadId);
    const [{ data: lockRow }, { count: pendingCount }, { data: pastPayments }] =
      await Promise.all([
        supabaseAdmin
          .from('squads')
          .select('roster_locked, ped_name, ped_phone')
          .eq('id', session.squadId)
          .maybeSingle(),
        supabaseAdmin
          .from('payments')
          .select('id', { count: 'exact', head: true })
          .in('squad_id', squadIds)
          .eq('status', 'SUBMITTED'),
        supabaseAdmin
          .from('payments')
          .select('*')
          .in('squad_id', squadIds)
          .eq('status', 'VERIFIED'),
      ]);

    // The invoice, registration report and Finance Desk need a reachable PED
    if (!String(lockRow?.ped_name || '').trim() || !String(lockRow?.ped_phone || '').trim()) {
      return {
        success: false,
        error: 'Please add the PED / Sports Director name and mobile number on the Contingent Overview page before submitting payment.',
      };
    }

    // Lifecycle guard: only one payment may be awaiting verification at a time.
    // DRAFT and REJECTED squads may submit; a VERIFIED squad may submit only if an admin
    // emergency-unlocked the roster and a differential balance is now due (checked below).
    if ((pendingCount || 0) > 0) {
      return {
        success: false,
        error: 'Roster Locked & Payment Submitted: A payment for your college (Men or Women division) is already awaiting Finance Desk verification. You can re-submit only if it is rejected.',
      };
    }

    // Get expected total fee calculated accurately with ₹100 per relay member (first 4 per team)
    const totalAmount = feeCalc.totalAmount;
    if (totalAmount <= 0) {
      return {
        success: false,
        error: 'Cannot submit payment for an empty roster. Please register athletes (Men and/or Women division) before settling fees.',
      };
    }

    // Check prior verified payments to prevent duplicate payments on settled rosters
    // Only bank-confirmed amounts (amount_received) count as already paid
    const priorVerified = totalCredited(pastPayments as any[]);
    const balanceDue = Math.max(0, totalAmount - priorVerified);

    if (balanceDue === 0 && priorVerified > 0) {
      return {
        success: false,
        error: 'All entry fees for your college (both divisions) have already been fully verified and settled.',
      };
    }

    // The college may not type an arbitrary amount: it must pay exactly the balance due.
    // (Finance still confirms the amount actually credited in the bank at verification.)
    if (amountSubmitted !== balanceDue) {
      return {
        success: false,
        error: `The amount must equal your college's balance due of ₹${balanceDue} (Men + Women). Pay exactly ₹${balanceDue} and enter that amount.`,
      };
    }


    // Upload screenshot to Supabase Storage Bucket ('payment-proofs') with validation
    // Only a real storage URL is ever saved — never the raw base64 payload
    let screenshotUrl = '';
    const screenshotFile = formData.get('screenshot') as File | null;

    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
    const ALLOWED_MIME_TYPES: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };

    try {
      // Private bucket: proofs are only viewable through signed links on the admin payments page
      if (!paymentBucketEnsured) {
        await supabaseAdmin.storage.createBucket('payment-proofs', { public: false }).catch(() => { });
        paymentBucketEnsured = true;
      }

      if (screenshotFile && screenshotFile.size > 0 && typeof screenshotFile.arrayBuffer === 'function') {
        if (screenshotFile.size > MAX_FILE_SIZE) {
          return { success: false, error: 'Payment proof file exceeds the maximum limit of 5MB.' };
        }

        const rawMime = (screenshotFile.type || 'image/png').toLowerCase();
        const safeExt = ALLOWED_MIME_TYPES[rawMime];
        if (!safeExt) {
          return { success: false, error: 'Invalid file format. Only JPG, PNG, WebP, and PDF receipts are accepted.' };
        }

        const bytes = await screenshotFile.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const storagePath = `${session.squadId}/${Date.now()}_utr_${utrClean}.${safeExt}`;

        const { data: uploadResult, error: uploadErr } = await supabaseAdmin.storage
          .from('payment-proofs')
          .upload(storagePath, buffer, {
            contentType: rawMime,
            upsert: true,
          });

        if (uploadErr) console.error('Storage upload error:', uploadErr.message);
        if (!uploadErr && uploadResult) {
          const { data: pubData } = supabaseAdmin.storage
            .from('payment-proofs')
            .getPublicUrl(uploadResult.path);
          screenshotUrl = pubData.publicUrl;
        }
      } else if (screenshotData && screenshotData.startsWith('data:')) {
        const match = screenshotData.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const rawMime = match[1].toLowerCase();
          const safeExt = ALLOWED_MIME_TYPES[rawMime];
          if (!safeExt) {
            return { success: false, error: 'Invalid file format. Only JPG, PNG, WebP, and PDF receipts are accepted.' };
          }

          const buffer = Buffer.from(match[2], 'base64');
          if (buffer.length > MAX_FILE_SIZE) {
            return { success: false, error: 'Payment proof exceeds the maximum limit of 5MB.' };
          }

          const storagePath = `${session.squadId}/${Date.now()}_utr_${utrClean}.${safeExt}`;

          const { data: uploadResult, error: uploadErr } = await supabaseAdmin.storage
            .from('payment-proofs')
            .upload(storagePath, buffer, {
              contentType: rawMime,
              upsert: true,
            });

          if (uploadErr) console.error('Storage upload error:', uploadErr.message);
          if (!uploadErr && uploadResult) {
            const { data: pubData } = supabaseAdmin.storage
              .from('payment-proofs')
              .getPublicUrl(uploadResult.path);
            screenshotUrl = pubData.publicUrl;
          }
        }
      }
    } catch (storageErr) {
      console.error('Payment proof upload failed:', storageErr);
      return { success: false, error: 'The payment proof could not be uploaded. Please try again.' };
    }

    if (!screenshotUrl) {
      return {
        success: false,
        error: 'The payment proof could not be uploaded. Please attach a JPG, PNG, WebP or PDF receipt (max 5MB) and try again.',
      };
    }


    const { error } = await supabaseAdmin.from('payments').insert({
      squad_id: session.squadId,
      amount_submitted: amountSubmitted,
      amount_expected: totalAmount,
      utr_number: utrClean,
      screenshot_url: screenshotUrl,
      status: 'SUBMITTED',
    });

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: `UTR Reference '${utrClean}' has already been used for an earlier payment submission. Each payment must have its own UTR.` };
      }
      return { success: false, error: error.message };
    }

    // Freeze BOTH divisions of the college: one payment covers Men + Women
    const { error: lockErr } = await supabaseAdmin
      .from('squads')
      .update({
        roster_locked: true,
        payment_status: 'SUBMITTED',
        updated_at: new Date().toISOString(),
      })
      .in('id', squadIds);

    if (lockErr) {
      console.error('submitPaymentAction roster lock error:', lockErr);
      return { success: false, error: `Payment recorded, but the roster could not be locked: ${lockErr.message}` };
    }

    // Paying closes any late-entry window the admin opened (best effort: column from migration 0017)
    await supabaseAdmin.from('squads').update({ late_entry_open: false }).in('id', squadIds).eq('late_entry_open', true);

    revalidatePath('/squad/payment');
    revalidatePath('/squad/dashboard');
    revalidatePath('/squad/athletes');
    revalidatePath('/finance');

    return { success: true };
  } catch (err: any) {
    console.error('submitPaymentAction error:', err);
    return { success: false, error: err?.message || 'Failed to submit payment.' };
  }
}

/**
 * Lists all payment submissions for the Finance Verification Desk.
 */
export async function listPaymentsForFinanceAction() {
  await requireStaff(['meet_admin', 'finance_desk']);

  // Paged: a single request returns at most 1,000 rows
  const payments = await fetchAllRows<any>(() =>
    supabaseAdmin
    .from('payments')
    .select(`
      id,
      amount_submitted,
      amount_expected,
      utr_number,
      screenshot_url,
      status,
      rejection_reason,
      created_at,
      verified_at,
      squads (
        id,
        squad_code,
        gender,
        ped_name,
        ped_phone,
        colleges (
          name,
          code
        )
      )
    `)
    .order('created_at', { ascending: false })
    .order('id')
  );

  return payments;
}

/**
 * Approves or rejects a payment submission at the Finance Desk.
 */
export async function verifyPaymentAction(
  paymentId: string,
  newStatus: 'VERIFIED' | 'REJECTED',
  reason?: string,
  amountReceived?: number
): Promise<{ success: boolean; error?: string }> {
  const staffSession = await requireStaff(['meet_admin', 'finance_desk']);

  const result = await reviewPayment(paymentId, newStatus, reason, staffSession.entityId, amountReceived);
  if (!result.success) return result;

  revalidatePath('/finance');
  revalidatePath('/squad/payment');
  revalidatePath('/squad/dashboard');
  return { success: true };
}
