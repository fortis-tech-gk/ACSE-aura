import { requireAdmin } from '@/lib/auth-guard';
import { listIdCardAthletesAction } from '@/app/actions/admin-operations';
import { athleteFilterOptions, parseAthleteFilters } from '@/lib/admin-athletes';
import IdCardsClient from './IdCardsClient';

export const dynamic = 'force-dynamic';

export default async function AdminIdCardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = parseAthleteFilters(sp);
  // Cards are built only for the chosen college / search, or for the whole meet when "All
  // colleges" is picked explicitly (?college=all) — never thousands of cards on first open.
  const loadAll = sp.college === 'all';
  const wanted = loadAll || Boolean(filters.college || filters.q);
  if (loadAll) filters.college = undefined;

  const [athletes, options] = await Promise.all([
    wanted ? listIdCardAthletesAction(filters) : Promise.resolve(null),
    athleteFilterOptions(),
  ]);

  return (
    <IdCardsClient
      athletes={athletes}
      filters={filters}
      loadAll={loadAll}
      colleges={options.colleges}
      totalAthletes={options.totalAthletes}
    />
  );
}
