/** Helpers shared by the call room and referee screens */
import { fmtDay, fmtTime } from '../format';
import type { HeatSummary } from './types';

export const STAGE: Record<string, string> = { HEATS: 'Heat', SEMI_FINAL: 'Semi-final', FINAL: 'Final', QUALIFYING: 'Qualifying' };

export const HEAT_STATUS: Record<string, { label: string; tone: 'grey' | 'blue' | 'amber' | 'green' }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'grey' },
  CALL_ROOM: { label: 'Call room open', tone: 'blue' },
  ON_TRACK: { label: 'Sent to track', tone: 'amber' },
  IN_PROGRESS: { label: 'In progress', tone: 'amber' },
  COMPLETED: { label: 'Results done', tone: 'green' },
  OFFICIAL: { label: 'Official', tone: 'green' },
};

/** "100m Men · Heat 2" / "Long Jump Women · Final" */
export function heatTitle(h: Pick<HeatSummary, 'eventName' | 'stage' | 'heatNumber'>): string {
  return `${h.eventName} · ${stageLabel(h.stage, h.heatNumber)}`;
}

/** "Heat 2", "Semi-final 1", "Final" (a single final has no number) */
export function stageLabel(stage: string, n: number): string {
  const name = STAGE[stage] || stage;
  return stage === 'FINAL' && n === 1 ? name : `${name} ${n}`;
}

export function whenLine(h: Pick<HeatSummary, 'startAt' | 'callRoomAt'>): string {
  if (!h.startAt) return 'Time not set yet';
  return `${fmtDay(h.startAt)} · Start ${fmtTime(h.startAt)}${h.callRoomAt ? ` · Call room ${fmtTime(h.callRoomAt)}` : ''}`;
}

/** Supabase returns a one-to-one child as an object or a one-item array — read either */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * Hand-timed or electronic time typed by a referee → seconds.
 *   "10.42" → 10.42 · "52.1" → 52.1 · "1:52.34" → 112.34 · "1.52.34" → 112.34 · "1:15:21.5" → 4521.5
 */
export function parseTime(input: string): number | null {
  const s = input.trim().replace(/,/g, '.');
  if (!s) return null;
  // Allow "1.52.34" (dots as separators) as minutes.seconds.hundredths
  const dotted = /^(\d+)\.(\d{1,2})\.(\d{1,3})$/.exec(s);
  if (dotted) return Number(dotted[1]) * 60 + Number(dotted[2]) + Number(`0.${dotted[3]}`);
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d{1,3})?$/.test(p))) return null;
  let total = 0;
  for (const p of parts) total = total * 60 + Number(p);
  if (parts.length > 1 && Number(parts[parts.length - 1]) >= 60) return null;
  return total > 0 && total < 6 * 3600 ? Math.round(total * 1000) / 1000 : null;
}

/** "10.42" / "1:52.34" — seconds shown the way they are written on a result sheet */
export function showTime(sec: number | null | undefined): string {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const rest = sec - h * 3600 - m * 60;
  const ss = rest.toFixed(2);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${ss.padStart(5, '0')}`;
  if (m) return `${m}:${ss.padStart(5, '0')}`;
  return ss;
}

/** Distance or height typed in metres: "7.42" → 7.42 (0.01–120 m) */
export function parseMetres(input: string): number | null {
  const v = Number(input.trim().replace(',', '.'));
  return Number.isFinite(v) && v > 0 && v < 120 ? Math.round(v * 100) / 100 : null;
}

