/**
 * The one Excel workbook colleges and the meet office fill in for passes (migration 0057).
 *
 * Sheets, in this order:
 *   Instructions                — how to fill it in and what happens next
 *   1. Faculty                  — accompanying faculty / team manager / coach   → category FACULTY
 *   2. PEDs                     — Physical Education Directors of the college   → category PED
 *   3. Officials & Volunteers    — host side: referees, technical officials, …   → category OFFICIAL
 *   Lists                       — the dropdown values (do not edit)
 *
 * buildDelegateWorkbook() writes it (pre-filled with the college's own code when a PED
 * downloads it); parseDelegateWorkbook() reads a filled copy back. Columns are found by
 * their heading, not their position, so an inserted column does not break the import.
 *
 * Server-only (exceljs is loaded on demand).
 */
import type { Workbook, Worksheet } from 'exceljs';
import {
  BLOOD_GROUPS,
  FACULTY_DESIGNATIONS,
  OFFICIAL_ROLES,
  PED_DESIGNATION,
  cleanEmail,
  cleanName,
  isBlankRow,
  isValidDelegatePhone,
  normalizeDelegatePhone,
  parseBloodGroup,
  parseGender,
  parseScope,
  parseYesNo,
  type DelegateCategory,
  type DelegateGender,
  type SquadScope,
} from './delegates';

export const DELEGATE_TEMPLATE_FILENAME = 'AURA2026_Faculty_PED_Officials.xlsx';

const MEET_LINE = 'VTU’s 28th Inter-Collegiate State Level Athletic Meet 2026 • Dr. ACS-AURA 2026';
const HOST_LINE = 'Dr. ACS COLLEGE OF ENGINEERING, BENGALURU';
const NAVY = 'FF1F4E78';
const HEAD_FILL = 'FFD9E1F2';
const NEED_FILL = 'FFFFF2CC';
const BLANK_ROWS = 30;

export const SHEET_FACULTY = '1. Faculty';
export const SHEET_PED = '2. PEDs';
export const SHEET_OFFICIALS = '3. Officials & Volunteers';
const SHEET_LISTS = 'Lists';

interface Col {
  /** heading printed in the sheet */
  head: string;
  width: number;
  /** our field name */
  key: Field;
  required?: boolean;
  /** dropdown source on the Lists sheet, e.g. "$A$2:$A$9" */
  list?: string;
  note?: string;
}

type Field =
  | 'sno'
  | 'collegeCode'
  | 'fullName'
  | 'designation'
  | 'department'
  | 'organisation'
  | 'gender'
  | 'phone'
  | 'email'
  | 'bloodGroup'
  | 'scope'
  | 'meals'
  | 'accommodation'
  | 'remarks';

const SNO: Col = { head: 'S. No.', width: 7, key: 'sno' };
const NAME: Col = { head: 'Full Name (as in records)', width: 32, key: 'fullName', required: true };
const GENDER: Col = { head: 'Gender', width: 11, key: 'gender', list: '$D$2:$D$4' };
const PHONE: Col = { head: 'Mobile Number', width: 16, key: 'phone', note: '10 digits' };
const EMAIL: Col = { head: 'Email', width: 26, key: 'email' };
const BLOOD: Col = { head: 'Blood Group', width: 13, key: 'bloodGroup', list: '$E$2:$E$9' };
const MEALS: Col = { head: 'Meals Required', width: 15, key: 'meals', list: '$F$2:$F$3' };
const STAY: Col = { head: 'Accommodation Required', width: 22, key: 'accommodation', list: '$F$2:$F$3' };
const REMARKS: Col = { head: 'Remarks', width: 26, key: 'remarks' };
const COLLEGE: Col = { head: 'College Code', width: 14, key: 'collegeCode', required: true };

// Faculty of the host college (Dr. ACS): no college code, no squad — they are not with a contingent
const FACULTY_COLS: Col[] = [
  SNO,
  NAME,
  { head: 'Designation', width: 24, key: 'designation', required: true, list: `$A$2:$A$${FACULTY_DESIGNATIONS.length + 1}` },
  { head: 'Department', width: 22, key: 'department' },
  GENDER,
  PHONE,
  EMAIL,
  BLOOD,
  MEALS,
  STAY,
  REMARKS,
];

const PED_COLS: Col[] = [
  SNO,
  COLLEGE,
  NAME,
  { head: 'Designation', width: 26, key: 'designation' },
  GENDER,
  PHONE,
  EMAIL,
  BLOOD,
  { head: 'In Charge Of', width: 15, key: 'scope', list: '$C$2:$C$4' },
  MEALS,
  STAY,
  REMARKS,
];

const OFFICIAL_COLS: Col[] = [
  SNO,
  NAME,
  { head: 'Role', width: 22, key: 'designation', required: true, list: `$B$2:$B$${OFFICIAL_ROLES.length + 1}` },
  { head: 'Organisation / College', width: 30, key: 'organisation' },
  GENDER,
  PHONE,
  EMAIL,
  BLOOD,
  MEALS,
  STAY,
  REMARKS,
];

export const SHEETS: { name: string; category: DelegateCategory; cols: Col[]; blurb: string }[] = [
  {
    name: SHEET_FACULTY,
    category: 'FACULTY',
    cols: FACULTY_COLS,
    blurb: 'Faculty and staff of Dr. ACS College of Engineering (the host) working at the meet. Filled by the host college, not by visiting colleges.',
  },
  {
    name: SHEET_PED,
    category: 'PED',
    cols: PED_COLS,
    blurb: 'Physical Education Directors of the participating colleges who come with their squads. One row per PED, with the college code.',
  },
  {
    name: SHEET_OFFICIALS,
    category: 'OFFICIAL',
    cols: OFFICIAL_COLS,
    blurb: 'MEET OFFICE ONLY — referees, technical officials, jury, call room officials, medical, media, guests and named volunteers (Role = Volunteer). Blank volunteer passes need no rows here.',
  },
];

// -----------------------------------------------------------------------------
// Writing the template
// -----------------------------------------------------------------------------

export interface TemplateContext {
  /** When a PED downloads it: their own college, pre-filled in every row. */
  collegeCode?: string;
  collegeName?: string;
  /** PED rows already known from the squad records, so they only have to be checked. */
  knownPeds?: { name: string; phone: string; email: string; scope: SquadScope }[];
  /** true for the meet office copy (every sheet is theirs to fill) */
  forAdmin?: boolean;
  /** Colleges e-mail the file back to the meet office instead of uploading it to the portal */
  manualReturn?: boolean;
}

function titleRows(ws: Worksheet, cols: number, subtitle: string) {
  const lines: [string, number, boolean][] = [
    [HOST_LINE, 13, true],
    [MEET_LINE, 10, false],
    [subtitle, 11, true],
  ];
  lines.forEach(([text, size, bold], i) => {
    const row = ws.getRow(i + 1);
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = { bold, size, color: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    row.height = 20;
    if (cols > 1) ws.mergeCells(i + 1, 1, i + 1, cols);
  });
}

function addEntrySheet(wb: Workbook, spec: (typeof SHEETS)[number], ctx: TemplateContext) {
  const ws = wb.addWorksheet(spec.name, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  const cols = spec.cols;
  titleRows(ws, cols.length, spec.name.replace(/^\d+\.\s*/, '').toUpperCase());

  // Row 4: what this sheet is for
  const blurb = ws.getRow(4);
  blurb.getCell(1).value = spec.blurb;
  blurb.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF7C2D12' } };
  blurb.getCell(1).alignment = { vertical: 'middle', wrapText: true };
  blurb.height = 26;
  ws.mergeCells(4, 1, 4, cols.length);

  // Row 5: the headings
  const head = ws.getRow(5);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.required ? `${c.head} *` : c.head;
    cell.font = { bold: true, size: 10, color: { argb: NAVY } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? NEED_FILL : HEAD_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'medium' },
      right: { style: 'thin' },
    };
    if (c.note) cell.note = c.note;
    ws.getColumn(i + 1).width = c.width;
  });
  head.height = 32;

  // Pre-filled PED rows, then blank rows ready to type into
  const prefill: Record<string, unknown>[] = [];
  if (spec.category === 'PED' && ctx.knownPeds?.length) {
    for (const p of ctx.knownPeds) {
      prefill.push({
        collegeCode: ctx.collegeCode || '',
        fullName: p.name,
        designation: PED_DESIGNATION,
        phone: p.phone,
        email: p.email,
        scope: p.scope === 'MEN' ? 'Men' : p.scope === 'WOMEN' ? 'Women' : 'Both',
      });
    }
  }

  const total = Math.max(BLANK_ROWS, prefill.length + 5);
  for (let r = 0; r < total; r++) {
    const row = ws.getRow(6 + r);
    const pre = prefill[r];
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.key === 'sno') cell.value = r + 1;
      else if (c.key === 'collegeCode' && ctx.collegeCode) cell.value = ctx.collegeCode;
      else if (pre && pre[c.key] != null && pre[c.key] !== '') cell.value = pre[c.key] as string;
      else if (c.key === 'meals') cell.value = 'Yes';
      else if (c.key === 'accommodation') cell.value = 'No';

      cell.font = { size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: c.key === 'sno' ? 'center' : 'left' };
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFBFCBD9' } },
        left: { style: 'hair', color: { argb: 'FFBFCBD9' } },
        bottom: { style: 'hair', color: { argb: 'FFBFCBD9' } },
        right: { style: 'hair', color: { argb: 'FFBFCBD9' } },
      };
      if (c.key === 'phone') cell.numFmt = '@'; // keep leading zeros / never 9.88e9
      if (c.list) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`${SHEET_LISTS}!${c.list}`],
          showErrorMessage: false,
        };
      }
    });
    row.height = 18;
  }

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: cols.length } };
  return ws;
}

function addListsSheet(wb: Workbook) {
  const ws = wb.addWorksheet(SHEET_LISTS);
  ws.getCell('A1').value = 'Designations';
  ws.getCell('B1').value = 'Official roles';
  ws.getCell('C1').value = 'Squad';
  ws.getCell('D1').value = 'Gender';
  ws.getCell('E1').value = 'Blood group';
  ws.getCell('F1').value = 'Yes / No';
  ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].forEach((a) => {
    ws.getCell(a).font = { bold: true, size: 10, color: { argb: NAVY } };
  });
  FACULTY_DESIGNATIONS.forEach((v, i) => (ws.getCell(`A${i + 2}`).value = v));
  OFFICIAL_ROLES.forEach((v, i) => (ws.getCell(`B${i + 2}`).value = v));
  ['Men', 'Women', 'Both'].forEach((v, i) => (ws.getCell(`C${i + 2}`).value = v));
  ['Male', 'Female', 'Other'].forEach((v, i) => (ws.getCell(`D${i + 2}`).value = v));
  BLOOD_GROUPS.forEach((v, i) => (ws.getCell(`E${i + 2}`).value = v));
  ['Yes', 'No'].forEach((v, i) => (ws.getCell(`F${i + 2}`).value = v));
  ws.columns.forEach((c) => (c.width = 24));
  ws.state = 'visible';
  return ws;
}

function addInstructionsSheet(wb: Workbook, ctx: TemplateContext) {
  const ws = wb.addWorksheet('Instructions', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 110;
  titleRows(ws, 2, 'FACULTY, PED & OFFICIAL ACCREDITATION PASSES — HOW TO FILL THIS SHEET');

  const who = ctx.collegeName
    ? `${ctx.collegeName}${ctx.collegeCode ? ` (${ctx.collegeCode})` : ''}`
    : 'the meet organising committee';

  const lines: (string | [string])[] = [
    [`Prepared for: ${who}`],
    '',
    ['What this sheet is for'],
    'Athletes already have their own registration and ID card. This workbook is for everyone else who needs a pass to enter the venue and eat at the meet: the host college faculty, the PEDs who come with each college squad, and the meet officials.',
    '',
    ['The three sheets'],
    `• "${SHEET_FACULTY}" — faculty and staff of Dr. ACS College of Engineering (host) on duty at the meet. Filled by the host college only.`,
    `• "${SHEET_PED}" — Physical Education Directors of the participating colleges who come with their squads. Write the college code on every row.`,
    `• "${SHEET_OFFICIALS}" — MEET OFFICE ONLY: referees, technical officials, jury, call room officials, medical team, media and guests. Pick "Volunteer" as the role to make a volunteer pass. A college does not fill this sheet.`,
    '',
    ['Filling it in'],
    '• One person per row. Columns marked * must be filled; leave the rest blank if you do not have it.',
    '• Type the name the way it should be printed on the pass. Do not write initials only.',
    '• Mobile Number: 10 digits. +91, spaces and dashes are fine — they are removed on upload.',
    '• Designation / Role: pick from the dropdown. Choose "Other" and write the real one in Remarks if nothing fits.',
    '• Meals Required: "Yes" issues a meal coupon on the pass (breakfast, lunch, snacks and dinner, one of each per day). "No" prints a pass that the food counter will refuse.',
    '• Accommodation Required: "Yes" tells the hostel desk to plan a bed. It does not reserve one by itself — the meet office confirms it.',
    '• Do not delete, rename or reorder the sheets, and do not rename the heading row. Extra columns of your own are ignored, so they are safe to add.',
    '• Blank rows are ignored, so there is no need to delete the unused ones.',
    '',
    ['Sending it back'],
    ...(ctx.manualReturn
      ? [
          '• Fill in only the sheet that is yours, save the file as .xlsx (keep the file type), and send it back to the meet office.',
          '• Participating colleges: fill sheet 2 with your College Code on every row, and rename the file with your college code, e.g. "MITM_PED.xlsx".',
          '• To correct something later, send the whole corrected file again — it replaces the earlier one.',
        ]
      : [
          '• Log in to the Contingent Portal → "Faculty & Officials" → Upload filled sheet. The list on that page shows what was read, and anything rejected is listed with the reason.',
          '• Uploading a corrected copy updates the same people (matched on the name within your college) instead of adding them twice.',
        ]),
    '',
    ['Passes'],
    '• Each person gets a 4×6 inch pass with their own QR code and a pass number (90001 onwards).',
    ctx.manualReturn
      ? '• The meet office prints the passes and hands them over at the accreditation desk.'
      : '• Print them from the portal: "Faculty & Officials" → Print passes.',
    '• Every pass is active from the moment it is issued: no fee and no check-in. The QR is scanned only at the food counters and, if accommodation was asked for, at the hostel.',
    '• Faculty and official passes are free of charge — nothing is added to the college fee.',
  ];

  let r = 5;
  for (const line of lines) {
    const row = ws.getRow(r++);
    if (Array.isArray(line)) {
      row.getCell(2).value = line[0];
      row.getCell(2).font = { bold: true, size: 11, color: { argb: NAVY } };
    } else {
      row.getCell(2).value = line;
      row.getCell(2).font = { size: 10 };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      if (line.length > 95) row.height = 28;
    }
  }
  return ws;
}

/** The workbook as a Buffer, ready to download. */
export async function buildDelegateWorkbook(ctx: TemplateContext = {}): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = HOST_LINE;
  wb.created = new Date();

  addInstructionsSheet(wb, ctx);
  for (const spec of SHEETS) addEntrySheet(wb, spec, ctx);
  addListsSheet(wb);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

// -----------------------------------------------------------------------------
// Reading a filled copy
// -----------------------------------------------------------------------------

export interface ParsedDelegate {
  sheet: string;
  excelRow: number;
  category: DelegateCategory;
  collegeCode: string;
  fullName: string;
  designation: string;
  department: string;
  organisation: string;
  gender: DelegateGender | null;
  phone: string;
  email: string;
  bloodGroup: string;
  scope: SquadScope;
  meals: boolean;
  accommodation: boolean;
  remarks: string;
}

export interface RejectedRow {
  sheet: string;
  excelRow: number;
  name: string;
  reason: string;
}

export interface ParsedWorkbook {
  rows: ParsedDelegate[];
  rejected: RejectedRow[];
  /** sheets that were missing from the uploaded file */
  missingSheets: string[];
}

/** Headings we accept for each field, lower-cased and stripped of punctuation. */
const HEADER_ALIASES: Record<Field, string[]> = {
  sno: ['s no', 'sno', 'sl no', 'serial no', 'si no', '#'],
  collegeCode: ['college code', 'clg code', 'code', 'college', 'institution code'],
  fullName: ['full name as in records', 'full name', 'name', 'name of the faculty', 'name of faculty', 'name of ped', 'name of official', 'faculty name', 'official name'],
  designation: ['designation', 'role', 'post', 'designation role', 'official role'],
  department: ['department', 'dept', 'branch'],
  organisation: ['organisation college', 'organisation', 'organization', 'institution', 'organisation name', 'college institution'],
  gender: ['gender', 'sex'],
  phone: ['mobile number', 'mobile', 'phone', 'phone number', 'contact', 'contact number', 'mobile no'],
  email: ['email', 'e mail', 'email id', 'mail id'],
  bloodGroup: ['blood group', 'blood'],
  scope: ['travels with', 'in charge of', 'squad', 'division', 'men women'],
  meals: ['meals required', 'meals', 'food', 'food required', 'meal'],
  accommodation: ['accommodation required', 'accommodation', 'stay', 'hostel', 'accomodation required', 'accomodation'],
  remarks: ['remarks', 'remark', 'notes', 'note'],
};

function norm(v: unknown): string {
  return String(v ?? '')
    .replace(/\*/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Excel cells can hold rich text, formulas, hyperlinks — reduce any of them to text. */
function cellText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellText(v.result);
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((p: any) => p.text).join('');
    if ('hyperlink' in v && typeof (v as any).text === 'string') return (v as any).text;
  }
  return String(v);
}

/** Finds the heading row (one that holds a name column) and maps field → column number. */
function mapHeaders(ws: Worksheet): { headerRow: number; cols: Partial<Record<Field, number>> } | null {
  const last = Math.min(ws.rowCount, 20);
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    const heads: { col: number; text: string }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => heads.push({ col, text: norm(cellText(cell.value)) }));
    const hasName = heads.some((h) => HEADER_ALIASES.fullName.includes(h.text));
    if (!hasName) continue;

    const cols: Partial<Record<Field, number>> = {};
    for (const h of heads) {
      for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
        if (cols[field] == null && aliases.includes(h.text)) cols[field] = h.col;
      }
    }
    return { headerRow: r, cols };
  }
  return null;
}

/** .xlsx files are ZIP archives: refuse anything that is not one before handing it to exceljs. */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

export interface ParseOptions {
  /** A college upload: every row belongs to this code and sheet 3 is ignored. */
  forcedCollegeCode?: string;
  /** Codes that exist in the championship — a row naming anything else is rejected. */
  knownCollegeCodes?: Set<string>;
}

export async function parseDelegateWorkbook(buf: Buffer, opts: ParseOptions = {}): Promise<ParsedWorkbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);

  const rows: ParsedDelegate[] = [];
  const rejected: RejectedRow[] = [];
  const missingSheets: string[] = [];
  // A person may appear once per college and category, however many times they are typed
  const seen = new Set<string>();

  for (const spec of SHEETS) {
    // The PED may rename "3. Officials & Volunteers" slightly: match on the keyword
    const want = norm(spec.name);
    const ws =
      wb.getWorksheet(spec.name) ||
      wb.worksheets.find((w) => norm(w.name) === want) ||
      wb.worksheets.find((w) => norm(w.name).includes(want.replace(/^\d+\s*/, '').split(' ')[0]));
    if (!ws) {
      missingSheets.push(spec.name);
      continue;
    }
    // A college's upload never brings in meet officials
    // A college's upload only brings in its own PEDs (sheet 2)
    if (spec.category !== 'PED' && opts.forcedCollegeCode) continue;

    const head = mapHeaders(ws);
    if (!head) {
      missingSheets.push(spec.name);
      continue;
    }
    const { headerRow, cols } = head;

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (f: Field): string => (cols[f] ? cellText(row.getCell(cols[f]!).value).trim() : '');
      // "S. No." alone is not data: the template pre-numbers 30 empty rows
      const meaningful: Field[] = [
        'fullName', 'designation', 'department', 'organisation', 'gender', 'phone', 'email', 'bloodGroup', 'remarks',
      ];
      if (isBlankRow(meaningful.map(get))) continue;

      const fullName = cleanName(get('fullName'));
      const reject = (reason: string) => rejected.push({ sheet: spec.name, excelRow: r, name: fullName || '(no name)', reason });

      if (!fullName) {
        reject('No name in the "Full Name" column.');
        continue;
      }
      if (fullName.length < 3 || fullName.length > 80) {
        reject('The name must be between 3 and 80 characters.');
        continue;
      }
      if (!/[A-Za-z]/.test(fullName)) {
        reject('The name must contain letters.');
        continue;
      }

      let collegeCode = '';
      if (spec.category === 'PED') {
        // A college upload: a blank code means "ours"; a different code is someone else's row
        const typed = get('collegeCode').trim().toUpperCase();
        collegeCode = typed || (opts.forcedCollegeCode || '').trim().toUpperCase();
        if (!collegeCode) {
          reject('No college code. Write the code of the college in the "College Code" column.');
          continue;
        }
        if (opts.forcedCollegeCode && collegeCode !== opts.forcedCollegeCode.toUpperCase()) {
          reject(`This row names college ${collegeCode}; you may only upload your own college (${opts.forcedCollegeCode}).`);
          continue;
        }
        if (opts.knownCollegeCodes && !opts.knownCollegeCodes.has(collegeCode)) {
          reject(`No college with code "${collegeCode}" is registered for the meet.`);
          continue;
        }
      }

      const phone = normalizeDelegatePhone(get('phone'));
      if (phone && !isValidDelegatePhone(phone)) {
        reject(`"${get('phone')}" is not a 10-digit Indian mobile number.`);
        continue;
      }

      let designation = cleanName(get('designation'));
      if (spec.category === 'PED') designation = designation || PED_DESIGNATION;
      if (!designation) {
        reject(spec.category === 'OFFICIAL' ? 'No role. Pick one from the "Role" dropdown.' : 'No designation. Pick one from the "Designation" dropdown.');
        continue;
      }
      if (designation.length > 60) {
        reject('The designation is too long (60 characters at most).');
        continue;
      }

      const key = `${spec.category}|${collegeCode}|${fullName.toUpperCase()}`;
      if (seen.has(key)) {
        reject('The same person is already listed higher up in this sheet.');
        continue;
      }
      seen.add(key);

      rows.push({
        sheet: spec.name,
        excelRow: r,
        // Sheet 3: "Volunteer" as the role makes a volunteer pass
        category: spec.category === 'OFFICIAL' && /^volunteers?$/i.test(designation) ? 'VOLUNTEER' : spec.category,
        collegeCode,
        fullName,
        designation,
        department: cleanName(get('department')).slice(0, 60),
        organisation: cleanName(get('organisation')).slice(0, 80),
        gender: parseGender(get('gender')),
        phone,
        email: cleanEmail(get('email')),
        bloodGroup: parseBloodGroup(get('bloodGroup')),
        scope: cols.scope ? parseScope(get('scope')) : 'BOTH',
        meals: parseYesNo(get('meals'), true),
        accommodation: parseYesNo(get('accommodation'), false),
        remarks: cleanName(get('remarks')).slice(0, 200),
      });
    }
  }

  return { rows, rejected, missingSheets };
}
