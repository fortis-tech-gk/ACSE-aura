import { requireAdmin } from '@/lib/auth-guard';
import { getAdminDashboardStatsAction } from '@/app/actions/admin-operations';
import AdminDashboardClient from './AdminDashboardClient';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  await requireAdmin();
  const stats = await getAdminDashboardStatsAction();
  return <AdminDashboardClient initialStats={stats} />;
}
