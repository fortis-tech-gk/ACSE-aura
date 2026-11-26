import { supabase } from '../config/supabase';

/**
 * Championship standings (get_championship_standings) shared by the public leaderboard, the
 * leaderboard API and every athlete's /performance call. The function costs ~150 ms of database
 * time; called per athlete request it saturated the database at ~4,000 athletes (load test
 * 26 Nov 2026). Cached per instance for TTL_MS, and concurrent callers share one in-flight call
 * so an expiring entry never sends a burst of identical queries.
 */
const TTL_MS = 10_000;

let cached: { data: any; expiresAt: number } | null = null;
let inFlight: Promise<any> | null = null;

export async function getChampionshipStandings(): Promise<any> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_championship_standings');
      if (error) throw error; // keep code/message so callers can tell 400 from 503
      cached = { data, expiresAt: Date.now() + TTL_MS };
      return data;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Drop the cached standings on this instance (after a heat is finalized). */
export function invalidateStandings(): void {
  cached = null;
}
