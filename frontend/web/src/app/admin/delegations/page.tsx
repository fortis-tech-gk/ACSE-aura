import { requireAdmin } from '@/lib/auth-guard';
import { listPaymentsForAdminAction } from '@/app/actions/admin-operations';
import DelegationsClient from './DelegationsClient';

export const dynamic = 'force-dynamic';

export default async function AdminDelegationsPage() {
  await requireAdmin();
  const squads = await listPaymentsForAdminAction();
  return <DelegationsClient squads={squads} />;
}
