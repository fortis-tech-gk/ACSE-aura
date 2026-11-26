'use server';

import { requireAdmin } from '@/lib/auth-guard';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/db-fetch-all';
import type { Athlete } from '@/app/admin/certificates/certificates-view';

/**
 * Every accredited athlete for Participation Certificates — read when that tab is opened, not
 * on every visit to the Certificates page (paged: one request returns at most 1,000).
 */
export async function listParticipationAthletesAction(): Promise<Athlete[]> {
  await requireAdmin();
  const rows = await fetchAllRows<any>(() =>
    supabaseAdmin
      .from('profiles')
      .select('id, sslc_name, usn, bid_number, squads(colleges(name, code, district, region))')
      .eq('accreditation_status', 'ACCREDITED')
      .order('sslc_name')
      .order('id')
  );
  return rows.map((a) => {
    const squad = Array.isArray(a.squads) ? a.squads[0] : a.squads;
    const college = squad && Array.isArray(squad.colleges) ? squad.colleges[0] : squad?.colleges;
    return { id: a.id, sslc_name: a.sslc_name, usn: a.usn, bid_number: a.bid_number, squads: { colleges: college } };
  });
}
