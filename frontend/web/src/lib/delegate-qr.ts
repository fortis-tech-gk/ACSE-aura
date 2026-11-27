/**
 * Pass QR for faculty, PEDs and meet officials.
 *
 * Deliberately the SAME signed format as the athlete card ("AURA26.<uuid>.<sig>",
 * see athlete-qr.ts): the officials scanner app and the API already know that grammar,
 * and the uuid inside simply belongs to `delegates` instead of `profiles` — the meal and
 * accreditation RPCs (migration 0057) work out which table it is. UUIDs never collide
 * across the two tables, so a pass can never be taken for an athlete card.
 *
 * Server-only (reads ATHLETE_QR_SECRET).
 */
import { tryMakeAthleteQrToken, verifyAthleteQrToken } from './athlete-qr';

/** Signed QR for a delegate pass, or null when ATHLETE_QR_SECRET is missing. */
export function tryMakeDelegateQrToken(delegateId: string): string | null {
  return tryMakeAthleteQrToken(delegateId);
}

/** The delegate (or athlete) id inside a genuine pass QR, otherwise null. */
export function verifyDelegateQrToken(token: string): string | null {
  return verifyAthleteQrToken(token);
}
