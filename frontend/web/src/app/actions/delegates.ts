'use server';

/**
 * Faculty, PED and meet-official passes (migration 0057).
 *
 * A college PED works on their own college's rows from the Contingent Portal
 * (/squad/faculty); the meet office works on everyone from /admin/officials.
 * Both intake paths share the same Excel workbook — see lib/delegate-workbook.ts.
 */

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireSquad } from '@/lib/auth-guard';
import { supabaseAdmin } from '@/lib/supabase';
import { canEditRoster } from '@/lib/roster-window';
import { fetchAllRows } from '@/lib/db-fetch-all';
import { tryMakeDelegateQrToken } from '@/lib/delegate-qr';
import {
  cleanEmail,
  cleanName,
  isValidDelegatePhone,
  normalizeDelegatePhone,
  parseBloodGroup,
  parseGender,
  parseScope,
  type DelegateCategory,
  type DelegateRow,
} from '@/lib/delegates';
import {
  looksLikeXlsx,
  parseDelegateWorkbook,
  type ParsedDelegate,
  type RejectedRow,
} from '@/lib/delegate-workbook';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const SELECT =
  'id, category, college_id, pass_no, full_name, designation, department, organisation, gender, phone, email, blood_group, squad_scope, meals_included, accommodation_required, accreditation_status, remarks, created_at';

export interface DelegateActionResult {
  success: boolean;
  error?: string;
}

export interface ImportResult extends DelegateActionResult {
  added?: number;
  updated?: number;
  rejected?: RejectedRow[];
  missingSheets?: string[];
  /** Sheet 3 rows a college tried to upload (ignored, with a note) */
  officialsIgnored?: boolean;
}

/** A delegate with its printed pass QR (null when ATHLETE_QR_SECRET is not set). */
export type DelegateWithQr = DelegateRow & { qr_token: string | null };

// -----------------------------------------------------------------------------
// Shared pieces
// -----------------------------------------------------------------------------

/**
 * Faculty entries follow the roster window: open while registration is open, or while the
 * admin has opened a late-entry window for the squad. They carry no fee, so a verified
 * payment does NOT freeze them (unlike athlete events).
 */
async function squadMayEditDelegates(squadId: string): Promise<string | null> {
  const [{ data: meet }, { data: squad, error }] = await Promise.all([
    supabaseAdmin.from('meet_settings').select('registration_open').limit(1).maybeSingle(),
    supabaseAdmin.from('squads').select('*').eq('id', squadId).maybeSingle(),
  ]);
  if (error || !squad) return 'Unable to verify your squad. Please try again.';
  if (canEditRoster(meet?.registration_open !== false, squad)) return null;
  return 'Championship registrations are closed. Ask the VTU Directorate / meet office to add or change a faculty pass.';
}

function withQr(rows: DelegateRow[]): DelegateWithQr[] {
  return rows.map((d) => ({ ...d, qr_token: tryMakeDelegateQrToken(d.id) }));
}

/** Rows typed into a form, normalised the same way the Excel importer does. */
function readFormDelegate(formData: FormData, category: DelegateCategory) {
  const fullName = cleanName(formData.get('fullName'));
  const phone = normalizeDelegatePhone(formData.get('phone'));
  return {
    category,
    full_name: fullName,
    designation: cleanName(formData.get('designation')).slice(0, 60),
    department: cleanName(formData.get('department')).slice(0, 60),
    organisation: cleanName(formData.get('organisation')).slice(0, 80),
    gender: parseGender(formData.get('gender')),
    phone,
    email: cleanEmail(formData.get('email')) || null,
    blood_group: parseBloodGroup(formData.get('bloodGroup')),
    squad_scope: parseScope(formData.get('scope')),
    meals_included: formData.get('meals') !== 'no',
    accommodation_required: formData.get('accommodation') === 'yes',
    remarks: cleanName(formData.get('remarks')).slice(0, 200),
  };
}

function validateDelegate(d: { full_name: string; designation: string; phone: string }): string | null {
  if (d.full_name.length < 3 || d.full_name.length > 80) return 'Enter the full name (3–80 characters).';
  if (!/[A-Za-z]/.test(d.full_name)) return 'The name must contain letters.';
  if (!d.designation) return 'Choose a designation / role.';
  if (d.phone && !isValidDelegatePhone(d.phone)) return 'Enter a valid 10-digit Indian mobile number, or leave it blank.';
  return null;
}

/** "already there" check, matching the database's unique indexes. */
async function findExisting(
  category: DelegateCategory,
  collegeId: string | null,
  fullName: string,
  phone: string
): Promise<{ id: string } | null> {
  const name = fullName.trim().toUpperCase();
  if (collegeId) {
    const { data } = await supabaseAdmin
      .from('delegates')
      .select('id, full_name')
      .eq('college_id', collegeId)
      .eq('category', category);
    return (data || []).find((r: any) => String(r.full_name).trim().toUpperCase() === name) ?? null;
  }
  const { data } = await supabaseAdmin
    .from('delegates')
    .select('id, full_name, phone')
    .is('college_id', null)
    .eq('phone', phone);
  return (data || []).find((r: any) => String(r.full_name).trim().toUpperCase() === name) ?? null;
}

function dbError(err: { message?: string; code?: string } | null): string {
  const msg = String(err?.message || '');
  if (/may nominate at most/i.test(msg)) return msg.replace(/^.*?ERROR:\s*/i, '');
  if (err?.code === '23505' || /duplicate key/i.test(msg)) return 'This person is already on the list.';
  return msg || 'The database refused the change. Please try again.';
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

/** The logged-in squad's college: faculty and PEDs (both squads share one list). */
export async function listSquadDelegatesAction(): Promise<{
  delegates: DelegateWithQr[];
  canEdit: boolean;
  blockReason: string | null;
}> {
  const session = await requireSquad();
  const [{ data }, blockReason] = await Promise.all([
    supabaseAdmin
      .from('delegates')
      .select(SELECT)
      .eq('college_id', session.collegeId)
      .order('category', { ascending: true })
      .order('pass_no', { ascending: true }),
    squadMayEditDelegates(session.squadId),
  ]);
  return { delegates: withQr((data || []) as DelegateRow[]), canEdit: !blockReason, blockReason };
}

export interface AdminDelegateFilters {
  category?: DelegateCategory | 'ALL';
  college?: string;
  q?: string;
}

/** Everyone with a pass, for the meet office. */
export async function listAllDelegatesAction(filters: AdminDelegateFilters = {}): Promise<DelegateWithQr[]> {
  await requireAdmin();
  const rows = await fetchAllRows<any>(() => {
    let q = supabaseAdmin
      .from('delegates')
      .select(`${SELECT}, colleges ( name, code )`)
      .order('id', { ascending: true });
    if (filters.category && filters.category !== 'ALL') q = q.eq('category', filters.category);
    return q as any;
  });

  const code = filters.college?.trim().toUpperCase();
  const needle = filters.q?.trim().toLowerCase();
  const filtered = rows.filter((d) => {
    if (code && String(d.colleges?.code || '').toUpperCase() !== code) return false;
    if (!needle) return true;
    return [d.full_name, d.designation, d.organisation, d.phone, String(d.pass_no), d.colleges?.name, d.colleges?.code]
      .filter(Boolean)
      .some((v: string) => String(v).toLowerCase().includes(needle));
  });
  const order: Record<string, number> = { PED: 0, FACULTY: 1, OFFICIAL: 2 };
  filtered.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9) || a.pass_no - b.pass_no);
  return withQr(filtered as DelegateRow[]);
}

// -----------------------------------------------------------------------------
// Excel import
// -----------------------------------------------------------------------------

async function applyParsedRows(
  rows: ParsedDelegate[],
  codeToId: Map<string, string>,
  addedBy: string
): Promise<{ added: number; updated: number; rejected: RejectedRow[] }> {
  let added = 0;
  let updated = 0;
  const rejected: RejectedRow[] = [];

  for (const r of rows) {
    const collegeId = r.category === 'OFFICIAL' ? null : codeToId.get(r.collegeCode) ?? null;
    if (r.category !== 'OFFICIAL' && !collegeId) {
      rejected.push({ sheet: r.sheet, excelRow: r.excelRow, name: r.fullName, reason: `No college with code "${r.collegeCode}" is registered for the meet.` });
      continue;
    }

    const payload = {
      category: r.category,
      college_id: collegeId,
      full_name: r.fullName,
      designation: r.designation,
      department: r.department,
      organisation: r.organisation,
      gender: r.gender,
      phone: r.phone,
      email: r.email || null,
      blood_group: r.bloodGroup,
      squad_scope: r.scope,
      meals_included: r.meals,
      accommodation_required: r.accommodation,
      remarks: r.remarks,
      added_by: addedBy,
    };

    const existing = await findExisting(r.category, collegeId, r.fullName, r.phone);
    if (existing) {
      const { error } = await supabaseAdmin.from('delegates').update(payload).eq('id', existing.id);
      if (error) rejected.push({ sheet: r.sheet, excelRow: r.excelRow, name: r.fullName, reason: dbError(error) });
      else updated++;
    } else {
      const { error } = await supabaseAdmin.from('delegates').insert(payload);
      if (error) rejected.push({ sheet: r.sheet, excelRow: r.excelRow, name: r.fullName, reason: dbError(error) });
      else added++;
    }
  }
  return { added, updated, rejected };
}

async function collegeCodeMap(): Promise<Map<string, string>> {
  const rows = await fetchAllRows<{ id: string; code: string }>(
    () => supabaseAdmin.from('colleges').select('id, code').order('id') as any
  );
  return new Map(rows.map((c) => [String(c.code).toUpperCase(), c.id]));
}

async function readUpload(formData: FormData): Promise<{ buf?: Buffer; error?: string }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose the filled Excel sheet to upload.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'The file is larger than 4 MB. Remove any images or extra sheets and try again.' };
  const buf = Buffer.from(await file.arrayBuffer());
  if (!looksLikeXlsx(buf)) {
    return { error: 'That is not an .xlsx workbook. Open the template in Excel / Google Sheets and save it as .xlsx (not .xls or .csv).' };
  }
  return { buf };
}

/** A PED uploads the filled workbook for their own college. */
export async function importSquadDelegatesAction(formData: FormData): Promise<ImportResult> {
  try {
    const session = await requireSquad();
    const block = await squadMayEditDelegates(session.squadId);
    if (block) return { success: false, error: block };

    const { buf, error } = await readUpload(formData);
    if (!buf) return { success: false, error };

    const codeToId = await collegeCodeMap();
    const parsed = await parseDelegateWorkbook(buf, {
      forcedCollegeCode: session.collegeCode,
      knownCollegeCodes: new Set(codeToId.keys()),
    });
    if (!parsed.rows.length && !parsed.rejected.length) {
      return {
        success: false,
        error: 'No faculty or PED rows were found in the sheet. Fill in the "1. Faculty" or "2. PEDs" sheet of the template and upload it again.',
        missingSheets: parsed.missingSheets,
      };
    }

    const res = await applyParsedRows(parsed.rows, codeToId, `${session.squadCode || session.collegeCode} (PED)`);
    revalidatePath('/squad/faculty');
    revalidatePath('/squad/dashboard');
    return {
      success: true,
      added: res.added,
      updated: res.updated,
      rejected: [...parsed.rejected, ...res.rejected],
      missingSheets: parsed.missingSheets,
      officialsIgnored: true,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'The sheet could not be read. Please try again.' };
  }
}

/** The meet office uploads any sheet of the workbook, for any college. */
export async function importAdminDelegatesAction(formData: FormData): Promise<ImportResult> {
  try {
    const session = await requireAdmin();
    const { buf, error } = await readUpload(formData);
    if (!buf) return { success: false, error };

    const codeToId = await collegeCodeMap();
    const parsed = await parseDelegateWorkbook(buf, { knownCollegeCodes: new Set(codeToId.keys()) });
    if (!parsed.rows.length && !parsed.rejected.length) {
      return { success: false, error: 'No rows were found in any of the three sheets.', missingSheets: parsed.missingSheets };
    }

    const res = await applyParsedRows(parsed.rows, codeToId, session.displayName || 'Meet office');
    revalidatePath('/admin/officials');
    return {
      success: true,
      added: res.added,
      updated: res.updated,
      rejected: [...parsed.rejected, ...res.rejected],
      missingSheets: parsed.missingSheets,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'The sheet could not be read. Please try again.' };
  }
}

// -----------------------------------------------------------------------------
// One person at a time
// -----------------------------------------------------------------------------

export async function addSquadDelegateAction(formData: FormData): Promise<DelegateActionResult> {
  try {
    const session = await requireSquad();
    const block = await squadMayEditDelegates(session.squadId);
    if (block) return { success: false, error: block };

    const category = formData.get('category') === 'PED' ? 'PED' : 'FACULTY';
    const d = readFormDelegate(formData, category);
    const bad = validateDelegate(d);
    if (bad) return { success: false, error: bad };

    if (await findExisting(category, session.collegeId, d.full_name, d.phone)) {
      return { success: false, error: `${d.full_name} is already on your college's list.` };
    }

    const { error } = await supabaseAdmin.from('delegates').insert({
      ...d,
      college_id: session.collegeId,
      organisation: '',
      added_by: `${session.squadCode || session.collegeCode} (PED)`,
    });
    if (error) return { success: false, error: dbError(error) };

    revalidatePath('/squad/faculty');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not save. Please try again.' };
  }
}

export async function updateSquadDelegateAction(formData: FormData): Promise<DelegateActionResult> {
  try {
    const session = await requireSquad();
    const block = await squadMayEditDelegates(session.squadId);
    if (block) return { success: false, error: block };

    const id = String(formData.get('id') || '');
    const { data: row } = await supabaseAdmin.from('delegates').select('id, college_id, category').eq('id', id).maybeSingle();
    if (!row || row.college_id !== session.collegeId) return { success: false, error: 'That pass does not belong to your college.' };

    const d = readFormDelegate(formData, row.category as DelegateCategory);
    const bad = validateDelegate(d);
    if (bad) return { success: false, error: bad };

    const clash = await findExisting(row.category as DelegateCategory, session.collegeId, d.full_name, d.phone);
    if (clash && clash.id !== id) return { success: false, error: `${d.full_name} is already on your college's list.` };

    const { error } = await supabaseAdmin
      .from('delegates')
      .update({ ...d, organisation: '' })
      .eq('id', id);
    if (error) return { success: false, error: dbError(error) };

    revalidatePath('/squad/faculty');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not save. Please try again.' };
  }
}

export async function deleteSquadDelegateAction(id: string): Promise<DelegateActionResult> {
  try {
    const session = await requireSquad();
    const block = await squadMayEditDelegates(session.squadId);
    if (block) return { success: false, error: block };

    const { data: row } = await supabaseAdmin.from('delegates').select('id, college_id').eq('id', id).maybeSingle();
    if (!row || row.college_id !== session.collegeId) return { success: false, error: 'That pass does not belong to your college.' };

    const { error } = await supabaseAdmin.from('delegates').delete().eq('id', id);
    if (error) return { success: false, error: dbError(error) };

    revalidatePath('/squad/faculty');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not remove. Please try again.' };
  }
}

// -----------------------------------------------------------------------------
// Meet office
// -----------------------------------------------------------------------------

export async function saveAdminDelegateAction(formData: FormData): Promise<DelegateActionResult> {
  try {
    const session = await requireAdmin();
    const id = String(formData.get('id') || '');
    const category = String(formData.get('category') || 'OFFICIAL') as DelegateCategory;
    if (!['FACULTY', 'PED', 'OFFICIAL'].includes(category)) return { success: false, error: 'Pick a category.' };

    const d = readFormDelegate(formData, category);
    const bad = validateDelegate(d);
    if (bad) return { success: false, error: bad };

    let collegeId: string | null = null;
    if (category !== 'OFFICIAL') {
      const code = String(formData.get('collegeCode') || '').trim().toUpperCase();
      if (!code) return { success: false, error: 'Faculty and PEDs must name a college.' };
      collegeId = (await collegeCodeMap()).get(code) ?? null;
      if (!collegeId) return { success: false, error: `No college with code "${code}" is registered for the meet.` };
    }

    const clash = await findExisting(category, collegeId, d.full_name, d.phone);
    if (clash && clash.id !== id) return { success: false, error: `${d.full_name} already has a pass.` };

    const payload = { ...d, college_id: collegeId, added_by: session.displayName || 'Meet office' };
    const { error } = id
      ? await supabaseAdmin.from('delegates').update(payload).eq('id', id)
      : await supabaseAdmin.from('delegates').insert(payload);
    if (error) return { success: false, error: dbError(error) };

    revalidatePath('/admin/officials');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not save. Please try again.' };
  }
}

/** Cancel a pass (keeps the row and its meal history) or bring it back. */
export async function setDelegateStatusAction(id: string, status: 'REGISTERED' | 'ACCREDITED' | 'WITHDRAWN'): Promise<DelegateActionResult> {
  try {
    await requireAdmin();
    const { error } = await supabaseAdmin.from('delegates').update({ accreditation_status: status }).eq('id', id);
    if (error) return { success: false, error: dbError(error) };
    revalidatePath('/admin/officials');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not change the pass. Please try again.' };
  }
}

export async function deleteAdminDelegateAction(id: string): Promise<DelegateActionResult> {
  try {
    await requireAdmin();
    const { error } = await supabaseAdmin.from('delegates').delete().eq('id', id);
    if (error) return { success: false, error: dbError(error) };
    revalidatePath('/admin/officials');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not remove. Please try again.' };
  }
}
