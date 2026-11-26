/**
 * Shared column set for the admin "Athletes Management" downloads (Excel and PDF),
 * so both formats always contain the same data.
 */
import { DB_CODE_TO_OFFICIAL_MAP } from '@/lib/championship-events';
import { normalizePaymentStatus } from '@/lib/payment-status';

export interface ExportRow {
  'Sl No': number;
  'Bib No': string;
  'Athlete Name (SSLC)': string;
  USN: string;
  Gender: string;
  Semester: string;
  'Blood Group': string;
  'Date of Birth': string;
  'Student Phone': string;
  'Aadhaar (last 4)': string;
  'College Code': string;
  'College Name': string;
  District: string;
  'Event 1': string;
  'Event 2': string;
  'Reserve Event': string;
  Relays: string;
  'Half Marathon': string;
  'PED Name': string;
  'PED Phone': string;
  'Payment Status': string;
  Accreditation: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function eventLabel(ev: any): string {
  const code = String(ev?.code || '').toUpperCase();
  const meta = DB_CODE_TO_OFFICIAL_MAP[code];
  return meta ? `[${meta.codeNum}] ${meta.officialName}` : ev?.name || code || 'Event';
}

const PAYMENT_LABEL: Record<string, string> = {
  VERIFIED: 'Verified',
  SUBMITTED: 'Pending verification',
  REJECTED: 'Rejected',
  DRAFT: 'Not paid',
};

export function buildExportRows(list: any[]): ExportRow[] {
  return list.map((a, index) => {
    const regs: any[] = a.registrations || [];
    const regular = regs.filter((r) => r.kind === 'regular').map((r) => eventLabel(r.events));
    const reserve = regs.filter((r) => r.kind === 'reserve').map((r) => eventLabel(r.events));
    const relays = regs.filter((r) => r.kind === 'relay').map((r) => eventLabel(r.events));
    const hm = regs.some((r) => r.kind === 'half_marathon');
    const sq = a.squads || {};
    const col = sq.colleges || {};
    const aadhaar = String(a.aadhaar_number || '');

    return {
      'Sl No': index + 1,
      'Bib No': a.bid_number ? String(a.bid_number) : 'Pending',
      'Athlete Name (SSLC)': a.sslc_name || '',
      USN: a.usn || '',
      Gender: sq.gender === 'men' ? 'Men' : sq.gender === 'women' ? 'Women' : '',
      Semester: a.semester ? String(a.semester) : '',
      'Blood Group': a.blood_group || '',
      'Date of Birth': formatDate(a.date_of_birth),
      'Student Phone': a.phone || '',
      'Aadhaar (last 4)': aadhaar ? `XXXX XXXX ${aadhaar.slice(-4)}` : '',
      'College Code': col.code || (sq.squad_code || '').split('-')[0] || '',
      'College Name': col.name || '',
      District: col.district || '',
      'Event 1': regular[0] || '',
      'Event 2': regular[1] || '',
      'Reserve Event': reserve.join('; '),
      Relays: relays.join('; '),
      'Half Marathon': hm ? 'Yes' : '',
      'PED Name': sq.ped_name || '',
      'PED Phone': sq.ped_phone || '',
      'Payment Status': PAYMENT_LABEL[normalizePaymentStatus(sq.payment_status)] || '',
      Accreditation: a.accreditation_status || 'REGISTERED',
    };
  });
}

/* ------------------------------------------------------------------------------------------
 * Event-wise layout: one block per event (and per Men / Women section), listing every athlete
 * entered in it — the format of the "ACS-AURA_Athletes_EventWise" sheet.
 * ---------------------------------------------------------------------------------------- */

export type EnteredAs = 'Event 1' | 'Event 2' | 'Reserve' | 'Relay' | 'Half Marathon';

export interface EventWiseRow {
  'Sl No': number;
  'Bib No': string;
  'Athlete Name': string;
  USN: string;
  Sem: string;
  'College Code': string;
  'College Name': string;
  District: string;
  'Student Phone': string;
  'Entered As': EnteredAs;
  'Payment Status': string;
}

export const EVENT_WISE_COLUMNS: (keyof EventWiseRow)[] = [
  'Sl No', 'Bib No', 'Athlete Name', 'USN', 'Sem', 'College Code', 'College Name', 'District', 'Student Phone', 'Entered As', 'Payment Status',
];

export interface EventGroup {
  key: string;
  /** "[1] 100 mtrs Run – Men" */
  title: string;
  entries: number;
  reserves: number;
  /** Regular / relay / Half Marathon entries (Sl No 1..n) */
  rows: EventWiseRow[];
  /** Reserves, listed in their own table (Sl No 1..n) */
  reserveRows: EventWiseRow[];
}

const ENTERED_ORDER: Record<EnteredAs, number> = { 'Event 1': 0, 'Event 2': 0, Relay: 0, 'Half Marathon': 0, Reserve: 1 };

/**
 * Groups athletes by event; each event has an entries table and a separate reserves table. `onlyEventId` keeps just that event (the page's event filter), so
 * choosing "100m Men" downloads only the 100m Men block. Order: official event code, Men then
 * Women; inside a block entries before reserves, then college A-Z and name A-Z.
 */
export function buildEventGroups(list: any[], onlyEventId?: string | null): EventGroup[] {
  const groups = new Map<string, { sortCode: number; sortName: string; section: number; title: string; items: { a: any; as: EnteredAs }[] }>();

  for (const a of list) {
    const sq = a.squads || {};
    const gender = sq.gender === 'women' ? 'Women' : 'Men';
    const regs: any[] = a.registrations || [];
    let regularNo = 0;
    for (const r of regs) {
      // Label first (Event 1 / Event 2 counts every regular entry), then apply the event filter
      const as: EnteredAs =
        r.kind === 'reserve' ? 'Reserve' : r.kind === 'relay' ? 'Relay' : r.kind === 'half_marathon' ? 'Half Marathon' : regularNo++ === 0 ? 'Event 1' : 'Event 2';
      if (onlyEventId && r.event_id !== onlyEventId) continue;
      const ev = r.events || {};
      const code = String(ev.code || '').toUpperCase();
      const meta = DB_CODE_TO_OFFICIAL_MAP[code];
      // Mixed relay is one event, listed per section from the athlete's own squad
      const section = meta?.section === 'Mixed' || !meta ? gender : meta.section;
      const key = `${code || ev.name}|${section}`;
      let g = groups.get(key);
      if (!g) {
        const name = meta?.officialName || ev.name || code || 'Event';
        g = {
          sortCode: meta?.codeNum ?? 99,
          sortName: name,
          section: section === 'Men' ? 0 : 1,
          title: `${meta ? `[${meta.codeNum}] ` : ''}${name} – ${section}`,
          items: [],
        };
        groups.set(key, g);
      }
      g.items.push({ a, as });
    }
  }

  return [...groups.entries()]
    .sort(([, x], [, y]) => x.sortCode - y.sortCode || x.section - y.section || x.sortName.localeCompare(y.sortName))
    .map(([key, g]) => {
      const items = g.items.sort(
        (x, y) =>
          ENTERED_ORDER[x.as] - ENTERED_ORDER[y.as] ||
          String(x.a.squads?.colleges?.name || '').localeCompare(String(y.a.squads?.colleges?.name || '')) ||
          String(x.a.sslc_name || '').localeCompare(String(y.a.sslc_name || ''))
      );
      const toRow = ({ a, as }: { a: any; as: EnteredAs }, i: number): EventWiseRow => {
        const sq = a.squads || {};
        const col = sq.colleges || {};
        return {
          'Sl No': i + 1,
          'Bib No': a.bid_number ? String(a.bid_number) : 'Pending',
          'Athlete Name': a.sslc_name || '',
          USN: a.usn || '',
          Sem: a.semester ? String(a.semester) : '',
          'College Code': col.code || (sq.squad_code || '').split('-')[0] || '',
          'College Name': col.name || '',
          District: col.district || '',
          'Student Phone': a.phone || '',
          'Entered As': as,
          'Payment Status': PAYMENT_LABEL[normalizePaymentStatus(sq.payment_status)] || '',
        };
      };
      const rows = items.filter((x) => x.as !== 'Reserve').map(toRow);
      const reserveRows = items.filter((x) => x.as === 'Reserve').map(toRow);
      return { key, title: g.title, entries: rows.length, reserves: reserveRows.length, rows, reserveRows };
    });
}

export function exportFileStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
