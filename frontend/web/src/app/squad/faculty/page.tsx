import { requireSquad } from '@/lib/auth-guard';
import { listSquadDelegatesAction } from '@/app/actions/delegates';
import FacultyManager from './FacultyManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Faculty & Officials — VTU SportsOS Squad',
};

export default async function SquadFacultyPage() {
  const session = await requireSquad();
  const { delegates, canEdit, blockReason } = await listSquadDelegatesAction();

  return (
    <FacultyManager
      delegates={delegates}
      canEdit={canEdit}
      blockReason={blockReason}
      collegeName={session.collegeName || ''}
      collegeCode={session.collegeCode || ''}
    />
  );
}
