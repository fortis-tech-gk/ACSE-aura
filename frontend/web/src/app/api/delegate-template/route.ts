/**
 * Downloads the Faculty / PED / Officials Excel workbook (migration 0057).
 *
 * A logged-in PED gets their own college pre-filled (college code in every row and the
 * PED rows already taken from the squad records); the meet office gets a blank copy of
 * all three sheets. Nobody else gets the file.
 */
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { buildDelegateWorkbook, DELEGATE_TEMPLATE_FILENAME, type TemplateContext } from '@/lib/delegate-workbook';
import type { SquadScope } from '@/lib/delegates';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return new Response('Log in to download the template.', { status: 401 });
  }

  let ctx: TemplateContext = { forAdmin: true };
  let filename = DELEGATE_TEMPLATE_FILENAME;

  if (session.role === 'squad_manager' && session.collegeId) {
    // Both squads of the college share one faculty list, so pre-fill both PEDs
    const { data: squads } = await supabaseAdmin
      .from('squads')
      .select('gender, ped_name, ped_phone, ped_email')
      .eq('college_id', session.collegeId);

    const knownPeds = (squads || [])
      .filter((s: any) => String(s.ped_name || '').trim())
      .map((s: any) => ({
        name: String(s.ped_name || '').trim(),
        phone: String(s.ped_phone || '').trim(),
        email: String(s.ped_email || '').trim(),
        scope: (s.gender === 'men' ? 'MEN' : 'WOMEN') as SquadScope,
      }));

    ctx = { collegeCode: session.collegeCode, collegeName: session.collegeName, knownPeds };
    filename = `AURA2026_Faculty_Officials_${(session.collegeCode || 'COLLEGE').replace(/[^A-Za-z0-9-]/g, '')}.xlsx`;
  } else if (session.role !== 'meet_admin') {
    return new Response('This template is for college PEDs and the meet office.', { status: 403 });
  }

  const buf = await buildDelegateWorkbook(ctx);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  });
}
