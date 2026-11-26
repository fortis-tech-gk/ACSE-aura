/**
 * Formatted Excel download for the admin Athletes page (browser only).
 *
 * Sheets: "Event-wise" (one block per event, like ACS-AURA_Athletes_EventWise.xlsx),
 * "All Athletes" (one row per athlete) and "Report Info". Every sheet starts with the same
 * header (logo, college, meet, report title, filters) and prints A4 landscape with the header
 * rows repeated and page numbers. exceljs is loaded only when a download is clicked.
 */
import type { Workbook, Worksheet, Borders } from 'exceljs';
import type { EventGroup, ExportRow } from '@/lib/athlete-export';
import { EVENT_WISE_COLUMNS } from '@/lib/athlete-export';

export const REPORT_ORG = 'Dr. ACS COLLEGE OF ENGINEERING, BENGALURU';
export const REPORT_MEET = 'VTU’s 28th Inter-Collegiate State Level Athletic Meet 2026 • Dr. ACS-AURA 2026';

export interface XlsxReport {
  filename: string;
  /** e.g. "Athletes by Event — Entire Roster" */
  title: string;
  filterSummary: string;
  groups: EventGroup[];
  athletes: ExportRow[];
}

const NAVY = 'FF1F4E78';
const HEAD_FILL = 'FFD9E1F2';
const THIN: Partial<Borders> = {
  top: { style: 'thin', color: { argb: 'FF94A3B8' } },
  left: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
  right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};
const HEADER_ROWS = 4;

async function logoImageId(wb: Workbook): Promise<number | null> {
  try {
    const res = await fetch('/logo.jpeg');
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return wb.addImage({ buffer: buf as any, extension: 'jpeg' });
  } catch {
    return null; // the header still has the text without the logo
  }
}

/** Rows 1–4: college, meet, report title, filters + generated time. Merged across the sheet. */
function addHeader(ws: Worksheet, cols: number, title: string, info: string, logo: number | null) {
  const lines: [string, number, boolean][] = [
    [REPORT_ORG, 14, true],
    [REPORT_MEET, 11, true],
    [title, 12, true],
    [info, 9, false],
  ];
  lines.forEach(([text, size, bold], i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = text;
    row.getCell(1).font = { bold, size, italic: i === 3, underline: i === 2, color: { argb: i === 3 ? 'FF334155' : 'FF0F172A' } };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    row.height = i === 3 ? 18 : 20;
    ws.mergeCells(i + 1, 1, i + 1, cols);
  });
  ws.getCell(HEADER_ROWS, 1).border = { bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
  if (logo !== null) ws.addImage(logo, { tl: { col: 0.1, row: 0.1 }, ext: { width: 58, height: 58 } });
}

function setupPrint(ws: Worksheet, footerTitle: string, printRows: string) {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 },
    printTitlesRow: printRows,
    horizontalCentered: true,
  };
  ws.headerFooter = {
    oddFooter: `&L&8${footerTitle.replace(/&/g, '&&')}&R&8Page &P of &N`,
  };
}

function styleHeaderRow(ws: Worksheet, rowNo: number, cols: number) {
  const row = ws.getRow(rowNo);
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
    cell.border = THIN;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
  row.height = 18;
}

function styleDataRow(ws: Worksheet, rowNo: number, cols: number, center: Set<number>, shade: boolean) {
  const row = ws.getRow(rowNo);
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.font = { size: 10 };
    cell.border = THIN;
    cell.alignment = { vertical: 'top', horizontal: center.has(c) ? 'center' : 'left', wrapText: true };
    if (shade) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  }
}

function eventWiseSheet(wb: Workbook, r: XlsxReport, logo: number | null) {
  const cols = EVENT_WISE_COLUMNS.length;
  const ws = wb.addWorksheet('Event-wise', { views: [{ state: 'frozen', ySplit: HEADER_ROWS }] });
  ws.columns = [7, 9, 32, 14, 6, 12, 46, 14, 14, 13, 18].map((width) => ({ width }));
  const totalEntries = r.groups.reduce((n, g) => n + g.entries, 0);
  const totalReserves = r.groups.reduce((n, g) => n + g.reserves, 0);
  addHeader(
    ws,
    cols,
    r.title,
    `Filters: ${r.filterSummary}   •   ${r.groups.length} ${r.groups.length === 1 ? 'event' : 'events'}, ${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'}, ${totalReserves} ${totalReserves === 1 ? 'reserve' : 'reserves'}   •   Generated ${new Date().toLocaleString('en-IN')}`,
    logo
  );

  const center = new Set([1, 2, 5, 6, 10, 11]);
  let rowNo = HEADER_ROWS + 2;
  if (r.groups.length === 0) {
    ws.getCell(rowNo, 1).value = 'No athletes are entered in the selected event(s).';
  }
  for (const g of r.groups) {
    // Event bar: "[1] 100 mtrs Run – Men   (15 entries, 1 reserve)"
    const bar = ws.getRow(rowNo);
    bar.getCell(1).value = `${g.title}   (${g.entries} ${g.entries === 1 ? 'entry' : 'entries'}, ${g.reserves} ${g.reserves === 1 ? 'reserve' : 'reserves'})`;
    bar.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    bar.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    bar.getCell(1).alignment = { vertical: 'middle' };
    bar.height = 20;
    ws.mergeCells(rowNo, 1, rowNo, cols);
    rowNo++;

    ws.getRow(rowNo).values = EVENT_WISE_COLUMNS as string[];
    styleHeaderRow(ws, rowNo, cols);
    rowNo++;

    g.rows.forEach((row, i) => {
      ws.getRow(rowNo).values = EVENT_WISE_COLUMNS.map((k) => row[k]);
      styleDataRow(ws, rowNo, cols, center, i % 2 === 1);
      if (row['Entered As'] === 'Reserve') ws.getRow(rowNo).getCell(10).font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
      rowNo++;
    });
    rowNo++; // gap before the next event
  }
  setupPrint(ws, `Dr. ACS-AURA 2026 — ${r.title}`, `1:${HEADER_ROWS}`);
}

function allAthletesSheet(wb: Workbook, r: XlsxReport, logo: number | null) {
  const keys = Object.keys(r.athletes[0] || { 'Sl No': '' }) as (keyof ExportRow)[];
  const cols = keys.length;
  const headerRow = HEADER_ROWS + 2;
  const ws = wb.addWorksheet('All Athletes', { views: [{ state: 'frozen', ySplit: headerRow, xSplit: 3 }] });
  ws.columns = keys.map((k) => ({
    width: Math.min(46, Math.max(String(k).length + 2, ...r.athletes.map((a) => String(a[k] ?? '').length + 1))),
  }));
  const men = r.athletes.filter((a) => a.Gender === 'Men').length;
  addHeader(
    ws,
    Math.min(cols, 14),
    `${r.title.replace('Athletes by Event', 'All Athletes')}`,
    `Filters: ${r.filterSummary}   •   ${r.athletes.length} athletes (${men} men, ${r.athletes.length - men} women)   •   Generated ${new Date().toLocaleString('en-IN')}`,
    logo
  );
  ws.getRow(headerRow).values = keys as string[];
  styleHeaderRow(ws, headerRow, cols);
  const center = new Set(['Sl No', 'Bib No', 'Gender', 'Semester', 'Blood Group', 'Date of Birth', 'Half Marathon'].map((k) => keys.indexOf(k as keyof ExportRow) + 1));
  r.athletes.forEach((a, i) => {
    const n = headerRow + 1 + i;
    ws.getRow(n).values = keys.map((k) => a[k]);
    styleDataRow(ws, n, cols, center, i % 2 === 1);
  });
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + r.athletes.length, column: cols } };
  setupPrint(ws, `Dr. ACS-AURA 2026 — All Athletes`, `${headerRow}:${headerRow}`);
}

function infoSheet(wb: Workbook, r: XlsxReport, logo: number | null) {
  const ws = wb.addWorksheet('Report Info');
  ws.columns = [{ width: 22 }, { width: 80 }];
  addHeader(ws, 2, 'Report Info', '', logo);
  const men = r.athletes.filter((a) => a.Gender === 'Men').length;
  const rows: [string, string | number][] = [
    ['Report', r.title],
    ['Generated', new Date().toLocaleString('en-IN')],
    ['Filters', r.filterSummary],
    ['Athletes', r.athletes.length],
    ['Men', men],
    ['Women', r.athletes.length - men],
    ['Colleges', new Set(r.athletes.map((a) => a['College Code'])).size],
    ['Events listed', r.groups.length],
    ['Entries (excl. reserves)', r.groups.reduce((n, g) => n + g.entries, 0)],
    ['Reserves', r.groups.reduce((n, g) => n + g.reserves, 0)],
    ['Note', 'Aadhaar numbers show only the last 4 digits. Relay and Half Marathon athletes are listed under those events.'],
  ];
  rows.forEach(([k, v], i) => {
    const row = ws.getRow(HEADER_ROWS + 2 + i);
    row.values = [k, v];
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, horizontal: 'left' };
  });
  setupPrint(ws, 'Dr. ACS-AURA 2026 — Report Info', `1:${HEADER_ROWS}`);
}

/** Builds the three sheets and returns the .xlsx bytes */
export async function buildAthletesXlsx(r: XlsxReport): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dr. ACS-AURA 2026 Admin';
  wb.created = new Date();
  const logo = await logoImageId(wb);

  eventWiseSheet(wb, r, logo);
  allAthletesSheet(wb, r, logo);
  infoSheet(wb, r, logo);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadAthletesXlsx(r: XlsxReport): Promise<void> {
  const buf = await buildAthletesXlsx(r);
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${r.filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
