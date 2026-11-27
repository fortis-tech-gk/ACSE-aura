import { requireAdmin } from '@/lib/auth-guard';
import { supabaseAdmin } from '@/lib/supabase';
import { listAllDelegatesAction, type AdminDelegateFilters } from '@/app/actions/delegates';
import { fetchAllRows } from '@/lib/db-fetch-all';
import type { DelegateCategory } from '@/lib/delegates';
import OfficialsClient from './OfficialsClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Faculty & Officials — VTU SportsOS Admin',
};

export default async function AdminOfficialsPage({
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

  const [delegates, colleges] = await Promise.all([
    listAllDelegatesAction(filters),
    fetchAllRows<{ code: string; name: string }>(() => supabaseAdmin.from('colleges').select('code, name').order('id') as any),
  ]);

  return (
    <OfficialsClient
      delegates={delegates}
      filters={filters}
      colleges={colleges.sort((a, b) => a.name.localeCompare(b.name))}
    />
  );
}
