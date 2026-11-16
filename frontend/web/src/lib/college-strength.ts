import { supabaseAdmin } from '@/lib/supabase';

import { COLLEGE_MIN_ATHLETES } from '@/lib/college-strength-limits';

export { COLLEGE_MIN_ATHLETES };

export interface CollegeStrength {
  /** Athletes across both squads of the college */
  total: number;
  men: number;
  women: number;
}

/** Counts the athletes registered by every squad of one college. */
export async function countCollegeAthletes(collegeId: string): Promise<CollegeStrength> {
  const empty: CollegeStrength = { total: 0, men: 0, women: 0 };
  if (!collegeId) return empty;

  // A college has at most a few dozen athletes, far below Supabase's 1,000-row cap.
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, squads!inner(gender, college_id)')
    .eq('squads.college_id', collegeId);

  if (error || !data) return empty;

  return data.reduce<CollegeStrength>((acc, row: any) => {
    const squad = Array.isArray(row.squads) ? row.squads[0] : row.squads;
    if (squad?.gender === 'women') acc.women += 1;
    else acc.men += 1;
    acc.total += 1;
    return acc;
  }, { ...empty });
}
