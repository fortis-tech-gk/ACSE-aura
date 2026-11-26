import { supabaseAdmin } from '@/lib/supabase';

export interface CollegeParticipation {
  registered_men: number;
  registered_women: number;
  /** Reported at a roll call / call room at least once (own entry or relay team) */
  competed_men: number;
  competed_women: number;
}

/**
 * Registered and competed athletes per college id, from college_participation() (migration 0054).
 * Same "took part" rule as the Certificate of Participation. `available` is false before 0054.
 */
export async function fetchCollegeParticipation(
  collegeId?: string
): Promise<{ byCollege: Map<string, CollegeParticipation>; available: boolean }> {
  const byCollege = new Map<string, CollegeParticipation>();
  let q = supabaseAdmin.rpc('college_participation');
  if (collegeId) q = q.eq('college_id', collegeId);
  const { data, error } = await q;
  if (error) {
    console.warn('college_participation unavailable:', error.message);
    return { byCollege, available: false };
  }
  for (const r of (data || []) as any[]) {
    byCollege.set(r.college_id, {
      registered_men: Number(r.registered_men || 0),
      registered_women: Number(r.registered_women || 0),
      competed_men: Number(r.competed_men || 0),
      competed_women: Number(r.competed_women || 0),
    });
  }
  return { byCollege, available: true };
}
