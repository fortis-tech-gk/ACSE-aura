import { getSession } from '@/lib/session';

/**
 * Which squad is this browser logged in as right now?
 * Polled by SquadSessionWatcher so a tab that was opened for one squad (e.g. Men) notices when the
 * same browser logs in as the other squad (Women) or logs out, and sends the user to the login page.
 * Only reads the cookie: no database access.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  const squadId = session.isLoggedIn && session.role === 'squad_manager' ? session.squadId || null : null;
  return Response.json({ squadId }, { headers: { 'Cache-Control': 'no-store' } });
}
