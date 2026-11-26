/**
 * Official result sheets for finished FINALs, in two formats (one event per page):
 *
 *   full — every finalist in lane / competition order with the rank beside each row;
 *   top3 — the medal winners in place order with bib, photo, name, USN, college, contact
 *          number and performance (relay teams list their runners).
 *
 * Each page carries the meet header and five signature boxes. Pure: no database access, so the
 * admin print route and the sample script render exactly the same sheet.
 */

export type SheetFormat = 'full' | 'top3';

export interface SheetPerson {
  bib: number | null;
  name: string;
  usn: string;
  phone: string;
  photo: string | null;
}

export interface SheetRow extends SheetPerson {
  /** Lane (track) or competition order (field, distance, road, combined) */
  order: number | null;
  college: string;
  collegeCode: string;
  /** Performance as printed, e.g. 10.84 · 6.45 m · 6512 pts · DNF */
  mark: string;
  note: string;
  /** Final place (ties share), null when not placed (DNF, DNS, DQ, NM, not classified) */
  place: number | null;
  /** Relay teams: the runners in leg order */
  runners?: SheetPerson[];
}

export interface SheetSection {
  /** e.g. "Final" or "Final — Section 2" */
  label: string;
  /** In lane / competition order */
  rows: SheetRow[];
}

export interface EventSheet {
  code: string;
  name: string;
  gender: string | null;
  category: string;
  when: string | null;
  wind: string | null;
  sections: SheetSection[];
}

/** The five officials who sign every result sheet */
export const RESULT_SIGNATORIES = [
  'REFEREE',
  'CHIEF JUDGE',
  'COMPETITION DIRECTOR',
  'TECHNICAL DELEGATE (VTU)',
  'ORGANISING SECRETARY',
];

export const RESULT_MEET = {
  university: 'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI',
  title: '28th VTU Inter-Collegiate State Level Athletic Meet 2026',
  brand: 'Dr. ACS-AURA 2026',
  host: 'Organised by Dr. ACS College of Engineering, Bengaluru',
  dates: '7–10 December 2026',
};

const GROUP: Record<string, string> = { men: 'MEN', women: 'WOMEN', mixed: 'MIXED' };

/** Running order of events in a printed pack: sprints, hurdles, distance, road, relays, jumps, throws, combined */
const CATEGORY_ORDER: Record<string, number> = {
  track_sprint: 1,
  track_hurdles: 2,
  track_distance: 3,
  road: 4,
  relay: 5,
  field_vertical_jump: 6,
  field_horizontal_jump: 7,
  field_throw: 8,
  combined: 9,
};

export function sortEventSheets<T extends { code: string; category: string; gender?: string | null }>(events: T[]): T[] {
  const dist = (code: string) => Number((code.match(/^(?:4X)?(\d+)/i) || [])[1] || 0);
  return [...events].sort(
    (a, b) =>
      (a.gender === 'mixed' ? 1 : 0) - (b.gender === 'mixed' ? 1 : 0) ||
      (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99) ||
      dist(a.code) - dist(b.code) ||
      a.code.localeCompare(b.code)
  );
}

/** Lanes for races run in lanes; competition order for everything else */
export function orderLabel(category: string): string {
  return ['track_sprint', 'track_hurdles', 'relay'].includes(category) ? 'LANE' : 'ORDER';
}

export function showTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec - h * 3600) / 60);
  const s = sec - h * 3600 - m * 60;
  const ss = s.toFixed(2).padStart(5, '0');
  if (h) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return m ? `${m}:${ss}` : s.toFixed(2);
}

/**
 * Places from a value (lower is better for times, higher for marks). Equal values share the
 * place and the next place is skipped (RANK), the same rule the points table uses.
 */
export function placesByValue<T>(items: T[], value: (t: T) => number | null, higherIsBetter: boolean): Map<T, number> {
  const scored = items.filter((t) => value(t) != null).sort((a, b) => (higherIsBetter ? value(b)! - value(a)! : value(a)! - value(b)!));
  const out = new Map<T, number>();
  scored.forEach((t, i) => out.set(t, i > 0 && value(scored[i - 1]) === value(t) ? out.get(scored[i - 1])! : i + 1));
  return out;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const PLACE_TEXT: Record<number, string> = { 1: '1st · GOLD', 2: '2nd · SILVER', 3: '3rd · BRONZE' };

function photoCell(p: SheetPerson): string {
  return p.photo ? `<img class="ph" src="${esc(p.photo)}" alt="">` : '<div class="ph none">No photo</div>';
}

function header(ev: EventSheet, title: string, logos: { vtu: string; acs: string }): string {
  const info: [string, string][] = [
    ['EVENT No.', ev.code],
    ['EVENT', ev.name.toUpperCase()],
    ['GROUP', GROUP[ev.gender || ''] || ''],
    ['ROUND', 'FINAL'],
    ['DATE &amp; TIME', ev.when ? esc(ev.when) : '&nbsp;'],
    ...(ev.wind ? ([['WIND', esc(ev.wind)]] as [string, string][]) : []),
  ];
  return `
  <div class="hdr">
    <img class="logo" src="${esc(logos.vtu)}" alt="VTU">
    <div class="hc">
      <div class="u">${esc(RESULT_MEET.university)}</div>
      <div class="m">${esc(RESULT_MEET.title)}</div>
      <div class="b">${esc(RESULT_MEET.brand)}</div>
      <div class="o">${esc(RESULT_MEET.host)} · ${esc(RESULT_MEET.dates)}</div>
    </div>
    <img class="logo" src="${esc(logos.acs)}" alt="Dr. ACS College of Engineering">
  </div>
  <div class="banner">${title}</div>
  <table class="info"><tr>${info.map(([k, v]) => `<td><div class="k">${k}</div><div class="v">${k === 'EVENT No.' || k === 'EVENT' ? esc(v) : v}</div></td>`).join('')}</tr></table>`;
}

function signatures(): string {
  return `<div class="sigs">${RESULT_SIGNATORIES.map(
    (r) => `<div class="sig"><div class="sigt">${esc(r)}</div><div class="line">Name:</div><div class="line">Signature:</div></div>`
  ).join('')}</div>`;
}

function fullSheet(ev: EventSheet): string {
  const relay = ev.category === 'relay';
  const sections = ev.sections
    .map((s) => {
      const body = s.rows
        .map((r) => {
          const who = relay
            ? `<div class="nm">${esc(r.college)}</div>${
                r.runners?.length
                  ? `<div class="sub">${r.runners.map((p, i) => `${i + 1}. ${esc(p.name)}${p.bib ? ` (${p.bib})` : ''}`).join(' · ')}</div>`
                  : ''
              }`
            : `<div class="nm">${esc(r.name)}</div><div class="sub">${esc(r.usn)}</div>`;
          return `<tr${r.place != null && r.place <= 3 ? ' class="medal"' : ''}>
            <td>${r.order ?? ''}</td>
            <td>${relay ? '' : r.bib ?? ''}</td>
            <td class="l">${who}</td>
            <td class="l">${relay ? esc(r.collegeCode) : `${esc(r.college)}`}</td>
            <td class="mk">${esc(r.mark)}</td>
            <td class="l sm">${esc(r.note)}</td>
            <td class="rk">${r.place ?? '—'}</td>
          </tr>`;
        })
        .join('');
      return `${ev.sections.length > 1 ? `<h3>${esc(s.label)}</h3>` : ''}
      <table class="grid">
        <thead><tr>
          <th style="width:9%">${orderLabel(ev.category)}</th>
          <th style="width:8%">BIB No.</th>
          <th>${relay ? 'TEAM / RUNNERS' : 'NAME OF THE ATHLETE / USN'}</th>
          <th style="width:${relay ? 10 : 26}%">${relay ? 'CODE' : 'COLLEGE'}</th>
          <th style="width:12%">PERFORMANCE</th>
          <th style="width:10%">REMARKS</th>
          <th style="width:8%">RANK</th>
        </tr></thead>
        <tbody>${body || '<tr><td colspan="7">No finalists.</td></tr>'}</tbody>
      </table>`;
    })
    .join('');
  const multi = ev.sections.length > 1 ? '<div class="note">Final run in sections: ranks are across all sections, by performance.</div>' : '';
  return sections + multi;
}

function top3Sheet(ev: EventSheet): string {
  const placed = ev.sections
    .flatMap((s) => s.rows)
    .filter((r) => r.place != null && r.place <= 3)
    .sort((a, b) => a.place! - b.place! || a.name.localeCompare(b.name));
  if (!placed.length) return '<p class="none-msg">No athlete was placed in this final.</p>';
  if (ev.category === 'relay') {
    // One row per team, its runners side by side, so three teams fit on one page
    const rows = placed
      .map(
        (r) => `<tr class="p${r.place}">
        <td class="pos">${esc(PLACE_TEXT[r.place!] || r.place)}</td>
        <td class="l"><div class="nm">${esc(r.college)}</div><div class="sub">${esc(r.collegeCode)}</div></td>
        <td class="rcell"><div class="runners">${(r.runners || [])
          .map(
            (p, i) => `<div class="rc">${photoCell(p)}<div class="rn">${i + 1}. ${esc(p.name)}</div><div class="sub">${esc(p.usn)}${p.bib ? ` · Bib ${p.bib}` : ''}</div><div class="sub">${esc(p.phone)}</div></div>`
          )
          .join('') || '<span class="sub">Runners not recorded</span>'}</div></td>
        <td class="mk">${esc(r.mark)}</td>
      </tr>`
      )
      .join('');
    return `<table class="grid top3">
      <thead><tr>
        <th style="width:11%">POSITION</th>
        <th style="width:17%">COLLEGE</th>
        <th>RUNNERS (BIB No., PHOTO, NAME, USN, CONTACT No.)</th>
        <th style="width:11%">PERFORMANCE</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }
  const body = placed
    .map((r) => {
      const people: SheetPerson[] = ev.category === 'relay' ? (r.runners?.length ? r.runners : [{ bib: null, name: `${r.collegeCode} relay team`, usn: '', phone: '', photo: null }]) : [r];
      return people
        .map(
          (p, i) => `<tr class="p${r.place}">
          ${i === 0 ? `<td class="pos" rowspan="${people.length}">${esc(PLACE_TEXT[r.place!] || r.place)}</td>` : ''}
          <td>${p.bib ?? ''}</td>
          <td class="phc">${photoCell(p)}</td>
          <td class="l"><div class="nm">${esc(p.name)}</div></td>
          <td>${esc(p.usn)}</td>
          ${i === 0 ? `<td class="l" rowspan="${people.length}">${esc(r.college)}</td>` : ''}
          <td>${esc(p.phone)}</td>
          ${i === 0 ? `<td class="mk" rowspan="${people.length}">${esc(r.mark)}</td>` : ''}
        </tr>`
        )
        .join('');
    })
    .join('');
  return `<table class="grid top3">
    <thead><tr>
      <th style="width:11%">POSITION</th>
      <th style="width:7%">BIB No.</th>
      <th style="width:11%">PHOTO</th>
      <th>NAME</th>
      <th style="width:13%">USN</th>
      <th style="width:20%">COLLEGE</th>
      <th style="width:11%">CONTACT No.</th>
      <th style="width:11%">PERFORMANCE</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function renderResultSheets(opts: {
  format: SheetFormat;
  events: EventSheet[];
  logos: { vtu: string; acs: string };
  generatedAt: string;
  /** Marks every page as a sample with dummy performances */
  sample?: boolean;
  /** Show a "Print / Save as PDF" bar on screen */
  toolbar?: boolean;
}): string {
  const { format, events, logos } = opts;
  const title = format === 'full' ? 'OFFICIAL RESULT — FINAL' : 'MEDAL WINNERS — FINAL';
  const docTitle = format === 'full' ? 'Official Results' : 'Medal Winners';
  const pages = sortEventSheets(events)
    .map(
      (ev) => `<section class="page">
        ${opts.sample ? '<div class="wm">SAMPLE</div><div class="samp">SAMPLE — real registered athletes, DUMMY performances. Not an official result.</div>' : ''}
        ${header(ev, title, logos)}
        ${format === 'full' ? fullSheet(ev) : top3Sheet(ev)}
        ${signatures()}
        <div class="foot">${esc(RESULT_MEET.brand)} · ${esc(ev.code)} ${esc(ev.name)} · Generated ${esc(opts.generatedAt)} · AURA SportsOS</div>
      </section>`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle} — ${esc(RESULT_MEET.brand)}</title>
<style>
  @page { size: A4 portrait; margin: 9mm 9mm 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 11px; background: #fff; }
  .bar { position: sticky; top: 0; background: #0f172a; color: #fff; padding: 10px 16px; display: flex; gap: 12px; align-items: center; z-index: 5; }
  .bar button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-weight: 700; cursor: pointer; }
  .page { position: relative; page-break-after: always; padding: 0; }
  .page:last-child { page-break-after: auto; }
  @media screen { .page { max-width: 210mm; margin: 12px auto; padding: 9mm; box-shadow: 0 1px 6px rgba(0,0,0,.15); } }
  @media print { .bar { display: none; } }
  .hdr { display: flex; align-items: center; gap: 10px; border-bottom: 3px double #111; padding-bottom: 6px; }
  .logo { width: 62px; height: 62px; object-fit: contain; }
  .hc { flex: 1; text-align: center; line-height: 1.3; }
  .hc .u { font-size: 15px; font-weight: 900; letter-spacing: .4px; }
  .hc .m { font-size: 12.5px; font-weight: 800; }
  .hc .b { font-size: 12px; font-weight: 800; color: #9f1239; }
  .hc .o { font-size: 10px; color: #374151; }
  .banner { margin: 7px 0 6px; text-align: center; font-size: 15px; font-weight: 900; letter-spacing: 1px; border: 2px solid #111; padding: 5px; background: #f3f4f6; }
  table { width: 100%; border-collapse: collapse; }
  .info td { border: 1px solid #374151; padding: 3px 5px; vertical-align: top; }
  .info .k { font-size: 8px; font-weight: 800; color: #4b5563; }
  .info .v { font-size: 11.5px; font-weight: 800; }
  .grid { margin-top: 7px; }
  .grid th, .grid td { border: 1px solid #374151; padding: 3px 4px; text-align: center; vertical-align: middle; }
  .grid th { background: #e5e7eb; font-size: 9px; font-weight: 900; }
  .grid thead { display: table-header-group; }
  .grid tr { page-break-inside: avoid; }
  .grid td { font-size: 10.5px; height: 22px; }
  .grid td.l { text-align: left; }
  .grid td.sm { font-size: 9px; }
  .grid .nm { font-weight: 700; }
  .grid .sub { font-size: 8.5px; color: #4b5563; }
  .grid td.mk { font-weight: 800; font-size: 11.5px; }
  .grid td.rk { font-weight: 900; font-size: 13px; }
  .grid tr.medal td { background: #fefce8; }
  .top3 td { height: auto; }
  .top3 td.pos { font-weight: 900; font-size: 11px; }
  .top3 tr.p1 td.pos { background: #fde68a; }
  .top3 tr.p2 td.pos { background: #e5e7eb; }
  .top3 tr.p3 td.pos { background: #fed7aa; }
  .phc { padding: 2px !important; }
  .ph { width: 20mm; height: 25mm; object-fit: cover; display: block; margin: 0 auto; border: 1px solid #9ca3af; }
  .ph.none { display: flex; align-items: center; justify-content: center; font-size: 8px; color: #6b7280; background: #f9fafb; }
  .rcell { padding: 4px !important; }
  .runners { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .rc { text-align: center; font-size: 9px; }
  .rc .ph { width: 16mm; height: 20mm; }
  .rc .rn { font-weight: 700; margin-top: 2px; }
  h3 { font-size: 11.5px; margin: 9px 0 0; text-transform: uppercase; }
  .note { font-size: 9px; color: #4b5563; margin-top: 4px; }
  .none-msg { margin: 18px 0; text-align: center; font-weight: 700; color: #4b5563; }
  .sigs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 16px; page-break-inside: avoid; }
  .sig { border: 1px solid #111; padding: 5px 6px; min-height: 30mm; display: flex; flex-direction: column; }
  .sigt { text-align: center; font-weight: 900; font-size: 8.5px; min-height: 22px; }
  .line { font-size: 9px; font-weight: 700; margin-top: 10px; border-bottom: 1px dotted #6b7280; padding-bottom: 8px; }
  .foot { margin-top: 6px; font-size: 8px; color: #6b7280; text-align: right; }
  .samp { background: #fee2e2; color: #991b1b; font-weight: 800; text-align: center; font-size: 9.5px; padding: 3px; margin-bottom: 4px; border: 1px solid #fca5a5; }
  .wm { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 110px; font-weight: 900; color: rgba(220, 38, 38, .07); transform: rotate(-30deg); pointer-events: none; z-index: 0; }
</style></head><body>
${opts.toolbar ? `<div class="bar"><strong>${docTitle} · ${events.length} event${events.length === 1 ? '' : 's'}</strong><button onclick="window.print()">Print / Save as PDF</button><span style="font-size:12px;opacity:.8">Choose "Save as PDF" as the printer, A4 portrait.</span></div>` : ''}
${pages || '<section class="page"><p class="none-msg">No finished final yet for this selection. A final appears here once its referee finalizes it in the Officials app.</p></section>'}
</body></html>`;
}
