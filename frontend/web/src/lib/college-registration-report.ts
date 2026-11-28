/**
 * Registered / not-registered colleges workbook for the admin dashboard download.
 *
 * Same split as scripts/reports/college-registration-status.mjs: a college is REGISTERED when
 * at least one athlete of either squad is on the portal. Registered colleges carry the college
 * fee account (ONE PAYMENT PER COLLEGE: both squads added up, fees from calculateFeesForSquads,
 * amount paid = bank-confirmed amount of VERIFIED payments). Not-registered colleges carry the
 * contacts and a blank "Remarks / Called" column for the calling desk.
 *
 * Server only (reads with the service-role client). Contacts come from the database only; the
 * printed report also falls back to the 2025-26 sheets kept outside the repository.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/db-fetch-all';
import { calculateFeesForSquads } from '@/lib/payments';
import { creditedAmount, normalizePaymentStatus } from '@/lib/payment-status';
import { VTU_DIVISIONS, divisionLabel, compareText } from '@/lib/college-regions';
import type { Borders, Worksheet } from 'exceljs';

export type CollegeListKind = 'registered' | 'not-registered';

interface PedContact {
  name: string;
  phone: string;
  email: string;
}

export interface CollegeReportRow {
  division: string;
  code: string;
  name: string;
  district: string;
  pedMen: PedContact;
  pedWomen: PedContact;
  principalName: string;
  principalPhone: string;
  principalEmail: string;
  menAthletes: number;
  womenAthletes: number;
  totalAmount: number;
  paid: number;
  pending: number;
  balance: number;
  paymentStatus: string;
}

const s = (v: unknown) => String(v ?? '').trim();
const emptyPed = (): PedContact => ({ name: '', phone: '', email: '' });

/** Every college, split into registered and not registered, sorted by division then name. */
export async function loadCollegeRegistrationRows(): Promise<{
  registered: CollegeReportRow[];
  notRegistered: CollegeReportRow[];
}> {
  const [colleges, squads, profiles, payments] = await Promise.all([
    fetchAllRows<any>(() =>
      supabaseAdmin
        .from('colleges')
        .select('id, name, code, district, region, principal_name, principal_email, principal_phone')
        .order('id')
    ),
    fetchAllRows<any>(() =>
      supabaseAdmin
        .from('squads')
        .select('id, college_id, gender, ped_name, ped_phone, ped_email, payment_status')
        .order('id')
    ),
    fetchAllRows<any>(() => supabaseAdmin.from('profiles').select('squad_id').order('id')),
    fetchAllRows<any>(() =>
      supabaseAdmin.from('payments').select('squad_id, status, amount_received, amount_submitted').order('id')
    ),
  ]);

  const athletesBySquad = new Map<string, number>();
  for (const p of profiles) {
    if (p.squad_id) athletesBySquad.set(p.squad_id, (athletesBySquad.get(p.squad_id) || 0) + 1);
  }

  const paymentsBySquad = new Map<string, any[]>();
  for (const p of payments) {
    if (!p.squad_id) continue;
    const list = paymentsBySquad.get(p.squad_id) || [];
    list.push(p);
    paymentsBySquad.set(p.squad_id, list);
  }

  const squadsByCollege = new Map<string, any[]>();
  for (const sq of squads) {
    const list = squadsByCollege.get(sq.college_id) || [];
    list.push(sq);
    squadsByCollege.set(sq.college_id, list);
  }

  // Fees only for squads of registered colleges (the rest owe nothing)
  const registeredSquadIds = squads
    .filter((sq) =>
      (squadsByCollege.get(sq.college_id) || []).some((sib) => (athletesBySquad.get(sib.id) || 0) > 0)
    )
    .map((sq) => sq.id as string);
  const fees = await calculateFeesForSquads(registeredSquadIds);

  const registered: CollegeReportRow[] = [];
  const notRegistered: CollegeReportRow[] = [];

  for (const c of colleges) {
    const list = squadsByCollege.get(c.id) || [];
    const row: CollegeReportRow = {
      division: divisionLabel(c.code, c.region),
      code: s(c.code),
      name: s(c.name),
      district: s(c.district),
      pedMen: emptyPed(),
      pedWomen: emptyPed(),
      principalName: s(c.principal_name),
      principalPhone: s(c.principal_phone),
      principalEmail: s(c.principal_email),
      menAthletes: 0,
      womenAthletes: 0,
      totalAmount: 0,
      paid: 0,
      pending: 0,
      balance: 0,
      paymentStatus: '',
    };

    const statuses = new Set<string>();
    for (const sq of list) {
      const ped = { name: s(sq.ped_name), phone: s(sq.ped_phone), email: s(sq.ped_email) };
      const athletes = athletesBySquad.get(sq.id) || 0;
      if (String(sq.gender).toLowerCase() === 'women') {
        row.pedWomen = ped;
        row.womenAthletes += athletes;
      } else {
        row.pedMen = ped;
        row.menAthletes += athletes;
      }
      row.totalAmount += fees.get(sq.id)?.totalAmount || 0;
      for (const p of paymentsBySquad.get(sq.id) || []) {
        row.paid += creditedAmount(p);
        if (p.status === 'SUBMITTED') row.pending += Number(p.amount_submitted || 0);
      }
      statuses.add(normalizePaymentStatus(sq.payment_status));
    }
    row.balance = Math.max(0, row.totalAmount - row.paid);
    // Both squads carry the same college status; show the worst if they ever differ
    row.paymentStatus =
      ['REJECTED', 'SUBMITTED', 'DRAFT', 'VERIFIED'].find((st) => statuses.has(st)) || 'DRAFT';

    (row.menAthletes + row.womenAthletes > 0 ? registered : notRegistered).push(row);
  }

  const order = (d: string) => {
    const i = (VTU_DIVISIONS as readonly string[]).indexOf(d);
    return i < 0 ? 99 : i;
  };
  const sort = (a: CollegeReportRow, b: CollegeReportRow) =>
    order(a.division) - order(b.division) || compareText(a.name, b.name);
  registered.sort(sort);
  notRegistered.sort(sort);
  return { registered, notRegistered };
}

// -----------------------------------------------------------------------------
// Workbook
// -----------------------------------------------------------------------------

const NAVY = 'FF1F3A68';
const BAND = 'FFDFE7F3';
const THIN: Partial<Borders> = {
  top: { style: 'thin', color: { argb: 'FF94A3B8' } },
  left: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
  right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};
const RUPEE = '"₹"#,##0';

interface Col {
  header: string;
  width: number;
  value: (r: CollegeReportRow) => string | number;
  money?: boolean;
}

const BASE_COLS: Col[] = [
  { header: 'Division', width: 12, value: (r) => r.division },
  { header: 'College Code', width: 12, value: (r) => r.code },
  { header: 'College', width: 42, value: (r) => r.name },
  { header: 'District', width: 14, value: (r) => r.district },
  { header: "PED (Men) Name", width: 22, value: (r) => r.pedMen.name },
  { header: "PED (Men) Phone", width: 14, value: (r) => r.pedMen.phone },
  { header: "PED (Men) Email", width: 28, value: (r) => r.pedMen.email },
  { header: "PED (Women) Name", width: 22, value: (r) => r.pedWomen.name },
  { header: "PED (Women) Phone", width: 14, value: (r) => r.pedWomen.phone },
  { header: "PED (Women) Email", width: 28, value: (r) => r.pedWomen.email },
  { header: 'Principal Name', width: 22, value: (r) => r.principalName },
  { header: 'Principal Phone', width: 14, value: (r) => r.principalPhone },
  { header: 'Principal Email', width: 28, value: (r) => r.principalEmail },
];

const REGISTERED_COLS: Col[] = [
  ...BASE_COLS,
  { header: 'Total Amount', width: 13, value: (r) => r.totalAmount, money: true },
  { header: 'Amount Paid (verified)', width: 14, value: (r) => r.paid, money: true },
  { header: 'Awaiting Verification', width: 14, value: (r) => r.pending, money: true },
  { header: 'Balance To Be Paid', width: 14, value: (r) => r.balance, money: true },
  { header: 'Payment Status', width: 13, value: (r) => r.paymentStatus },
];

const NOT_REGISTERED_COLS: Col[] = [...BASE_COLS, { header: 'Remarks / Called', width: 24, value: () => '' }];

function istStamp(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date())
    .replace(/\//g, '-')
    .replace(',', '')
    .replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
}

function fillSheet(ws: Worksheet, title: string, summary: string, cols: Col[], rows: CollegeReportRow[]) {
  const width = cols.length + 1; // + Sl. No.
  const lines: [string, number][] = [
    ['28th VTU Inter-Collegiate State Level Athletic Meet 2026 (Dr. ACS-AURA 2026)', 14],
    [title, 12],
    [`Generated ${istStamp()} IST · ${summary}`, 10],
  ];
  lines.forEach(([text, size], i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = text;
    row.getCell(1).font = { bold: i < 2, size };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.height = 20;
    ws.mergeCells(i + 1, 1, i + 1, width);
  });

  const head = ws.getRow(5);
  ['Sl. No.', ...cols.map((c) => c.header)].forEach((h, i) => {
    const cell = head.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = THIN;
  });
  head.height = 30;
  ws.getColumn(1).width = 7;
  cols.forEach((c, i) => (ws.getColumn(i + 2).width = c.width));

  let r = 6;
  let n = 0;
  let division: string | null = null;
  for (const row of rows) {
    if (row.division !== division) {
      division = row.division;
      const count = rows.filter((x) => x.division === division).length;
      const band = ws.getRow(r);
      band.getCell(1).value = `${division} Division — ${count} colleges`;
      for (let i = 1; i <= width; i++) {
        const cell = band.getCell(i);
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
        cell.border = THIN;
      }
      r += 1;
    }
    n += 1;
    const line = ws.getRow(r);
    line.getCell(1).value = n;
    cols.forEach((c, i) => {
      const cell = line.getCell(i + 2);
      cell.value = c.value(row);
      if (c.money) cell.numFmt = RUPEE;
    });
    for (let i = 1; i <= width; i++) {
      line.getCell(i).border = THIN;
      line.getCell(i).alignment = { vertical: 'top', wrapText: true };
    }
    r += 1;
  }

  // Totals for the money columns
  if (cols.some((c) => c.money)) {
    const tot = ws.getRow(r);
    tot.getCell(1).value = `GRAND TOTAL — ${rows.length} colleges`;
    ws.mergeCells(r, 1, r, 1 + cols.findIndex((c) => c.money));
    cols.forEach((c, i) => {
      if (!c.money) return;
      const cell = tot.getCell(i + 2);
      cell.value = rows.reduce((a, x) => a + Number(c.value(x) || 0), 0);
      cell.numFmt = RUPEE;
    });
    for (let i = 1; i <= width; i++) {
      const cell = tot.getCell(i);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.border = THIN;
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 4 }];
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: width } };
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '5:5',
  };
}

export const COLLEGE_LIST_FILENAMES: Record<CollegeListKind, string> = {
  registered: 'AURA2026_Registered_Colleges.xlsx',
  'not-registered': 'AURA2026_Colleges_Not_Registered.xlsx',
};

/** The workbook for one list, as a Buffer ready to download. */
export async function buildCollegeListWorkbook(kind: CollegeListKind): Promise<Buffer> {
  const { registered, notRegistered } = await loadCollegeRegistrationRows();
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dr. ACS-AURA 2026';
  wb.created = new Date();

  if (kind === 'registered') {
    const balance = registered.reduce((a, r) => a + r.balance, 0);
    const due = registered.filter((r) => r.balance > 0).length;
    fillSheet(
      wb.addWorksheet('Registered Colleges'),
      'Colleges Registered — Contacts & College Fee Account (Men + Women)',
      `${registered.length} colleges registered · balance ₹${balance.toLocaleString('en-IN')} across ${due} colleges`,
      REGISTERED_COLS,
      registered
    );
  } else {
    fillSheet(
      wb.addWorksheet('Not Registered'),
      'Colleges Not Yet Registered — Contact List',
      `${notRegistered.length} colleges with no athlete registered on the portal`,
      NOT_REGISTERED_COLS,
      notRegistered
    );
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
