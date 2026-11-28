/**
 * Admin dashboard download: registered / not-registered colleges as Excel.
 *   GET /api/admin/college-list?list=registered
 *   GET /api/admin/college-list?list=not-registered
 * Meet Admin only — the sheets carry PED and principal phone numbers and e-mail addresses.
 */
import { getSession } from '@/lib/session';
import {
  buildCollegeListWorkbook,
  COLLEGE_LIST_FILENAMES,
  type CollegeListKind,
} from '@/lib/college-registration-report';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.isLoggedIn || session.role !== 'meet_admin') {
    return new Response('Only the Meet Admin can download college lists.', { status: 403 });
  }

  const list = new URL(req.url).searchParams.get('list');
  if (list !== 'registered' && list !== 'not-registered') {
    return new Response('list must be "registered" or "not-registered".', { status: 400 });
  }

  try {
    const buf = await buildCollegeListWorkbook(list as CollegeListKind);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${COLLEGE_LIST_FILENAMES[list as CollegeListKind]}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('college-list download failed', err);
    return new Response('Could not build the college list. Try again.', { status: 500 });
  }
}
