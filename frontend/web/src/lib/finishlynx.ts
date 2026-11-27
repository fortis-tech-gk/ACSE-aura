/**
 * FinishLynx (Lynx System Developers) file formats for the photo finish desk.
 *
 *   Start list  (.lif single heat / .evt several heats) — we send this to the vendor:
 *       <event no>,<round>,<heat>,<event name>
 *       ,<bib>,<lane>,<last name>,<first name>,<college>
 *   Results (.lif)  — the vendor sends this back:
 *       <event no>,<round>,<heat>,<event name>,<wind>
 *       <place>,<bib>,<lane>,<last name>,<first name>,<college>,<time>
 *   Athlete list for pre-loading the day before (.ppl):
 *       <bib>,<last name>,<first name>,<college>
 *
 * Written from the standard FinishLynx layout; to be checked against the vendor's own sample
 * files (the column order is the only thing that can differ). Parsing the results is tolerant:
 * a comma separated file with a header row (bib, lane, time, status) is accepted too.
 */
import { parseTime } from './result-marks';

/** Same rule as is_heat_event() in the database: only these events have heats and rounds */
export const isHeatEvent = (code: string | null | undefined) => /^(100M|200M|400M|800M|1500M|110H|100H|400H|4X)/i.test(String(code || ''));

export const ROUND_NO: Record<string, number> = { QUALIFYING: 1, HEATS: 1, SEMI_FINAL: 2, FINAL: 3 };

export type LifEntry = {
  lane: number;
  /** Bib number; for a relay team the college code */
  id: string;
  /** Whole name goes in the last-name column (the full name as on the SSLC certificate) */
  name: string;
  college: string;
};

export type LifHeat = {
  eventNo: number;
  stage: string;
  heatNumber: number;
  eventName: string;
  entries: LifEntry[];
};

/** One field: no separators, and no leading = + - @ (a spreadsheet would run it as a formula) */
const clean = (v: unknown) => String(v ?? '').replace(/[,\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '');

/** Start list: one header line per heat, then one line per lane */
export function buildStartList(heats: LifHeat[]): string {
  const lines: string[] = [];
  for (const h of heats) {
    lines.push([h.eventNo, ROUND_NO[h.stage] ?? 1, h.heatNumber, clean(h.eventName)].join(','));
    for (const e of [...h.entries].sort((a, b) => a.lane - b.lane)) {
      lines.push(['', clean(e.id), e.lane, clean(e.name), '', clean(e.college)].join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/** Athletes the vendor loads once, the day before (bib, name, college) */
export function buildPeopleList(people: { id: string; name: string; college: string }[]): string {
  return people.map((p) => [clean(p.id), clean(p.name), '', clean(p.college)].join(',')).join('\r\n') + '\r\n';
}

export type ParsedResultRow = {
  line: number;
  bib: string;
  lane: number | null;
  /** Time exactly as written in the file */
  timeText: string;
  status: 'FINISHED' | 'DNF' | 'DQ' | 'DNS';
};

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === ',' && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function statusOf(...cells: string[]): ParsedResultRow['status'] | null {
  for (const c of cells) {
    const u = c.trim().toUpperCase();
    if (u === 'DNS') return 'DNS';
    if (u === 'DNF') return 'DNF';
    if (u === 'DQ' || u === 'DSQ' || u === 'DQ.') return 'DQ';
  }
  return null;
}

/**
 * Results file from the vendor. Either the FinishLynx layout (first line = heat header, then
 * place,bib,lane,last,first,college,time) or a CSV with a header row naming bib / lane / time / status.
 */
export function parseResultsFile(text: string): ParsedResultRow[] {
  const raw = text.replace(/^﻿/, '').split(/\r?\n/);
  const lines = raw.map((l, i) => ({ l: l.trim(), n: i + 1 })).filter((x) => x.l);
  if (!lines.length) return [];

  const first = splitCsv(lines[0].l).map((c) => c.toLowerCase());
  const col = (...names: string[]) => first.findIndex((c) => names.includes(c));
  const bibCol = col('bib', 'id', 'bib no', 'bibno', 'bid');
  const laneCol = col('lane');
  const timeCol = col('time', 'result', 'mark');
  const statusCol = col('status');
  const headed = (bibCol >= 0 || laneCol >= 0) && (timeCol >= 0 || statusCol >= 0);

  const rows: ParsedResultRow[] = [];
  if (headed) {
    for (const { l, n } of lines.slice(1)) {
      const f = splitCsv(l);
      const timeText = timeCol >= 0 ? f[timeCol] || '' : '';
      const st = statusOf(statusCol >= 0 ? f[statusCol] || '' : '', timeText) || 'FINISHED';
      const lane = laneCol >= 0 && /^\d+$/.test(f[laneCol] || '') ? Number(f[laneCol]) : null;
      rows.push({ line: n, bib: bibCol >= 0 ? f[bibCol] || '' : '', lane, timeText: st === 'FINISHED' ? timeText : '', status: st });
    }
    return rows;
  }

  // FinishLynx layout: skip the heat header line, then place,bib,lane,last,first,college,time
  for (const { l, n } of lines.slice(1)) {
    const f = splitCsv(l);
    if (f.length < 3) continue;
    const timeText = f[6] || '';
    const st = statusOf(f[0], timeText) || 'FINISHED';
    rows.push({
      line: n,
      bib: f[1] || '',
      lane: /^\d+$/.test(f[2] || '') ? Number(f[2]) : null,
      timeText: st === 'FINISHED' ? timeText : '',
      status: st,
    });
  }
  return rows;
}

/**
 * A time as the vendor wrote it → seconds stored. Electronic times given to a thousandth are
 * taken to the next longer hundredth (World Athletics way of recording track times).
 */
export function lifTimeToSeconds(text: string): number | null {
  // "10.42Q", "10.42 q", "10.42 PB" — drop the qualifier / record note after the time
  const t = parseTime(text.trim().replace(/\s*[A-Za-z]{1,3}$/, ''));
  if (t == null) return null;
  const ms = Math.round(t * 1000);
  return Math.ceil(ms / 10) / 100;
}

/** Heat sheet lines the admin types in manual mode: "lane bib" or "lane,bib" per line */
export function parseLaneBibText(text: string): { lane: number; bib: string; line: number }[] | { error: string } {
  const out: { lane: number; bib: string; line: number }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s) continue;
    const m = /^(\d{1,2})\s*[,\s:;=\-\t]+\s*([A-Za-z0-9]+)$/.exec(s);
    if (!m) return { error: `Line ${i + 1} ("${s}"): write the lane, then the bib — for example "4 1207".` };
    out.push({ lane: Number(m[1]), bib: m[2].toUpperCase(), line: i + 1 });
  }
  return out;
}
