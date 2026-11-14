import { requireSquad } from '@/lib/auth-guard';
import { canEditRoster, isLateEntryWindow } from '@/lib/roster-window';
import { supabaseAdmin } from '@/lib/supabase';
import { getSquadRelayTeamsAction } from '@/app/actions/relay';
import RelayManager from './RelayManager';

export const metadata = {
  title: 'Relay Teams — VTU SportsOS Squad',
};

export default async function SquadRelayPage() {
  const session = await requireSquad();

  // All squads of this college (Men and Women, including this one) with their athletes, meet
  // settings and the relay teams: independent reads, fetched together.
  const [{ data: collegeSquadRows }, { data: meetSettings }, relayTeams] = await Promise.all([
    supabaseAdmin
      .from('squads')
      .select('*, profiles(id, sslc_name, usn)')
      .eq('college_id', session.collegeId),
    supabaseAdmin
      .from('meet_settings')
      .select('registration_open')
      .limit(1)
      .maybeSingle(),
    getSquadRelayTeamsAction(),
  ]);
  const collegeSquads = (collegeSquadRows || []) as any[];
  const squad = collegeSquads.find((s: any) => s.id === session.squadId) || null;

  const registrationOpen = meetSettings?.registration_open !== false;
  // After the close only a late-entry window (admin unlock) allows edits
  const registrationClosed = !registrationOpen && !isLateEntryWindow(registrationOpen, squad);
  const ownLocked = !canEditRoster(registrationOpen, squad);
  // Mixed relay spans both college squads: frozen unless every college squad may edit
  const mixedLocked = ownLocked || collegeSquads.some((s: any) => !canEditRoster(registrationOpen, s));

  const byName = (a: { sslc_name: string }, b: { sslc_name: string }) =>
    String(a.sslc_name || '').localeCompare(String(b.sslc_name || ''));
  const athletesOf = (gender: 'men' | 'women'): { id: string; sslc_name: string; usn: string }[] =>
    [...((collegeSquads.find((s: any) => s.gender === gender)?.profiles || []) as any[])]
      .map((p: any) => ({ id: p.id, sslc_name: p.sslc_name, usn: p.usn }))
      .sort(byName);
  const menAthletes = athletesOf('men');
  const womenAthletes = athletesOf('women');

  return (
    <div id="squad-relay-page" style={{ width: '100%', maxWidth: '100%' }}>
      <RelayManager
        relayTeams={relayTeams}
        menAthletes={menAthletes}
        womenAthletes={womenAthletes}
        squadGender={session.gender as 'men' | 'women'}
        rosterLocked={ownLocked}
        mixedLocked={mixedLocked}
        registrationClosed={registrationClosed}
        squadCode={squad?.squad_code || session.squadCode || ''}
      />
    </div>
  );
}
