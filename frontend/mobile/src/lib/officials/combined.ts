/**
 * Decathlon / Heptathlon scoring on the referee tablet. The coefficients come from the server
 * (combined_disciplines, migration 0045), so there is one table, in the database. The server
 * always recomputes the points when a mark is saved — this is only the preview while typing.
 *
 *   track: floor(A × (B − P)^C)      P = seconds
 *   field: floor(A × (P − B)^C)      P = cm for jumps, metres for throws (mark_scale converts)
 */
export type Discipline = {
  event_code: string;
  seq: number;
  code: string;
  name: string;
  day: number;
  kind: 'track' | 'field';
  unit: 's' | 'm';
  mark_scale: number | string;
  a: number | string;
  b: number | string;
  c: number | string;
};

export type CombinedStatus = 'FINISHED' | 'NM' | 'DNF' | 'DQ' | 'DNS';
export type CombinedMark = { status: CombinedStatus; mark: number | null; points: number };

export function previewPoints(d: Discipline, mark: number | null): number {
  if (mark == null || mark <= 0) return 0;
  // Field marks are measured to the cm (rounded down); times are rounded up to the next 0.01 s
  const m = d.kind === 'field' ? Math.floor(mark * 100 + 1e-6) / 100 : Math.ceil(mark * 100 - 1e-6) / 100;
  const p = m * Number(d.mark_scale);
  const diff = d.kind === 'track' ? Number(d.b) - p : p - Number(d.b);
  return diff <= 0 ? 0 : Math.floor(Number(d.a) * Math.pow(diff, Number(d.c)));
}

export type StandingRow = { id: string; total: number; done: number; classified: boolean; rank: number | null };

/**
 * Totals and places from the marks entered so far. Same rules as the server: classified = a result
 * in every discipline and none DNS / DNF / DQ; equal totals → more disciplines won; then shared.
 */
export function standingsOf(ids: string[], discs: Discipline[], pts: (id: string, disc: string) => CombinedMark | undefined): StandingRow[] {
  const rows = ids.map((id) => {
    let total = 0;
    let done = 0;
    let out = 0;
    for (const d of discs) {
      const r = pts(id, d.code);
      if (!r) continue;
      done++;
      total += r.points;
      if (r.status === 'DNS' || r.status === 'DNF' || r.status === 'DQ') out++;
    }
    return { id, total, done, classified: done === discs.length && out === 0, rank: null as number | null };
  });
  const wins = (a: string, b: string) => discs.filter((d) => (pts(a, d.code)?.points ?? 0) > (pts(b, d.code)?.points ?? 0)).length;
  for (const x of rows) {
    if (!x.classified) continue;
    x.rank =
      1 +
      rows.filter((y) => y.classified && y.id !== x.id && (y.total > x.total || (y.total === x.total && wins(y.id, x.id) > wins(x.id, y.id)))).length;
  }
  return rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.total - a.total);
}
