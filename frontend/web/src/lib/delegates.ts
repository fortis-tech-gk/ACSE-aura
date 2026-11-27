/**
 * Faculty, PEDs and meet officials — the non-athlete people who need an accreditation
 * pass and a meal coupon (migration 0057, table `delegates`).
 *
 * Pure helpers and vocabulary shared by the Excel template, the importer, the squad
 * portal, the admin desk and the printed pass. No server imports, so client components
 * can use it too.
 */

export type DelegateCategory = 'FACULTY' | 'PED' | 'VOLUNTEER' | 'OFFICIAL';
export type SquadScope = 'MEN' | 'WOMEN' | 'BOTH';
export type DelegateGender = 'MALE' | 'FEMALE' | 'OTHER';
export type DelegateStatus = 'REGISTERED' | 'ACCREDITED' | 'WITHDRAWN';

export interface DelegateRow {
  id: string;
  category: DelegateCategory;
  college_id: string | null;
  pass_no: number;
  /** null on a blank pass (name written by hand) */
  full_name: string | null;
  designation: string;
  department: string;
  organisation: string;
  gender: DelegateGender | null;
  phone: string;
  email: string | null;
  blood_group: string;
  squad_scope: SquadScope;
  meals_included: boolean;
  accommodation_required: boolean;
  accreditation_status: DelegateStatus;
  remarks: string;
  created_at?: string;
  colleges?: { name?: string | null; code?: string | null; region?: string | null } | null;
}

export const CATEGORY_LABEL: Record<DelegateCategory, string> = {
  FACULTY: 'ACS Faculty',
  PED: 'Physical Education Director',
  VOLUNTEER: 'Volunteer',
  OFFICIAL: 'Technical Official',
};

/** The coloured bar across each pass: what the food counter reads from a distance. */
export const PASS_TYPE: Record<DelegateCategory, { word: string; band: string; theme: string }> = {
  FACULTY: { word: 'ACS FACULTY', band: 'HOST FACULTY', theme: 'faculty' },
  PED: { word: 'P.E.D.', band: 'PHYSICAL EDUCATION DIRECTOR', theme: 'ped' },
  VOLUNTEER: { word: 'VOLUNTEER', band: 'MEET VOLUNTEER', theme: 'vol' },
  OFFICIAL: { word: 'TECHNICAL OFFICIAL', band: 'TECHNICAL OFFICIAL', theme: 'off' },
};

/** Passes that may be printed with no name, in numbered batches. */
export const BLANK_PASS_CATEGORIES: DelegateCategory[] = ['FACULTY', 'VOLUNTEER'];

/** A name to show on screens for a pass, blank or not. */
export function passDisplayName(d: { full_name?: string | null; pass_no: number; category: DelegateCategory }): string {
  return d.full_name?.trim() || `Blank ${CATEGORY_LABEL[d.category]} pass ${d.pass_no}`;
}

/** Designations for host-college (Dr. ACS) faculty and staff on duty at the meet (sheet 1). */
export const FACULTY_DESIGNATIONS = [
  'Principal',
  'Professor & Head',
  'Professor',
  'Associate Professor',
  'Assistant Professor',
  'Physical Education Director',
  'Technical Staff',
  'Administrative Staff',
  'Other',
] as const;

/** Roles for referees and technical officials (sheet 3). "Volunteer" there makes a volunteer pass. */
export const OFFICIAL_ROLES = [
  'Track Referee',
  'Field Referee',
  'Technical Official',
  'Jury of Appeal',
  'Starter',
  'Track Judge',
  'Field Judge',
  'Call Room Official',
  'Photo Finish Operator',
  'Announcer',
  'Marshal',
  'Medical Team',
  'Media',
  'Transport',
  'Guest of Honour',
  'Volunteer',
  'Other',
] as const;

export const PED_DESIGNATION = 'Physical Education Director';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'] as const;

export const SQUAD_SCOPES: SquadScope[] = ['MEN', 'WOMEN', 'BOTH'];

export const SCOPE_LABEL: Record<SquadScope, string> = {
  MEN: "Men's squad",
  WOMEN: "Women's squad",
  BOTH: 'Whole contingent',
};

/** "90001" → "90001"; the pass number printed on the card and typeable at a counter. */
export function formatPassNo(n: number | null | undefined): string {
  return n == null ? '—' : String(n);
}

/** Indian 10-digit mobile number (starts 6–9). */
const PHONE_RE = /^[6-9]\d{9}$/;

/** Strips spaces, dashes and a leading +91 / 91 / 0 so '+91 98765-43210' → '9876543210'. */
export function normalizeDelegatePhone(raw: unknown): string {
  let v = String(raw ?? '').replace(/[\s()-]/g, '');
  if (v.startsWith('+91')) v = v.slice(3);
  else if (v.length === 12 && v.startsWith('91')) v = v.slice(2);
  else if (v.length === 11 && v.startsWith('0')) v = v.slice(1);
  return v;
}

export function isValidDelegatePhone(v: string): boolean {
  return PHONE_RE.test(v);
}

/** Collapses inner whitespace and trims; keeps the PED's own capitalisation. */
export function cleanName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** "yes" / "y" / "true" / "1" / "✓" → true; "no" / blank → false. */
export function parseYesNo(raw: unknown, fallback: boolean): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (['yes', 'y', 'true', '1', 'required', '✓', 'tick'].includes(v)) return true;
  if (['no', 'n', 'false', '0', 'not required', '-'].includes(v)) return false;
  return fallback;
}

export function parseGender(raw: unknown): DelegateGender | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (['m', 'male', 'man', 'sri', 'mr'].includes(v)) return 'MALE';
  if (['f', 'female', 'woman', 'smt', 'ms', 'mrs'].includes(v)) return 'FEMALE';
  return 'OTHER';
}

export function parseScope(raw: unknown): SquadScope {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v.startsWith('men') || v === 'm') return 'MEN';
  if (v.startsWith('women') || v.startsWith('girl') || v === 'w' || v === 'f') return 'WOMEN';
  return 'BOTH';
}

export function parseBloodGroup(raw: unknown): string {
  const v = String(raw ?? '').replace(/\s+/g, '').toUpperCase().replace('POSITIVE', '+').replace('NEGATIVE', '-');
  return (BLOOD_GROUPS as readonly string[]).includes(v) ? v : '';
}

/** Loose e-mail check — a wrong address must not block a pass. */
export function cleanEmail(raw: unknown): string {
  const v = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : '';
}

/** Rows look empty in Excel long after the typist stopped: ignore them silently. */
export function isBlankRow(values: unknown[]): boolean {
  return values.every((v) => v == null || String(v).trim() === '');
}
