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
  Division: string;
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
      Division: sq.gender === 'men' ? 'Men' : sq.gender === 'women' ? 'Women' : '',
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

export function exportFileStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
