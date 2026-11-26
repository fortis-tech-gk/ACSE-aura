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
import { DIVISION_FILTER_OPTIONS, compareText, divisionLabel } from '@/lib/college-regions';

export interface AthleteFilters {
  /** name / USN / college name or code (substring), or an exact bib number */
  q?: string;
  /** college code */
  college?: string;
  /** VTU division (Bengaluru, Belagavi, Kalaburagi, Mysuru or Unassigned) */
  division?: string;
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
    division: DIVISION_FILTER_OPTIONS.includes(v('division') || '') ? v('division') : undefined,
    gender: v('gender') === 'men' || v('gender') === 'women' ? v('gender') : undefined,
    status: ['VERIFIED', 'SUBMITTED', 'REJECTED', 'DRAFT'].includes(v('status') || '') ? v('status') : undefined,
    event: v('event'),
    bibOnly: v('bib') === '1',
  };
}

export const hasAnyFilter = (f: AthleteFilters) =>
  Boolean(f.q || f.college || f.division || f.gender || f.status || f.event || f.bibOnly);

/** Codes of the colleges in a VTU division (stored region, else the built-in map) */
async function collegeCodesInDivision(division: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('colleges').select('code, region');
  return ((data || []) as { code: string; region: string | null }[])
    .filter((c) => c.code && divisionLabel(c.code, c.region) === division)
    .map((c) => c.code);
}

/** Colleges A-Z, then athletes A-Z within a college (the order every admin list uses) */
export function compareAthletesByCollege(a: any, b: any): number {
  const ca = a?.squads?.colleges?.name || a?.squads?.squad_code || '';
  const cb = b?.squads?.colleges?.name || b?.squads?.squad_code || '';
  return compareText(ca, cb) || compareText(a?.sslc_name, b?.sslc_name) || String(a?.id || '').localeCompare(String(b?.id || ''));
}

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
async function buildQuery(f: AthleteFilters, extraSelect: string, count: boolean, baseColumns = PROFILE_COLUMNS) {
  const q = f.q ? clean(f.q) : '';
  const [collegeSquads, divisionCodes] = await Promise.all([
    q ? squadIdsForCollegeText(q) : Promise.resolve([] as string[]),
    f.division ? collegeCodesInDivision(f.division) : Promise.resolve(null),
  ]);

  const select = [baseColumns, squadEmbed(Boolean(f.college || f.division)), extraSelect, f.event ? 'evf:registrations!inner(event_id)' : '']
    .filter(Boolean)
    .join(', ');

  return () => {
    let query = supabaseAdmin.from('profiles').select(select, count ? { count: 'exact' } : undefined);
    if (f.college) query = query.eq('squads.colleges.code', f.college);
    // A division with no colleges matches nothing (the placeholder code never exists)
    if (divisionCodes) query = query.in('squads.colleges.code', divisionCodes.length ? divisionCodes : ['__none__']);
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

/**
 * One page of athletes (colleges A-Z, athletes A-Z within a college) and the number that match.
 * The database cannot order profiles by their college's name, so the matching ids are read
 * first (light rows), sorted here, and then only the page's athletes are read in full.
 */
export async function searchAthletesPage(f: AthleteFilters, page: number, pageSize = ATHLETES_PAGE_SIZE) {
  const makeKeys = await buildQuery(f, '', false, 'id, sslc_name');
  const keys = (await fetchAllRows<any>(() => makeKeys().order('id'))).sort(compareAthletesByCollege);
  const from = Math.max(0, page - 1) * pageSize;
  const ids = keys.slice(from, from + pageSize).map((k) => k.id as string);
  if (!ids.length) return { rows: [] as any[], total: keys.length };

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select([PROFILE_COLUMNS, squadEmbed(false), REG_EMBED].join(', '))
    .in('id', ids);
  if (error) throw new Error(error.message);
  const pos = new Map(ids.map((id, i) => [id, i]));
  const rows = ((data || []) as any[]).sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  return { rows, total: keys.length };
}

/** Every athlete that matches (paged past the 1,000-row cap), colleges A-Z then names A-Z — exports and ID card printing. */
export async function searchAllAthletes(f: AthleteFilters, extraColumns = ''): Promise<any[]> {
  const make = await buildQuery(f, [REG_EMBED, extraColumns].filter(Boolean).join(', '), false);
  const rows = await fetchAllRows<any>(() => make().order('id'));
  return tidy(rows).sort(compareAthletesByCollege);
}

/** Filter choices: every college and event (small tables) and the whole-meet athlete count */
export async function athleteFilterOptions() {
  const [{ data: colleges }, { data: events }, { count }] = await Promise.all([
    supabaseAdmin.from('colleges').select('code, name, region'),
    supabaseAdmin.from('events').select('id, name, code').order('name'),
    supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
  ]);
  return {
    // A-Z by name, each tagged with its VTU division (for the division filter)
    colleges: ((colleges || []) as any[])
      .filter((c) => c.code)
      .map((c) => ({ code: c.code as string, name: c.name as string, division: divisionLabel(c.code, c.region) }))
      .sort((a, b) => compareText(a.name, b.name)),
    events: (events || []) as { id: string; name: string; code: string }[],
    totalAthletes: count || 0,
  };
}
