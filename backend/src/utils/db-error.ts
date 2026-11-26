import { Response } from 'express';

/**
 * HTTP status for a database (Supabase / PostgREST) error.
 *
 * Temporary failures (connection lost, statement timeout, pool timeout, overload, deadlock,
 * network) → 503, so the apps retry: the officials' offline queue resends call room / referee /
 * scan actions only on 429 or 5xx, and treats any other 4xx as a final rejection. Everything
 * else (constraint, trigger / quota message, bad input) stays 400 as before.
 */
const TRANSIENT_PGRST = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003']);
const TRANSIENT_MESSAGE = /fetch failed|timed? ?out|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|network|terminated|too many connections/i;

export function isTransientDbError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  if (TRANSIENT_PGRST.has(code)) return true;
  if (code.startsWith('08') || code.startsWith('53') || code.startsWith('57')) return true; // connection / resources / operator intervention (57014 statement timeout)
  if (code === '40001' || code === '40P01') return true; // serialization failure / deadlock
  return TRANSIENT_MESSAGE.test(String(err.message || ''));
}

export function dbErrorStatus(err: any): number {
  return isTransientDbError(err) ? 503 : 400;
}

/** Send a database error with the right status (400 = request problem, 503 = try again). */
export function sendDbError(res: Response, err: any) {
  const status = dbErrorStatus(err);
  return res.status(status).json({
    error: status === 503 ? 'The server is busy. Please try again in a moment.' : err?.message || 'Request failed',
    ...(status === 503 ? { retry: true } : {}),
  });
}
