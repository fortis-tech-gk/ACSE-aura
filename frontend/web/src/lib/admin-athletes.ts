/**
 * Server-side athlete search for the admin Athletes and ID Cards pages.
 *
 * Those pages used to read EVERY athlete (profiles.* with squads and registrations, paged past
 * Supabase's 1,000-row cap), sign every photo and send it all to the browser, which then
 * filtered in memory. Now the filters run in the database and a page reads only what it shows.
 * Server-only (service-role client).
 */
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/db-fetch-all';

export interface AthleteFilters {
  /** name / USN / college name or code (substring), or an exact bib number */
  q?: string;
  /** college code */
  college?: string;
  gender?: 'men' | 'women' | string;
  /** normalized payment status: VERIFIED | SUBMITTED | REJECTED | DRAFT */
  status?: string;
  /** event id */
  event?: string;
  /** only athletes with a bib number */
  bibOnly?: boolean;
}

export const ATHLETES_PAGE_SIZE = 50;

/** Columns the athlete table, the ID card and the Excel/PDF export read */
const PROFILE_COLUMNS =
  'id, squad_id, sslc_name, usn, semester, blood_group, date_of_birth, phone, photo_url, bid_number, accreditation_status, created_at';

const REG_EMBED = 'registrations(id, kind, event_id, events(id, name, code, category))';

function squadEmbed(innerCollege: boolean) {
  return `squads!inner(id, gender, squad_code, payment_status, ped_name, ped_phone, colleges${innerCollege ? '!inner' : ''}(name, code, district))`;
}

/** Characters that would break a PostgREST or=(...) filter, or act as wildcards */
const clean = (s: string) => s.replace(/[,()*%\\:"']/g, ' ').trim();

export function parseAthleteFilters(sp: Record<string, string | string[] | undefined>): AthleteFilters {
  const v = (k: string) => {
    const x = sp[k];
    return (Array.isArray(x) ? x[0] : x)?.trim() || undefined;
  };
  return {
    q: v('q'),
    college: v('college'),
    gender: v('gender') === 'men' || v('gender') === 'women' ? v('gender') : undefined,
    status: ['VERIFIED', 'SUBMITTED', 'REJECTED', 'DRAFT'].includes(v('status') || '') ? v('status') : undefined,
    event: v('event'),
    bibOnly: v('bib') === '1',
  };
}

export const hasAnyFilter = (f: AthleteFilters) =>
  Boolean(f.q || f.college || f.gender || f.status || f.event || f.bibOnly);

/** Squads whose college name or code contains `q` (a few rows): lets the search match colleges */
async function squadIdsForCollegeText(q: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('squads')
    .select('id, colleges!inner(name, code)')
    .or(`name.ilike.*${q}*,code.ilike.*${q}*`, { referencedTable: 'colleges' })
    .limit(400);
  return (data || []).map((s: { id: string }) => s.id);
}

/**
 * A fresh query with every filter applied. `extraSelect` is added to the profile columns.
 * Returns null when the search can match nothing.
 */
async function buildQuery(f: AthleteFilters, extraSelect: string, count: boolean) {
  const q = f.q ? clean(f.q) : '';
  const collegeSquads = q ? await squadIdsForCollegeText(q) : [];

  const select = [PROFILE_COLUMNS, squadEmbed(Boolean(f.college)), extraSelect, f.event ? 'evf:registrations!inner(event_id)' : '']
    .filter(Boolean)
    .join(', ');

  return () => {
    let query = supabaseAdmin.from('profiles').select(select, count ? { count: 'exact' } : undefined);
    if (f.college) query = query.eq('squads.colleges.code', f.college);
    if (f.gender) query = query.eq('squads.gender', f.gender);
    if (f.status === 'DRAFT') query = query.not('squads.payment_status', 'in', '(SUBMITTED,VERIFIED,REJECTED)');
    else if (f.status) query = query.eq('squads.payment_status', f.status);
    if (f.event) query = query.eq('evf.event_id', f.event);
    if (f.bibOnly) query = query.not('bid_number', 'is', null);
    if (q) {
      const parts = [`sslc_name.ilike.*${q}*`, `usn.ilike.*${q}*`];
      if (/^\d{1,6}$/.test(q)) parts.push(`bid_number.eq.${Number(q)}`);
      if (collegeSquads.length) parts.push(`squad_id.in.(${collegeSquads.join(',')})`);
      query = query.or(parts.join(','));
    }
    return query;
  };
}

/** Drops the helper embed used only for the event filter */
function tidy<T extends Record<string, unknown>>(rows: T[]): T[] {
  for (const r of rows) delete r.evf;
  return rows;
}

/** One page of athletes (newest first) and the number that match. */
export async function searchAthletesPage(f: AthleteFilters, page: number, pageSize = ATHLETES_PAGE_SIZE) {
  const make = await buildQuery(f, REG_EMBED, true);
  const from = Math.max(0, page - 1) * pageSize;
  const { data, error, count } = await make()
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: tidy((data || []) as unknown as Record<string, unknown>[]) as any[], total: count || 0 };
}

/** Every athlete that matches (paged past the 1,000-row cap) — exports and ID card printing. */
export async function searchAllAthletes(f: AthleteFilters, extraColumns = ''): Promise<any[]> {
  const make = await buildQuery(f, [REG_EMBED, extraColumns].filter(Boolean).join(', '), false);
  const rows = await fetchAllRows<any>(() => make().order('created_at', { ascending: false }).order('id'));
  return tidy(rows);
}

/** Filter choices: every college and event (small tables) and the whole-meet athlete count */
export async function athleteFilterOptions() {
  const [{ data: colleges }, { data: events }, { count }] = await Promise.all([
    supabaseAdmin.from('colleges').select('code, name').order('code'),
    supabaseAdmin.from('events').select('id, name, code').order('name'),
    supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
  ]);
  return {
    colleges: (colleges || []).filter((c: any) => c.code) as { code: string; name: string }[],
    events: (events || []) as { id: string; name: string; code: string }[],
    totalAthletes: count || 0,
  };
}
