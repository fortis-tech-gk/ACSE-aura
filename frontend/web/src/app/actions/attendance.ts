'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRegistrationDesk } from '@/lib/auth-guard';
import { normalizePaymentStatus, type SquadPaymentStatus } from '@/lib/payment-status';
import { fetchCollegeParticipation } from '@/lib/college-participation';

export interface DeskSquad {
  id: string;
  gender: 'men' | 'women';
  squad_code: string;
  ped_name: string;
  ped_phone: string;
  payment_status: SquadPaymentStatus;
  athlete_count: number;
}

export interface DeskCollege {
  id: string;
  name: string;
  code: string;
  district: string | null;
  attendance_marked_at: string | null;
  attendance_marked_by: string | null;
  /** Athletes who reported at a roll call / call room at least once (college_participation, migration 0054) */
  competed_men: number;
  competed_women: number;
  squads: DeskSquad[];
}

const MIGRATION_ERROR =
  'College check-in needs database migration 0054 (supabase/migrations/0054_college_checkin.sql). Apply it, then try again.';

function isMissingCheckIn(message: string | undefined) {
  return Boolean(message && /(check_in_college|college_participation)/.test(message));
}

/**
 * All colleges with their two squads, registered athlete counts, check-in state and how many
 * athletes actually competed, for the Arrivals board.
 * `migrationApplied` is false until migration 0054 adds college check-in.
 */
export async function listCollegesForDeskAction(): Promise<{ colleges: DeskCollege[]; migrationApplied: boolean }> {
  await requireRegistrationDesk();

  const [{ data, error }, participation] = await Promise.all([
    supabaseAdmin
    .from('colleges')
    .select(`
      *,
      squads (
        id,
        gender,
        squad_code,
        ped_name,
        ped_phone,
        payment_status,
        profiles (count)
      )
    `)
    .order('name', { ascending: true }),
    fetchCollegeParticipation(),
  ]);

  if (error) throw new Error(error.message);
  const rows = data || [];
  const migrationApplied = participation.available;

  const colleges: DeskCollege[] = rows.map((c: any) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    district: c.district ?? null,
    attendance_marked_at: c.attendance_marked_at ?? null,
    attendance_marked_by: c.attendance_marked_by ?? null,
    competed_men: participation.byCollege.get(c.id)?.competed_men ?? 0,
    competed_women: participation.byCollege.get(c.id)?.competed_women ?? 0,
    squads: (c.squads || []).map((s: any) => ({
      id: s.id,
      gender: s.gender,
      squad_code: s.squad_code,
      ped_name: s.ped_name || '',
      ped_phone: s.ped_phone || '',
      payment_status: normalizePaymentStatus(s.payment_status),
      athlete_count: Array.isArray(s.profiles) ? Number(s.profiles[0]?.count || 0) : 0,
    })),
  }));

  return { colleges, migrationApplied };
}

async function writeAudit(action: string, details: Record<string, unknown>, performedBy: string) {
  try {
    const { error } = await supabaseAdmin.from('admin_audit_logs').insert({ action, details, performed_by: performedBy });
    if (error) console.warn('Audit log not written:', error.message);
  } catch (err) {
    console.warn('Audit logging notice (non-fatal):', err);
  }
}

function revalidateAttendance() {
  revalidatePath('/registration-desk');
  revalidatePath('/squad/certificate');
  revalidatePath('/squad/dashboard');
}

/**
 * Website fallback for the accreditation desk (normally the Officials app scans one athlete's QR):
 * checks in the whole college and accredits every athlete of its fee-verified squads.
 * Unlocks the college's Attendance Certificate.
 */
export async function checkInCollegeAction(
  collegeId: string
): Promise<{ success: boolean; error?: string; markedAt?: string; markedBy?: string; newlyAccredited?: number }> {
  const session = await requireRegistrationDesk();
  const markedBy = session.displayName || 'Registration Desk';

  const { data, error } = await supabaseAdmin.rpc('check_in_college', { p_college_id: collegeId, p_marked_by: markedBy });
  if (error) return { success: false, error: isMissingCheckIn(error.message) ? MIGRATION_ERROR : error.message };

  const r: any = data || {};
  const { data: col } = await supabaseAdmin
    .from('colleges')
    .select('attendance_marked_at, attendance_marked_by')
    .eq('id', collegeId)
    .maybeSingle();

  await writeAudit(
    'COLLEGE_CHECKED_IN',
    { collegeId, collegeCode: r.college_code, newlyAccredited: r.newly_accredited, source: 'website' },
    markedBy
  );
  revalidateAttendance();
  return {
    success: true,
    markedAt: col?.attendance_marked_at || new Date().toISOString(),
    markedBy: col?.attendance_marked_by || markedBy,
    newlyAccredited: Number(r.newly_accredited || 0),
  };
}
