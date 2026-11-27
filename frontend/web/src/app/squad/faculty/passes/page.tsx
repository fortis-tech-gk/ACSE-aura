import { requireSquad } from '@/lib/auth-guard';
import { listSquadDelegatesAction } from '@/app/actions/delegates';
import PassSheet from '@/app/components/idcard/PassSheet';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Faculty Passes — VTU SportsOS Squad',
};

export default async function SquadPassesPage() {
  const session = await requireSquad();
  const { delegates } = await listSquadDelegatesAction();

  return (
    <PassSheet
      delegates={delegates}
      title="Faculty & PED Passes — 4×6″ Portrait"
      subtitle={`${session.collegeName || session.collegeCode} · ${delegates.length} pass${delegates.length === 1 ? '' : 'es'}. Print them on card stock and hand one to each person; the QR is scanned at the gate and the food counters.`}
      backHref="/squad/faculty"
      backLabel="Back to Faculty & Officials"
    />
  );
}
