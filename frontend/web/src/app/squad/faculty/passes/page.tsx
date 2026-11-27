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
      title="PED Passes — 4×6″ Portrait"
      subtitle={`${session.collegeName || session.collegeCode} · ${delegates.length} pass${delegates.length === 1 ? '' : 'es'}. Print them on card stock; the QR is scanned at the food counters and, if accommodation was asked for, at the hostel.`}
      backHref="/squad/faculty"
      backLabel="Back to PED Passes"
    />
  );
}
