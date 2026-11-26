/** Pure helpers for the officials scanners (no React, no storage) */
import { dayKey } from '../format';
import type { AthleteRef, MealType, QueuedScan, RosterAthlete } from './types';

const QR_RE = /^AURA26\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/;

/** Profile id inside an AURA ID-card QR, or null if the code is not one of ours. (The server verifies the signature.) */
export function athleteIdFromQr(data: string): string | null {
  const m = QR_RE.exec(String(data || '').trim());
  return m ? m[1] : null;
}

/** RFC 4122 v4 id for a scan — used by the server to ignore re-sent copies */
export function newScanId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const MEALS: { key: MealType; label: string; icon: string }[] = [
  { key: 'BREAKFAST', label: 'Breakfast', icon: '🍳' },
  { key: 'LUNCH', label: 'Lunch', icon: '🍛' },
  { key: 'SNACKS', label: 'Snacks', icon: '☕' },
  { key: 'DINNER', label: 'Dinner', icon: '🍽️' },
];

/** Meal being served right now (India time): breakfast till 10:30, lunch till 15:30, snacks till 18:30, then dinner */
export function currentMeal(now = new Date()): MealType {
  const ist = new Date(now.getTime() + 330 * 60000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (mins < 10 * 60 + 30) return 'BREAKFAST';
  if (mins < 15 * 60 + 30) return 'LUNCH';
  if (mins < 18 * 60 + 30) return 'SNACKS';
  return 'DINNER';
}

export const istDate = (d = new Date()) => dayKey(d.toISOString());

export type RosterIndex = { byId: Map<string, RosterAthlete>; byBib: Map<number, RosterAthlete> };

export function indexRoster(list: RosterAthlete[]): RosterIndex {
  const byId = new Map<string, RosterAthlete>();
  const byBib = new Map<number, RosterAthlete>();
  for (const a of list) {
    byId.set(a.id, a);
    if (a.bib != null) byBib.set(a.bib, a);
  }
  return { byId, byBib };
}

export function findInRoster(ref: AthleteRef, idx: RosterIndex): RosterAthlete | null {
  if ('qrToken' in ref) {
    const id = athleteIdFromQr(ref.qrToken);
    return id ? idx.byId.get(id) ?? null : null;
  }
  const n = Number(ref.bib);
  return Number.isFinite(n) ? idx.byBib.get(n) ?? null : null;
}

/** Same athlete already given this meal on this device (pending or confirmed) */
export function localMealDuplicate(queue: QueuedScan[], athleteId: string, meal: MealType, date: string): QueuedScan | null {
  return (
    queue.find(
      (q) => q.kind === 'meal' && q.athleteId === athleteId && q.mealType === meal && q.mealDate === date && q.status !== 'rejected'
    ) ?? null
  );
}

/**
 * Meals given on this device: "date|meal|athleteId" -> time scanned (ISO).
 * Kept apart from the scan history, which is trimmed to 800 entries: one food counter can scan
 * thousands of meals a day, and the offline duplicate check must still see all of them.
 */
export type MealLog = Record<string, string>;

export const mealKey = (athleteId: string, meal: MealType, date: string) => `${date}|${meal}|${athleteId}`;

/** Keep only today's and yesterday's meals (dates are India dates, YYYY-MM-DD) */
export function pruneMealLog(log: MealLog, today: string): MealLog {
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const out: MealLog = {};
  for (const [k, v] of Object.entries(log)) {
    const date = k.slice(0, 10);
    if (date === today || date === yesterday) out[k] = v;
  }
  return out;
}

/** How many of this meal were given on this device today */
export function countMeals(log: MealLog, meal: MealType, date: string): number {
  const prefix = `${date}|${meal}|`;
  let n = 0;
  for (const k of Object.keys(log)) if (k.startsWith(prefix)) n++;
  return n;
}

/** Keep every unsynced scan; keep synced history for 2 days, at most 800 entries */
export function pruneQueue(queue: QueuedScan[], now = Date.now()): QueuedScan[] {
  const cutoff = now - 2 * 24 * 3600 * 1000;
  const kept = queue.filter((q) => q.status === 'pending' || new Date(q.scannedAt).getTime() >= cutoff);
  if (kept.length <= 800) return kept;
  const pending = kept.filter((q) => q.status === 'pending');
  const room = 800 - pending.length;
  const rest = room > 0 ? kept.filter((q) => q.status !== 'pending').slice(-room) : [];
  return [...pending, ...rest].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
}
