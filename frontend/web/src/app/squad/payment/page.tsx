import { requireSquad } from '@/lib/auth-guard';
import { getSquadFeeBreakdownAction } from '@/app/actions/payment';
import { supabaseAdmin } from '@/lib/supabase';
import { getCollegeSquadIds } from '@/lib/payments';
import type { InvoiceAthlete } from '@/components/invoice/FeeInvoiceModal';
import PaymentClient from './PaymentClient';

export const metadata = {
  title: 'Entry Fee Settlement — VTU SportsOS Squad',
};

export default async function SquadPaymentPage() {
  const session = await requireSquad();
  // One payment per college: the invoice lists the athletes of BOTH divisions (Men + Women)
  const collegeSquadIds = await getCollegeSquadIds(session.squadId);
  const [{ breakdown, fullBreakdown, payments }, { data: athletesRaw }] = await Promise.all([
    getSquadFeeBreakdownAction(),
    supabaseAdmin
      .from('profiles')
      .select('id, sslc_name, usn, squads(gender), registrations(id, kind, events(code, name))')
      .in('squad_id', collegeSquadIds)
      .order('sslc_name'),
  ]);

  // Minimal roster for the Registration Form / Fee Invoice (no Aadhaar or other personal data)
  const athletes: InvoiceAthlete[] = (athletesRaw || []).map((a: any) => ({
    id: a.id,
    sslc_name: a.sslc_name,
    usn: a.usn,
    gender: (Array.isArray(a.squads) ? a.squads[0] : a.squads)?.gender || '',
    registrations: (a.registrations || []).map((r: any) => {
      const ev = Array.isArray(r.events) ? r.events[0] : r.events;
      return { id: r.id, kind: r.kind, events: ev ? { code: ev.code, name: ev.name } : null };
    }),
  }));

  return (
    <div id="squad-payment-page" style={{ width: '100%', maxWidth: '100%' }}>
      <PaymentClient
        breakdown={breakdown}
        fullBreakdown={fullBreakdown}
        payments={payments}
        squadCode={session.squadCode || ''}
        athletes={athletes}
      />
    </div>
  );
}
