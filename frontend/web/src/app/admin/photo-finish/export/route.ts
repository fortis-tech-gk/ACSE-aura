import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth-guard';
import { fetchAllRows } from '@/lib/db-fetch-all';
import { DB_CODE_TO_OFFICIAL_MAP } from '@/lib/championship-events';
import { buildPeopleList, buildStartList, isHeatEvent, type LifHeat } from '@/lib/finishlynx';

export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

function file(body: string, name: string) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
const bad = (msg: string, status = 400) => new Response(msg, { status });
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * GET /admin/photo-finish/export
 *   ?kind=people                            all athletes of the sprint / hurdles / relay events (.ppl), to pre-load the day before
 *   ?kind=startlist&heatId=…                one heat (.lif)
 *   ?kind=startlist&eventId=…&stage=…       every heat of one round of an event (.evt)
 */
export async function GET(req: NextRequest) {
  await requireAdmin();
  const q = req.nextUrl.searchParams;
  const kind = q.get('kind');

  if (kind === 'people') {
    const { data: events } = await supabaseAdmin.from('events').select('id, code');
    const heatEventIds = (events || []).filter((e: any) => isHeatEvent(e.code)).map((e: any) => e.id);
    const regs = await fetchAllRows<any>(() =>
      supabaseAdmin
        .from('registrations')
        .select('id, profile_id, profiles!inner(sslc_name, bid_number, accreditation_status, squads(colleges(code)))')
        .in('event_id', heatEventIds)
        .in('kind', ['regular', 'relay'])
        .order('id')
    );
    const seen = new Map<string, { id: string; name: string; college: string }>();
    for (const r of regs) {
      const p: any = one(r.profiles);
      if (!p || p.bid_number == null || p.accreditation_status === 'WITHDrAWN') continue;
      seen.set(r.profile_id, { id: String(p.bid_number), name: p.sslc_name, college: one<any>(one<any>(p.squads)?.colleges)?.code || '' });
    }
    const list = [...seen.values()].sort((a, b) => Number(a.id) - Number(b.id));
    return file(buildPeopleList(list), 'athletes.ppl');
  }

  if (kind === 'startlist') {
    const heatId = q.get('heatId');
    const eventId = q.get('eventId');
    const stage = q.get('stage');
    let query = supabaseAdmin
      .from('heats')
      .select(`
        id, stage, heat_number,
        events(id, code, name),
        heat_athletes(
          lane_number,
          profiles(sslc_name, bid_number, squads(colleges(code))),
          relay_teams(squads(colleges(name, code)))
        )
      `);
    if (heatId) query = query.eq('id', heatId);
    else if (eventId && stage) query = query.eq('event_id', eventId).eq('stage', stage);
    else return bad('Give heatId, or eventId and stage.');
    const { data, error } = await query.order('heat_number');
    if (error) return bad(error.message, 500);
    if (!data?.length) return bad('No heats found. Make the heats first.', 404);

    const heats: LifHeat[] = (data as any[]).map((h) => {
      const ev: any = one(h.events);
      const map = DB_CODE_TO_OFFICIAL_MAP[String(ev?.code || '').toUpperCase()];
      return {
        eventNo: map?.codeNum ?? 0,
        stage: h.stage,
        heatNumber: h.heat_number,
        eventName: map ? `${map.officialName} ${map.section}` : ev?.name || '',
        entries: (h.heat_athletes || []).map((a: any) => {
          const p: any = one(a.profiles);
          const t: any = one(a.relay_teams);
          const col: any = one(one<any>(t?.squads)?.colleges);
          return p
            ? { lane: a.lane_number, id: String(p.bid_number ?? ''), name: p.sslc_name, college: one<any>(one<any>(p.squads)?.colleges)?.code || '' }
            : { lane: a.lane_number, id: col?.code || '', name: col?.name || '', college: col?.code || '' };
        }),
      };
    });
    const first = (data as any[])[0];
    const ev: any = one(first.events);
    const base = `${slug(ev?.code || 'event')}-${slug(heats[0].stage)}`;
    return heatId
      ? file(buildStartList(heats), `${base}-heat${heats[0].heatNumber}.lif`)
      : file(buildStartList(heats), `${base}.evt`);
  }

  return bad('Unknown export.');
}
