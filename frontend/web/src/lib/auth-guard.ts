import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getSession, SessionData, UserRole } from './session';
import { supabaseAdmin } from './supabase';

/** Short fingerprint of a squad's password hash (changes whenever the password is reset). */
export function squadAuthStamp(passphraseHash: string | null | undefined): string {
  return createHash('sha256').update(String(passphraseHash || '')).digest('hex').slice(0, 16);
}

// Current stamp per squad, cached briefly so the check costs ~one query per squad per 30 s
const STAMP_TTL_MS = 30_000;
const stampCache = new Map<string, { stamp: string; at: number }>();

async function currentSquadStamp(squadId: string): Promise<string | null> {
  const hit = stampCache.get(squadId);
  if (hit && Date.now() - hit.at < STAMP_TTL_MS) return hit.stamp;
  const { data, error } = await supabaseAdmin.from('squads').select('passphrase_hash').eq('id', squadId).maybeSingle();
  if (error) return hit?.stamp ?? null; // database hiccup: don't log everyone out
  const stamp = data ? squadAuthStamp(data.passphrase_hash) : '';
  stampCache.set(squadId, { stamp, at: Date.now() });
  return stamp;
}

/** Forget the cached stamp (after a password reset on this server instance). */
export function forgetSquadStamp(squadId: string) {
  stampCache.delete(squadId);
}

/**
 * Server-side guard to ensure the user is logged in with one of the allowed roles.
 * If unauthorized, redirects to the designated login page or throws an error.
 */
export async function requireAuth(allowedRoles?: UserRole[]): Promise<SessionData> {
  const session = await getSession();

  if (!session.isLoggedIn || !session.entityId) {
    redirect('/login/squad');
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
    // Redirect based on current role or send to home
    if (session.role === 'squad_manager') {
      redirect('/squad/dashboard');
    } else if (session.role === 'meet_admin') {
      redirect('/admin');
    } else if (session.role === 'registration_desk') {
      redirect('/registration-desk');
    } else {
      redirect('/');
    }
  }

  return session;
}

/**
 * Guard specifically for Squad Managers.
 */
export async function requireSquad(): Promise<SessionData & { squadId: string; collegeId: string }> {
  const session = await requireAuth(['squad_manager']);
  if (!session.squadId || !session.collegeId) {
    redirect('/login/squad');
  }
  // Logged out by a password reset (or the squad was removed): the stamp no longer matches
  const stamp = await currentSquadStamp(session.squadId);
  // (Cookies can't be changed while a page renders, so just send them to log in again —
  // logging in overwrites the old session.)
  if (stamp !== null && session.authStamp !== stamp) {
    redirect('/login/squad?reason=password-changed');
  }
  return session as SessionData & { squadId: string; collegeId: string };
}

/**
 * Guard specifically for Meet Admin.
 */
export async function requireAdmin(): Promise<SessionData> {
  return requireAuth(['meet_admin']);
}

/**
 * Guard for Staff roles (admin, finance, scanners, referee).
 */
export async function requireStaff(allowedRoles?: UserRole[]): Promise<SessionData> {
  const defaultStaffRoles: UserRole[] = [
    'meet_admin',
    'finance_desk',
    'accreditation_volunteer',
    'warden',
    'call_room_official',
    'referee',
    'registration_desk',
  ];
  return requireAuth(allowedRoles || defaultStaffRoles);
}

/**
 * Guard for the venue Registration Desk (contingent reporting / attendance).
 * The Meet Admin can use the desk too.
 */
export async function requireRegistrationDesk(): Promise<SessionData> {
  return requireAuth(['registration_desk', 'meet_admin']);
}
