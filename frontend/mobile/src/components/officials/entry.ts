/** Display helpers for a heat entry (an athlete, or a relay team) */
export type EntryPerson = {
  profiles?: { id: string; sslc_name: string; bid_number: number | null; squads?: { colleges?: { code: string; name?: string } | null } | null } | null;
  relay_teams?: { id: string; squads?: { colleges?: { code: string; name?: string } | null } | null } | null;
};

export function entryName(e: EntryPerson): string {
  if (e.profiles) return e.profiles.sslc_name;
  const c = e.relay_teams?.squads?.colleges;
  return c ? `${c.code} relay team` : 'Relay team';
}

export function entrySub(e: EntryPerson): string {
  if (e.profiles) {
    return [e.profiles.bid_number != null ? `Bib ${e.profiles.bid_number}` : null, e.profiles.squads?.colleges?.code].filter(Boolean).join(' · ');
  }
  return e.relay_teams?.squads?.colleges?.name || '';
}
