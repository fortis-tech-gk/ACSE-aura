import { requireAdmin } from '@/lib/auth-guard';
import { listAuditLogsAction } from '@/app/actions/admin-operations';
import AuditClient from './AuditClient';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  await requireAdmin();
  const logs = await listAuditLogsAction();
  return <AuditClient logs={logs} />;
}
