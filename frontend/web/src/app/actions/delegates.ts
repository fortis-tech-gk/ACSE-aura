'use server';

/**
 * Passes for everyone who is not an athlete (migration 0057):
 *   FACULTY (ACS host faculty) · PED (participating colleges) · VOLUNTEER · OFFICIAL
 *
 * Passes are free and need no check-in; the QR is used only at food and, when asked for,
 * the hostel. A college PED manages their own college's PED rows from the Contingent Portal
 * (/squad/faculty); the meet office manages everyone from /admin/officials, including blank
 * numbered batches of ACS faculty and volunteer passes that are filled in by hand.
 * Both intake paths share the same Excel workbook — see lib/delegate-workbook.ts.
 */

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireSquad } from '@/lib/auth-guard';
import { supabaseAdmin } from '@/lib/supabase';
import { canEditRoster } from '@/lib/roster-window';
import { fetchAllRows } from '@/lib/db-fetch-all';
import { tryMakeDelegateQrToken } from '@/lib/delegate-qr';
import {
  BLANK_PASS_CATEGORIES,
  PED_DESIGNATION,
  cleanEmail,
  cleanName,
  isValidDelegatePhone,
  normalizeDelegatePhone,
  parseBloodGroup,
  parseGender,
  parseScope,
  type DelegateCategory,
  type DelegateRow,
  type SquadScope,
} from '@/lib/delegates';
import {
  looksLikeXlsx,
  parseDelegateWorkbook,
  type ParsedDelegate,
  type RejectedRow,
} from '@/lib/delegate-workbook';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_BLANK_BATCH = 500;
const CATEGORIES: DelegateCategory[] = ['FACULTY', 'PED', 'VOLUNTEER', 'OFFICIAL'];
const SELECT =
  'id, category, college_id, pass_no, full_name, designation, department, organisation, gender, phone, email, blood_group, squad_scope, meals_included, accommodation_required, accreditation_status, remarks, created_at, colleges ( name, code, region )';

export interface DelegateActionResult {
  success: boolean;
  error?: string;
  message?: string;
}

export interface ImportResult extends DelegateActionResult {
  added?: number;
  updated?: number;
  rejected?: RejectedRow[];
  missingSheets?: string[];
  /** A college upload reads sheet 2 only (sheets 1 and 3 are the meet office's) */
  otherSheetsIgnored?: boolean;
}

/** A pass with its printed QR (null when ATHLETE_QR_SECRET is not set). */
export type DelegateWithQr = DelegateRow & { qr_token: string | null };

// -----------------------------------------------------------------------------
// Shared pieces
// -----------------------------------------------------------------------------

/**
 * PED entries follow the roster window: open while registration is open, or while the admin
 * has opened a late-entry window for the squad. Passes are free, so a verified payment does
 * NOT freeze them.
 */
async function squadMayEditDelegates(squadId: string): Promise<string | null> {
  const [{ data: meet }, { data: squad, error }] = await Promise.all([
    supabaseAdmin.from('meet_settings').select('registration_open').limit(1).maybeSingle(),
    supabaseAdmin.from('squads').select('*').eq('id', squadId).maybeSingle(),
  ]);
  if (error || !squad) return 'Unable to verify your squad. Please try again.';
  if (canEditRoster(meet?.registration_open !== false, squad)) return null;
  return 'Championship registrations are closed. Ask the meet office to add or change a PED pass.';
}

function withQr(rows: any[]): DelegateWithQr[] {
  return rows.map((d) => ({
    ...d,
    colleges: Array.isArray(d.colleges) ? d.colleges[0] ?? null : d.colleges ?? null,
    qr_token: tryMakeDelegateQrToken(d.id),
  }));
}

const ORDER: Record<string, number> = { FACULTY: 0, PED: 1, OFFICIAL: 2, VOLUNTEER: 3 };
function byTypeThenNumber(a: { category: string; pass_no: number }, b: { category: string; pass_no: number }) {
  return (ORDER[a.category] ?? 9) - (ORDER[b.category] ?? 9) || a.pass_no - b.pass_no;
}

/** A form, normalised the same way the Excel importer does. */
function readFormDelegate(formData: FormData, category: DelegateCategory) {
  return {
    category,
    full_name: cleanName(formData.get('fullName')) || null,
    designation: cleanName(formData.get('designation')).slice(0, 60),
    department: cleanName(formData.get('department')).slice(0, 60),
    organisation: cleanName(formData.get('organisation')).slice(0, 80),
    gender: parseGender(formData.get('gender')),
    phone: normalizeDelegatePhone(formData.get('phone')),
    email: cleanEmail(formData.get('email')) || null,
    blood_group: parseBloodGroup(formData.get('bloodGroup')),
    squad_scope: parseScope(formData.get('scope')),
    meals_included: formData.get('meals') !== 'no',
    accommodation_required: formData.get('accommodation') === 'yes',
    remarks: cleanName(formData.get('remarks')).slice(0, 200),
  };
}

function validateDelegate(d: { category: DelegateCategory; full_name: string | null; designation: string; phone: string }): string | null {
  const name = d.full_name || '';
  if (!name && !BLANK_PASS_CATEGORIES.includes(d.category)) return 'Enter the full name.';
  if (name && (name.length < 3 || name.length > 80)) return 'The name must be 3–80 characters.';
  if (name && !/[A-Za-z]/.test(name)) return 'The name must contain letters.';
  if (d.category === 'OFFICIAL' && !d.designation) return 'Choose a role.';
  if (d.phone && !isValidDelegatePhone(d.phone)) return 'Enter a valid 10-digit Indian mobile number, or leave it blank.';
  return null;
}

/** Default designation per pass type, when none was given. */
function defaultDesignation(category: DelegateCategory, given: string): string {
  if (given) return given;
  return category === 'PED' ? PED_DESIGNATION : category === 'FACULTY' ? 'ACS Faculty' : category === 'VOLUNTEER' ? 'Volunteer' : 'Technical Official';
}

/** "Already there" check, matching the database's unique indexes. Blank passes never match. */
async function findExisting(
  category: DelegateCategory,
  collegeId: string | null,
  fullName: string | null,
  phone: string
): Promise<{ id: string } | null> {
  const name = (fullName || '').trim().toUpperCase();
  if (!name) return null;
  let q = supabaseAdmin.from('delegates').select('id, full_name').eq('category', category);
  q = collegeId ? q.eq('college_id', collegeId) : q.is('college_id', null).eq('phone', phone);
  const { data } = await q;
  return (data || []).find((r: any) => String(r.full_name || '').trim().toUpperCase() === name) ?? null;
}

function dbError(err: { message?: string; code?: string } | null): string {
  const msg = String(err?.message || '');
  if (/may nominate at most/i.test(msg)) return msg.replace(/^.*?ERROR:\s*/i, '');
  if (err?.code === '23505' || /duplicate key/i.test(msg)) return 'This person already has a pass.';
  if (/delegate_pass_no_seq/i.test(msg)) return 'All pass numbers (90001–99999) are used up.';
  return msg || 'The database refused the change. Please try again.';
}

async function collegeCodeMap(): Promise<Map<string, string>> {
  const rows = await fetchAllRows<{ id: string; code: string }>(
    () => supabaseAdmin.from('colleges').select('id, code').order('id') as any
  );
  return new Map(rows.map((c) => [String(c.code).toUpperCase(), c.id]));
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

/** The logged-in squad's college: its PED passes (both squads share one list). */
export async function listSquadDelegatesAction(): Promise<{
  delegates: DelegateWithQr[];
  canEdit: boolean;
  blockReason: string | null;
}> {
  const session = await requireSquad();
  const [{ data }, blockReason] = await Promise.all([
    supabaseAdmin.from('delegates').select(SELECT).eq('college_id', session.collegeId).order('pass_no', { ascending: true }),
    squadMayEditDelegates(session.squadId),
  ]);
  return { delegates: withQr(data || []), canEdit: !blockReason, blockReason };
}

export interface AdminDelegateFilters {
  category?: DelegateCategory | 'ALL';
  college?: string;
  q?: string;
  /** "blank" = only passes with no name, "named" = only named ones */
  names?: 'blank' | 'named' | '';
}

/** Everyone with a pass, for the meet office. */
export async function listAllDelegatesAction(filters: AdminDelegateFilters = {}): Promise<DelegateWithQr[]> {
  await requireAdmin();
  const rows = await fetchAllRows<any>(() => {
    let q = supabaseAdmin.from('delegates').select(SELECT).order('id', { ascending: true });
    if (filters.category && filters.category !== 'ALL') q = q.eq('category', filters.category);
    if (filters.names === 'blank') q = q.is('full_name', null);
    if (filters.names === 'named') q = q.not('full_name', 'is', null);
    return q as any;
  });

  const code = filters.college?.trim().toUpperCase();
  const needle = filters.q?.trim().toLowerCase();
  const filtered = withQr(rows).filter((d) => {
    if (code && String(d.colleges?.code || '').toUpperCase() !== code) return false;
    if (!needle) return true;
    return [d.full_name, d.designation, d.organisation, d.phone, String(d.pass_no), d.colleges?.name, d.colleges?.code]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });
  return filtered.sort(byTypeThenNumber);
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
    const collegeId = r.category === 'PED' ? codeToId.get(r.collegeCode) ?? null : null;
    if (r.category === 'PED' && !collegeId) {
      rejected.push({ sheet: r.sheet, excelRow: r.excelRow, name: r.fullName, reason: `No college with code "${r.collegeCode}" is registered for the meet.` });
      continue;
    }

    const payload = {
      category: r.category,
      college_id: collegeId,
      full_name: r.fullName,
      designation: defaultDesignation(r.category, r.designation),
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
    const { error } = existing
      ? await supabaseAdmin.from('delegates').update(payload).eq('id', existing.id)
      : await supabaseAdmin.from('delegates').insert(payload);
    if (error) rejected.push({ sheet: r.sheet, excelRow: r.excelRow, name: r.fullName, reason: dbError(error) });
    else if (existing) updated++;
    else added++;
  }
  return { added, updated, rejected };
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

/** A PED uploads the filled workbook: sheet 2 (their own college's PEDs) is read. */
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
        error: 'No PED rows were found. Fill in the "2. PEDs" sheet of the template and upload it again.',
        missingSheets: parsed.missingSheets,
      };
    }

    const res = await applyParsedRows(parsed.rows, codeToId, `${session.squadCode || session.collegeCode} (PED)`);
    revalidatePath('/squad/faculty');
    return {
      success: true,
      added: res.added,
      updated: res.updated,
      rejected: [...parsed.rejected, ...res.rejected],
      missingSheets: parsed.missingSheets,
      otherSheetsIgnored: true,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'The sheet could not be read. Please try again.' };
  }
}

/** The meet office uploads any sheet of the workbook. */
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
// College PED: one at a time
// -----------------------------------------------------------------------------

export async function addSquadDelegateAction(formData: FormData): Promise<DelegateActionResult> {
  try {
    const session = await requireSquad();
    const block = await squadMayEditDelegates(session.squadId);
    if (block) return { success: false, error: block };

    const d = readFormDelegate(formData, 'PED');
    const bad = validateDelegate(d);
    if (bad) return { success: false, error: bad };

    if (await findExisting('PED', session.collegeId, d.full_name, d.phone)) {
      return { success: false, error: `${d.full_name} already has a PED pass for your college.` };
    }

    const { error } = await supabaseAdmin.from('delegates').insert({
      ...d,
      designation: defaultDesignation('PED', d.designation),
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

    const d = readFormDelegate(formData, 'PED');
    const bad = validateDelegate(d);
    if (bad) return { success: false, error: bad };

    const clash = await findExisting('PED', session.collegeId, d.full_name, d.phone);
    if (clash && clash.id !== id) return { success: false, error: `${d.full_name} already has a PED pass for your college.` };

    const { error } = await supabaseAdmin
      .from('delegates')
      .update({ ...d, designation: defaultDesignation('PED', d.designation), organisation: '' })
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
    if (!CATEGORIES.includes(category)) return { success: false, error: 'Pick a pass type.' };

    const d = readFormDelegate(formData, category);
    const bad = validateDelegate(d);
    if (bad) return { success: false, error: bad };

    let collegeId: string | null = null;
    if (category === 'PED') {
      const code = String(formData.get('collegeCode') || '').trim().toUpperCase();
      if (!code) return { success: false, error: 'A PED pass must name the college.' };
      collegeId = (await collegeCodeMap()).get(code) ?? null;
      if (!collegeId) return { success: false, error: `No college with code "${code}" is registered for the meet.` };
    }

    const clash = await findExisting(category, collegeId, d.full_name, d.phone);
    if (clash && clash.id !== id) return { success: false, error: `${d.full_name} already has a pass.` };

    const payload = {
      ...d,
      designation: defaultDesignation(category, d.designation),
      college_id: collegeId,
      added_by: session.displayName || 'Meet office',
    };
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

/**
 * A numbered batch of blank ACS-faculty or volunteer passes: each has its own QR and pass
 * number, and the holder's name is written on the card by hand.
 */
export async function generateBlankPassesAction(formData: FormData): Promise<DelegateActionResult> {
  try {
    const session = await requireAdmin();
    const category = String(formData.get('category') || '') as DelegateCategory;
    if (!BLANK_PASS_CATEGORIES.includes(category)) return { success: false, error: 'Blank passes are for ACS faculty and volunteers.' };
    const count = Math.floor(Number(formData.get('count')));
    if (!Number.isFinite(count) || count < 1 || count > MAX_BLANK_BATCH) {
      return { success: false, error: `Enter how many passes to make (1–${MAX_BLANK_BATCH}).` };
    }

    const rows = Array.from({ length: count }, () => ({
      category,
      college_id: null,
      full_name: null,
      designation: defaultDesignation(category, ''),
      meals_included: formData.get('meals') !== 'no',
      accommodation_required: formData.get('accommodation') === 'yes',
      added_by: `${session.displayName || 'Meet office'} (blank batch)`,
    }));
    const { data, error } = await supabaseAdmin.from('delegates').insert(rows).select('pass_no');
    if (error) return { success: false, error: dbError(error) };

    const nums = (data || []).map((r: any) => r.pass_no as number).sort((a, b) => a - b);
    revalidatePath('/admin/officials');
    return {
      success: true,
      message: `${nums.length} blank ${category === 'FACULTY' ? 'ACS faculty' : 'volunteer'} passes made: ${nums[0]}–${nums[nums.length - 1]}.`,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not make the passes. Please try again.' };
  }
}

/**
 * One PED pass per PED named in this year's registration (squads.ped_name). The same person
 * on both squads of a college gets one pass for both; anyone who already has a PED pass for
 * the college is left as it is.
 */
export async function createPedPassesFromRegistrationAction(): Promise<DelegateActionResult> {
  try {
    const session = await requireAdmin();
    const [squads, existing] = await Promise.all([
      fetchAllRows<{ college_id: string; gender: string; ped_name: string | null; ped_phone: string | null; ped_email: string | null }>(
        () => supabaseAdmin.from('squads').select('college_id, gender, ped_name, ped_phone, ped_email').order('id') as any
      ),
      fetchAllRows<{ college_id: string; full_name: string | null }>(
        () => supabaseAdmin.from('delegates').select('college_id, full_name').eq('category', 'PED').order('id') as any
      ),
    ]);

    const have = new Set(existing.map((e) => `${e.college_id}|${String(e.full_name || '').trim().toUpperCase()}`));
    const people = new Map<string, { college_id: string; name: string; phone: string; email: string; men: boolean; women: boolean }>();
    for (const s of squads) {
      const name = cleanName(s.ped_name);
      if (!name || name.length < 3) continue;
      const key = `${s.college_id}|${name.toUpperCase()}`;
      const p = people.get(key) || { college_id: s.college_id, name, phone: '', email: '', men: false, women: false };
      const phone = normalizeDelegatePhone(s.ped_phone);
      if (!p.phone && isValidDelegatePhone(phone)) p.phone = phone;
      if (!p.email) p.email = cleanEmail(s.ped_email);
      if (s.gender === 'men') p.men = true;
      else p.women = true;
      people.set(key, p);
    }

    const rows = [...people.entries()]
      .filter(([key]) => !have.has(key))
      .map(([, p]) => ({
        category: 'PED' as const,
        college_id: p.college_id,
        full_name: p.name,
        designation: PED_DESIGNATION,
        phone: p.phone,
        email: p.email || null,
        squad_scope: (p.men && p.women ? 'BOTH' : p.men ? 'MEN' : 'WOMEN') as SquadScope,
        meals_included: true,
        accommodation_required: false,
        added_by: `${session.displayName || 'Meet office'} (from registration)`,
      }));

    if (rows.length) {
      const { error } = await supabaseAdmin.from('delegates').insert(rows);
      if (error) return { success: false, error: dbError(error) };
    }
    revalidatePath('/admin/officials');
    return {
      success: true,
      message: rows.length
        ? `${rows.length} PED passes made from registration (${people.size - rows.length} already had one).`
        : 'Every PED named in registration already has a pass.',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not make the PED passes. Please try again.' };
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
