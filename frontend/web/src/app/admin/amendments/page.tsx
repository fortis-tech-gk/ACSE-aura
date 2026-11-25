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

  // Only athletes WITH a bib number can be withdrawn or have their voided slot reused, so only
  // those are read (none before bibs are assigned). Amendments are read at the same time.
  const [athletes, amendments] = await Promise.all([fetchAllRows<any>(() =>
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
    .not('bid_number', 'is', null)
    .order('bid_number', { ascending: true })
    .order('id')
  ), listAmendmentsAction()]);

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

  return (
    <div className="container" id="admin-amendments-page">
      <AmendmentsManager
        athletes={formattedAthletes}
        initialAmendments={amendments}
      />
    </div>
  );
}
