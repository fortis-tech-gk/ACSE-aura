import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth-guard';
import { isHeatEvent } from '@/lib/finishlynx';
import { showTime } from '@/lib/result-marks';
import PhotoFinishClient, { type PfEvent, type PfHeat } from './PhotoFinishClient';

export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function PhotoFinishPage() {
  await requireAdmin();

  const [{ data: settings }, { data: events }] = await Promise.all([
    supabaseAdmin.from('meet_settings').select('photo_finish_mode').limit(1).maybeSingle(),
    supabaseAdmin.from('events').select('id, name, code, category, max_lanes').order('code'),
  ]);
  const heatEvents: PfEvent[] = (events || [])
    .filter((e: any) => isHeatEvent(e.code))
    .map((e: any) => ({ id: e.id, name: e.name, code: e.code, relay: e.category === 'relay', maxLanes: Math.max(8, e.max_lanes || 8) }));

  const { data: heats } = await supabaseAdmin
    .from('heats')
    .select(`
      id, event_id, stage, heat_number, status,
      heat_athletes (
        id, lane_number, call_room_reported,
        profiles ( sslc_name, bid_number, squads ( colleges ( code ) ) ),
        relay_teams ( squads ( colleges ( name, code ) ) ),
        track_results ( time_seconds, status )
      )
    `)
    .in('event_id', heatEvents.map((e) => e.id))
    .order('heat_number');

  const rows: PfHeat[] = (heats || []).map((h: any) => ({
    id: h.id,
    eventId: h.event_id,
    stage: h.stage,
    heatNumber: h.heat_number,
    status: h.status,
    athletes: [...(h.heat_athletes || [])]
      .sort((a: any, b: any) => a.lane_number - b.lane_number)
      .map((a: any) => {
        const p: any = one(a.profiles);
        const t: any = one(a.relay_teams);
        const col: any = one(one<any>(t?.squads)?.colleges);
        const tr: any = one(a.track_results);
        return {
          id: a.id,
          lane: a.lane_number,
          bib: p ? String(p.bid_number ?? '') : col?.code || '',
          name: p ? p.sslc_name : col?.name || '',
          college: p ? one<any>(one<any>(p.squads)?.colleges)?.code || '' : col?.code || '',
          reported: !!a.call_room_reported,
          saved: tr ? { status: tr.status, time: tr.time_seconds != null ? showTime(Number(tr.time_seconds)) : '' } : null,
        };
      }),
  }));

  return <PhotoFinishClient mode={(settings as any)?.photo_finish_mode === 'MANUAL' ? 'MANUAL' : 'APP'} events={heatEvents} heats={rows} />;
}
