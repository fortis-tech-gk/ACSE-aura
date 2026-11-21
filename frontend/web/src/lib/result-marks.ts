/** Typing and showing marks on the admin result pages (same rules as the officials app). */

/** "10.42" -> 10.42 · "1:52.34" or "1.52.34" -> 112.34 · null when it is not a time */
export function parseTime(input: string): number | null {
  const s = input.trim().replace(/,/g, '.');
  if (!s) return null;
  const dotted = /^(\d+)\.(\d{1,2})\.(\d{1,3})$/.exec(s);
  if (dotted) return Number(dotted[1]) * 60 + Number(dotted[2]) + Number(`0.${dotted[3]}`);
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d{1,3})?$/.test(p))) return null;
  let total = 0;
  for (const p of parts) total = total * 60 + Number(p);
  if (parts.length > 1 && Number(parts[parts.length - 1]) >= 60) return null;
  return total > 0 && total < 6 * 3600 ? Math.round(total * 1000) / 1000 : null;
}

export function showTime(sec: number | null | undefined): string {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = (sec - h * 3600 - m * 60).toFixed(2);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${ss.padStart(5, '0')}`;
  if (m) return `${m}:${ss.padStart(5, '0')}`;
  return ss;
}

/** Distance or height in metres: "7.42" -> 7.42 */
export function parseMetres(input: string): number | null {
  const v = Number(input.trim().replace(',', '.'));
  return Number.isFinite(v) && v > 0 && v < 120 ? Math.round(v * 100) / 100 : null;
}
