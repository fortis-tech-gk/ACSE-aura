import { requireAdmin } from '@/lib/auth-guard';
import { listAllDelegatesAction, type AdminDelegateFilters } from '@/app/actions/delegates';
import PassSheet from '@/app/components/idcard/PassSheet';
import { CATEGORY_LABEL, type DelegateCategory } from '@/lib/delegates';

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
  const names = one('names');
  const filters: AdminDelegateFilters = {
    category: (['FACULTY', 'PED', 'VOLUNTEER', 'OFFICIAL'].includes(cat) ? cat : 'ALL') as DelegateCategory | 'ALL',
    college: one('college'),
    q: one('q'),
    names: names === 'blank' || names === 'named' ? names : '',
  };

  const delegates = await listAllDelegatesAction(filters);
  const where = [
    filters.college,
    filters.category !== 'ALL' ? CATEGORY_LABEL[filters.category as DelegateCategory] : '',
    filters.names === 'blank' ? 'blank passes' : filters.names === 'named' ? 'named passes' : '',
    filters.q,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PassSheet
      delegates={delegates}
      title="Passes — ACS Faculty · PED · Volunteer · Technical Official (4×6″)"
      subtitle={`${delegates.length} pass${delegates.length === 1 ? '' : 'es'}${where ? ` · ${where}` : ' · everyone with a pass'}. Cancelled passes print with a red CANCELLED stamp — leave those out of the envelope.`}
      backHref="/admin/officials"
      backLabel="Back to Faculty & Officials"
    />
  );
}
