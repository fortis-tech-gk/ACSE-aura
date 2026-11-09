/**
 * Supabase returns at most 1000 rows per request. Page through a query until it is exhausted.
 *   const rows = await fetchAll((from, to) => supabase.from('x').select('a').order('id').range(from, to));
 */
const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}
