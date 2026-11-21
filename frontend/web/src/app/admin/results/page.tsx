import { requireAdmin } from '@/lib/auth-guard';
import { listFinishedHeatsAction } from '@/app/actions/results-admin';
import ResultsClient from './ResultsClient';

export const dynamic = 'force-dynamic';

export default async function AdminResultsPage() {
  await requireAdmin();
  const { heats, error } = await listFinishedHeatsAction();
  return <ResultsClient initialHeats={heats} loadError={error || null} />;
}
