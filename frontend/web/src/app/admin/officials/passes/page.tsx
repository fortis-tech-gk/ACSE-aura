import { requireAdmin } from '@/lib/auth-guard';
import { listAllDelegatesAction, type AdminDelegateFilters } from '@/app/actions/delegates';
import PassSheet from '@/app/components/idcard/PassSheet';
import type { DelegateCategory } from '@/lib/delegates';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Faculty & Official Passes — VTU SportsOS Admin',
};

export default async function AdminPassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) || '';
  const cat = one('category').toUpperCase();
  const filters: AdminDelegateFilters = {
    category: (['FACULTY', 'PED', 'OFFICIAL'].includes(cat) ? cat : 'ALL') as DelegateCategory | 'ALL',
    college: one('college'),
    q: one('q'),
  };

  const delegates = await listAllDelegatesAction(filters);
  const where = [filters.college, filters.category !== 'ALL' ? filters.category : '', filters.q].filter(Boolean).join(' · ');

  return (
    <PassSheet
      delegates={delegates}
      title="Faculty & Official Passes — 4×6″ Portrait"
      subtitle={`${delegates.length} pass${delegates.length === 1 ? '' : 'es'}${where ? ` · ${where}` : ' · everyone with a pass'}. Cancelled passes are printed with a red "Pass cancelled" chip — leave those out of the envelope.`}
      backHref="/admin/officials"
      backLabel="Back to Faculty & Officials"
    />
  );
}
