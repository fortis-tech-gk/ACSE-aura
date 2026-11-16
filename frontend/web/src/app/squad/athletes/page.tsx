import { requireSquad } from '@/lib/auth-guard';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizePaymentStatus } from '@/lib/payment-status';
import { listSquadAthletesAction, getAvailableEventsAction, getSquadRelayCountAction } from '@/app/actions/athletes';
import AthletesManager from './AthletesManager';
import { canEditRoster, isLateEntryWindow } from '@/lib/roster-window';
import { calculateSquadFees, MIXED_RELAY_CODE } from '@/lib/payments';
import { getEventsByCodes } from '@/lib/events-catalogue';
import { countCollegeAthletes } from '@/lib/college-strength';

export const metadata = {
  title: 'Athlete Roster — VTU SportsOS Squad',
};

/**
 * The 4x400m Mixed Relay team is shared with the other division of this college: count their
 * nominations too, so the "₹100 / free reserve" hint on the form is right.
 */
async function countSiblingMixedNominations(squadId: string, collegeId: string): Promise<number> {
  const [mixedEvent] = await getEventsByCodes([MIXED_RELAY_CODE]);
  if (!mixedEvent || !collegeId) return 0;
  const { count } = await supabaseAdmin
    .from('registrations')
    .select('id, profiles!inner(squad_id, squads!inner(college_id))', { count: 'exact', head: true })
    .eq('kind', 'relay')
    .eq('event_id', mixedEvent.id)
    .eq('profiles.squads.college_id', collegeId)
    .neq('profiles.squad_id', squadId);
  return count || 0;
}

export default async function SquadAthletesPage() {
  const session = await requireSquad();

  // Every read on this page is independent: fetch them together (one round trip, not nine).
  const [{ data: squad }, { data: meetSettings }, athletes, events, relayCount, fees, siblingMixedCount, collegeStrength] =
    await Promise.all([
      supabaseAdmin.from('squads').select('*').eq('id', session.squadId).single(),
      supabaseAdmin.from('meet_settings').select('registration_open').limit(1).maybeSingle(),
      listSquadAthletesAction(),
      getAvailableEventsAction(),
      getSquadRelayCountAction(),
      // Total dues come from the same calculation as the payment page, so both always agree
      calculateSquadFees(session.squadId),
      countSiblingMixedNominations(session.squadId, session.collegeId),
      countCollegeAthletes(session.collegeId),
    ]);
  const registrationOpen = meetSettings?.registration_open !== false;
  const lateEntryOpen = isLateEntryWindow(registrationOpen, squad);
  const registrationClosed = !registrationOpen && !lateEntryOpen;

  // Transform registrations to match interface
  const formattedAthletes = athletes.map((a: any) => ({
    ...a,
    registrations: a.registrations.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      event_id: r.event_id,
      events: Array.isArray(r.events) ? r.events[0] : r.events,
    })),
  }));

  return (
    <div id="squad-athletes-page" style={{ width: '100%', maxWidth: '100%' }}>
      <AthletesManager
        initialAthletes={formattedAthletes}
        availableEvents={events}
        rosterLocked={!canEditRoster(registrationOpen, squad)}
        registrationClosed={registrationClosed}
        lateEntryOpen={lateEntryOpen}
        paymentStatus={normalizePaymentStatus(squad?.payment_status)}
        squadCode={squad?.squad_code || session.squadCode || ''}
        gender={session.gender as 'men' | 'women'}
        relayCount={relayCount}
        totalDues={fees.totalAmount}
        siblingMixedCount={siblingMixedCount}
        siblingAthleteCount={Math.max(0, collegeStrength.total - athletes.length)}
      />
    </div>
  );
}
