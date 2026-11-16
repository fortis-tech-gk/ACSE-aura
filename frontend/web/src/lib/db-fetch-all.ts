/**
 * Whole-table reads from Supabase.
 *
 * PostgREST answers at most 1,000 top-level rows per request (Supabase's default "max rows").
 * A plain `.select()` over the athletes table therefore silently stops at the 1,000th athlete
 * once the meet grows past that — nothing fails, the rest are just missing from the page.
 * These helpers page through a query until it is exhausted. Server-only.
 */

/** Rows per request: Supabase's cap. */
export const SUPABASE_PAGE_SIZE = 1000;

/** Ids per `.in()` filter: keeps the GET URL short (each id is ~37 characters). */
export const IN_FILTER_CHUNK = 150;

interface Pageable {
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

/**
 * Every row of a query. `make` must build a FRESH query each time it is called, ordered by a
 * stable column (`.order('id')`), so consecutive pages never overlap or skip rows.
 */
export async function fetchAllRows<T = unknown>(make: () => Pageable): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await make().range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) return rows;
  }
}

/** `items` split into consecutive groups of at most `size`. */
export function chunk<T>(items: T[], size = IN_FILTER_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `load` once per chunk of `ids` (in parallel) and concatenates the rows. */
export async function fetchInChunks<T>(ids: string[], load: (part: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return [];
  const parts = await Promise.all(chunk(ids).map(load));
  return parts.flat();
}
