import { requireAdmin } from '@/lib/auth-guard';
import { listAllAthletesAction } from '@/app/actions/admin-operations';
import AthletesClient from './AthletesClient';

export const dynamic = 'force-dynamic';

export default async function AdminAthletesPage() {
  await requireAdmin();
  const athletes = await listAllAthletesAction();
  return <AthletesClient athletes={athletes} />;
}
