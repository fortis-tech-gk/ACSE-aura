import { requireFinance } from '@/lib/auth-guard';
import { listPaymentsForAdminAction } from '@/app/actions/admin-operations';
import PaymentsClient from './PaymentsClient';

export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage() {
  await requireFinance();
  const squads = await listPaymentsForAdminAction();
  return <PaymentsClient squads={squads} />;
}
