import { requireAdmin } from '@/lib/auth-guard';
import { supabaseAdmin } from '@/lib/supabase';
import { listAmendmentsAction } from '@/app/actions/bids';
import { fetchAllRows } from '@/lib/db-fetch-all';
import AmendmentsManager from './AmendmentsManager';

export const metadata = {
  title: 'Roster Amendments & Substitutions — VTU SportsOS Admin',
};

export default async function AdminAmendmentsPage() {
  await requireAdmin();

  // Every athlete (paged: one request returns at most 1,000)
  const athletes = await fetchAllRows<any>(() =>
    supabaseAdmin
    .from('profiles')
    .select(`
      id,
      sslc_name,
      usn,
      bid_number,
      accreditation_status,
      squads (
        squad_code
      )
    `)
    .order('bid_number', { ascending: true })
    .order('id')
  );

  const formattedAthletes = athletes.map((a: any) => {
    const s = Array.isArray(a.squads) ? a.squads[0] : a.squads;
    return {
      id: a.id,
      sslc_name: a.sslc_name,
      usn: a.usn,
      bid_number: a.bid_number,
      squad_code: s?.squad_code || 'Squad',
      accreditation_status: a.accreditation_status,
    };
  });

  const amendments = await listAmendmentsAction();

  return (
    <div className="container" id="admin-amendments-page">
      <AmendmentsManager
        athletes={formattedAthletes}
        initialAmendments={amendments}
      />
    </div>
  );
}
