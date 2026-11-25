import { requireAdmin } from '@/lib/auth-guard';
import { listAthletesPageAction } from '@/app/actions/admin-operations';
import { athleteFilterOptions, parseAthleteFilters } from '@/lib/admin-athletes';
import AthletesClient from './AthletesClient';

export const dynamic = 'force-dynamic';

export default async function AdminAthletesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = parseAthleteFilters(sp);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);

  // Filters run in the database: one page of rows plus the filter choices, read together
  const [{ rows, total }, options] = await Promise.all([listAthletesPageAction(filters, page), athleteFilterOptions()]);

  return (
    <AthletesClient
      athletes={rows}
      filteredTotal={total}
      totalAthletes={options.totalAthletes}
      page={page}
      filters={filters}
      colleges={options.colleges}
      events={options.events}
    />
  );
}
