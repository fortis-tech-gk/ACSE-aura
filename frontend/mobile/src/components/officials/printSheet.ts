/**
 * Printable copy of a referee score sheet (AFI layout, docs/score-sheet.pdf).
 * The on-screen sheet has no signature boxes; the printed / saved PDF adds them at the bottom
 * so the officials can sign the paper copy.
 *
 * Phone: opens the system print dialog (any printer, or "Save as PDF").
 * Web:   opens the sheet in a new window and prints it.
 */
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import { MEET } from '@/lib/config';
import { fmtDay, fmtTime } from '@/lib/format';
import type { SheetHeat } from './ScoreSheet';

export type PrintCol = { title: string; sub?: string };
export type PrintRow = { cells: (string | number | null | undefined)[]; shaded?: boolean[]; dim?: boolean };
export type PrintTable = { heading?: string; groups?: { title: string; span: number }[]; cols: PrintCol[]; rows: PrintRow[] };
export type PrintSheet = {
  title: string;
  heat: SheetHeat;
  startAt?: string | null;
  note?: string;
  tables: PrintTable[];
  /** Signature boxes, e.g. ['REFEREE', 'CHIEF JUDGE'] — the first is pre-filled with the referee's name */
  signatures: string[];
  referee: string;
};

const STAGE_TEXT: Record<string, string> = { HEATS: 'HEAT', SEMI_FINAL: 'SEMI-FINAL', FINAL: 'FINAL', QUALIFYING: 'QUALIFYING' };
const GROUP: Record<string, string> = { men: 'MEN', women: 'WOMEN', mixed: 'MIXED' };

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function table(t: PrintTable): string {
  const groups = t.groups
    ? `<tr>${t.groups.map((g) => `<th colspan="${g.span}" class="grp">${esc(g.title)}</th>`).join('')}</tr>`
    : '';
  const head = `<tr>${t.cols.map((c) => `<th>${esc(c.title)}${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ''}</th>`).join('')}</tr>`;
  // Name columns read left to right; everything else is centred like the paper card
  const left = new Set(t.cols.map((c, i) => (/NAME/.test(c.title) ? i : -1)).filter((i) => i >= 0));
  const body = t.rows
    .map(
      (r) =>
        `<tr${r.dim ? ' class="dim"' : ''}>${r.cells
          .map((c, i) => {
            const cls = [r.shaded?.[i] ? 'shade' : '', left.has(i) ? 'l' : ''].filter(Boolean).join(' ');
            return `<td${cls ? ` class="${cls}"` : ''}>${esc(c)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');
  return `${t.heading ? `<h3>${esc(t.heading)}</h3>` : ''}<table>${groups}${head}${body}</table>`;
}

export function sheetHtml(p: PrintSheet): string {
  const stage = STAGE_TEXT[p.heat.stage] || p.heat.stage;
  const stageCell = ['HEAT', 'SEMI-FINAL', 'FINAL']
    .map((k) => (stage === k ? `<b><u>${k}${k !== 'FINAL' ? ` ${p.heat.heat_number}` : ''}</u></b>` : `<span class="off">${k}</span>`))
    .join(' / ');
  const info = [
    ['EVENT No.', p.heat.events.code],
    ['EVENT', p.heat.events.name.toUpperCase()],
    ['DATE', p.startAt ? fmtDay(p.startAt) : ''],
    ['GROUP', GROUP[p.heat.events.gender || ''] || ''],
    ['TIME Hrs.', p.startAt ? fmtTime(p.startAt) : ''],
  ]
    .map(([k, v]) => `<td><div class="k">${k}</div><div class="v">${esc(v)}</div></td>`)
    .join('');
  const sigs = p.signatures
    .map(
      (r, i) => `<div class="sig"><div class="sigt">${esc(r)}</div>
        <div class="line">NAME: <span>${i === 0 ? esc(p.referee) : ''}</span></div>
        <div class="line">SIGNATURE:</div></div>`
    )
    .join('');
  const printed = new Date().toLocaleString('en-IN', { timeZone: MEET.timeZone, dateStyle: 'medium', timeStyle: 'short' });

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.title)} — ${esc(p.heat.events.code)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 11px; }
  .fed { text-align: center; font-size: 16px; font-weight: 900; letter-spacing: 1px; }
  .meta { margin: 2px 0 4px; line-height: 1.35; }
  .meta b { font-weight: 800; }
  .banner { border: 2px dashed #111; text-align: center; font-size: 17px; font-weight: 900; padding: 5px; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #374151; padding: 2px 3px; text-align: center; vertical-align: middle; }
  th { background: #f3f4f6; font-size: 9.5px; font-weight: 900; }
  th.grp { background: #fff; }
  .sub { font-size: 8.5px; font-weight: 700; color: #4b5563; }
  td { font-size: 10.5px; font-weight: 600; height: 19px; }
  td.l { text-align: left; }
  td.shade { background: #e5e7eb; }
  tr.dim td { color: #6b7280; }
  .info td { text-align: left; width: 16.6%; }
  .info .k { font-size: 8.5px; font-weight: 800; color: #4b5563; }
  .info .v { font-size: 12px; font-weight: 800; }
  .off { color: #9ca3af; }
  h3 { text-align: center; font-style: italic; font-size: 13px; margin: 8px 0 4px; }
  .note { font-size: 9.5px; color: #4b5563; margin: 2px 0 8px; }
  .sigs { display: flex; gap: 10px; margin-top: 10px; page-break-inside: avoid; }
  .sig { flex: 1; border: 1.5px dashed #111; padding: 6px 10px; min-height: 92px; }
  .sigt { text-align: center; font-weight: 900; font-size: 11px; margin-bottom: 6px; }
  .line { font-size: 11px; font-weight: 800; margin-top: 16px; }
  .line span { font-weight: 600; }
  .foot { margin-top: 6px; font-size: 8.5px; color: #6b7280; text-align: right; }
</style></head><body>
  <div class="fed">ATHLETICS FEDERATION OF INDIA</div>
  <div class="meta">
    <div><b>Event Name:</b> ${esc(MEET.subtitle)} (${esc(MEET.name)})</div>
    <div><b>Venue &amp; Date:</b> ${esc(MEET.venue)} · ${esc(MEET.dates)}</div>
    <div><b>Organised by:</b> Visvesvaraya Technological University, Belagavi</div>
  </div>
  <div class="banner">${esc(p.title)}</div>
  <table class="info"><tr>${info}<td><div class="k">HEAT No. / SEMI-FINAL / FINAL</div><div class="v">${stageCell}</div></td></tr></table>
  ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
  ${p.tables.map(table).join('')}
  <div class="sigs">${sigs}</div>
  <div class="foot">Printed ${esc(printed)} · AURA Officials</div>
</body></html>`;
}

/** Print the sheet, or save it as a PDF from the print dialog */
export async function printSheet(p: PrintSheet): Promise<void> {
  const html = sheetHtml(p);
  if (Platform.OS === 'web') {
    // expo-print on web only prints the current page, so print the sheet from its own window
    const w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (!w) throw new Error('Allow pop-ups for this site to print the sheet.');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
    return;
  }
  await Print.printAsync({ html, orientation: Print.Orientation.landscape });
}
