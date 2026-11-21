'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth-guard';
import { parseMetres, parseTime } from '@/lib/result-marks';

/**
 * Admin result corrections:
 *   - reopen a finalized heat so the referee can fix it in the Officials app and finalize again;
 *   - correct a track FINAL time or a decathlon / heptathlon mark directly (points and places
 *     recalculate by themselves — database triggers).
 * Every action needs a written reason, which goes into the audit log with the old and new values.
 * (The database also logs each changed result in result_changes.)
 */

const DONE = ['COMPLETED', 'OFFICIAL'];
const STAGES = ['HEATS', 'SEMI_FINAL', 'FINAL'];
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

async function logAudit(action: string, details: Record<string, unknown>, by: string) {
  const { error } = await supabaseAdmin.from('admin_audit_logs').insert({ action, details, performed_by: by });
  if (error) console.warn('Audit log not written:', action, error.message);
}

function needReason(reason: string): string | null {
  return reason.trim().length >= 5 ? null : 'Write the reason for this change (at least 5 characters). It is recorded in the audit log.';
}

export type FinishedHeat = {
  id: string;
  stage: string;
  heat_number: number;
  status: string;
  events: { id: string; name: string; code: string; gender: string | null; category: string } | null;
};

/** Heats that are finalized (and can be reopened), newest event first */
export async function listFinishedHeatsAction(): Promise<{ heats: FinishedHeat[]; error?: string }> {
  await requireAdmin();
  const { data, error } = await supabaseAdmin
    .from('heats')
    .select('id, stage, heat_number, status, events(id, name, code, gender, category)')
    .in('status', DONE)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return { heats: [], error: error.message };
  const heats = (data || []).map((h: any) => ({ ...h, events: one(h.events) })) as FinishedHeat[];
  return { heats };
}

/** Everything about one heat that an admin needs to check or fix */
export async function getHeatResultsAction(heatId: string) {
  await requireAdmin();
  const { data: heat, error } = await supabaseAdmin
    .from('heats')
    .select('id, stage, heat_number, status, events(id, name, code, gender, category)')
    .eq('id', heatId)
    .maybeSingle();
  if (error || !heat) return { error: error?.message || 'Heat not found.' };
  const ev: any = one((heat as any).events);

  const { data: entries, error: eErr } = await supabaseAdmin
    .from('heat_athletes')
    .select(
      `id, lane_number, call_room_reported,
       profiles(sslc_name, bid_number, squads(colleges(code))),
       relay_teams(squads(colleges(code))),
       track_results(time_seconds, status, dq_rule),
       field_attempts(round_number, attempt_type, mark_meters),
       vertical_jump_attempts(bar_height_meters, result),
       combined_results(discipline, mark, status, points)`
    )
    .eq('heat_id', heatId)
    .order('lane_number');
  if (eErr) return { error: eErr.message };

  let disciplines: any[] = [];
  let standings: any[] = [];
  if (ev?.category === 'combined') {
    const [d, s] = await Promise.all([
      supabaseAdmin.from('combined_disciplines').select('code, name, day, kind, unit').eq('event_code', String(ev.code).toUpperCase()).order('seq'),
      supabaseAdmin.rpc('compute_combined_standings', { p_event_id: ev.id }),
    ]);
    disciplines = d.data || [];
    standings = (s.data as any)?.standings || [];
  }
  return { heat: { ...(heat as any), events: ev }, entries: entries || [], disciplines, standings };
}

/** Reopen a finalized heat (status back to ON_TRACK: call room stays closed, results editable again) */
export async function reopenHeatAction(heatId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin();
  const bad = needReason(reason);
  if (bad) return { success: false, error: bad };

  const { data: heat } = await supabaseAdmin
    .from('heats')
    .select('id, event_id, stage, heat_number, status, events(name)')
    .eq('id', heatId)
    .maybeSingle();
  if (!heat) return { success: false, error: 'Heat not found.' };
  if (!DONE.includes((heat as any).status)) return { success: false, error: 'This heat is not finalized, so there is nothing to reopen.' };

  // A later round that has already started was built from this result: it cannot be rebuilt
  const later = STAGES.slice(STAGES.indexOf((heat as any).stage) + 1);
  if (later.length) {
    const { data: next } = await supabaseAdmin
      .from('heats')
      .select('id, stage, status, heat_athletes(id, track_results(id))')
      .eq('event_id', (heat as any).event_id)
      .in('stage', later);
    const started = (next || []).some(
      (h: any) => h.status !== 'SCHEDULED' || (h.heat_athletes || []).some((a: any) => (Array.isArray(a.track_results) ? a.track_results.length : a.track_results))
    );
    if (started) return { success: false, error: 'The next round of this event has already started, so this heat cannot be reopened. Correct the later round, or contact the developer.' };
  }

  const { error } = await supabaseAdmin.from('heats').update({ status: 'ON_TRACK' }).eq('id', heatId);
  if (error) return { success: false, error: error.message };

  await logAudit(
    'HEAT_REOPENED',
    { heatId, event: one<any>((heat as any).events)?.name, stage: (heat as any).stage, heat_number: (heat as any).heat_number, previous_status: (heat as any).status, reason: reason.trim() },
    admin.displayName || 'Administrator'
  );
  revalidatePath('/admin/results');
  revalidatePath('/results');
  return { success: true };
}

/** Correct one track result in a FINAL (or a heat of an event run as a straight final) */
export async function correctTrackResultAction(
  heatAthleteId: string,
  timeText: string,
  status: 'FINISHED' | 'DNF' | 'DQ' | 'DNS',
  dqRule: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin();
  const bad = needReason(reason);
  if (bad) return { success: false, error: bad };

  const { data: ha } = await supabaseAdmin
    .from('heat_athletes')
    .select('id, heat_id, heats(id, stage, status, events(name, category)), track_results(time_seconds, status, dq_rule)')
    .eq('id', heatAthleteId)
    .maybeSingle();
  const heat: any = one((ha as any)?.heats);
  const ev: any = one(heat?.events);
  if (!ha || !heat) return { success: false, error: 'Entry not found.' };
  if (String(ev?.category || '').startsWith('field') || ev?.category === 'combined') return { success: false, error: 'This is not a track result. Reopen the heat and let the referee correct it.' };
  if (heat.stage !== 'FINAL') return { success: false, error: 'Only a FINAL can be corrected directly (a later round is built from earlier ones). Reopen this heat instead.' };

  const t = status === 'FINISHED' ? parseTime(timeText) : null;
  if (status === 'FINISHED' && t == null) return { success: false, error: 'Type the time like 10.42 or 1:52.34.' };

  const old: any = one((ha as any).track_results);
  const { error } = await supabaseAdmin.rpc('submit_track_result', {
    p_heat_athlete_id: heatAthleteId,
    p_time_seconds: t,
    p_reaction_ms: null,
    p_wind: null,
    p_status: status,
    p_dq_rule: status === 'DQ' ? dqRule.trim() || 'DQ' : '',
    p_official_id: admin.entityId,
  });
  if (error) return { success: false, error: error.message };

  await logAudit(
    'RESULT_CORRECTED',
    { heatAthleteId, event: ev?.name, stage: heat.stage, old: old ? { time: old.time_seconds, status: old.status } : null, new: { time: t, status }, reason: reason.trim() },
    admin.displayName || 'Administrator'
  );
  revalidatePath('/admin/results');
  revalidatePath('/results');
  return { success: true };
}

/** Correct one decathlon / heptathlon mark. Points, totals and places recalculate by themselves. */
export async function correctCombinedMarkAction(
  heatAthleteId: string,
  discipline: string,
  markText: string,
  status: 'FINISHED' | 'NM' | 'DNF' | 'DQ' | 'DNS',
  reason: string
): Promise<{ success: boolean; error?: string; points?: number }> {
  const admin = await requireAdmin();
  const bad = needReason(reason);
  if (bad) return { success: false, error: bad };

  const { data: ha } = await supabaseAdmin
    .from('heat_athletes')
    .select('id, heats(events(name, code, category)), combined_results(discipline, mark, status, points)')
    .eq('id', heatAthleteId)
    .maybeSingle();
  const ev: any = one(one<any>((ha as any)?.heats)?.events);
  if (!ha || ev?.category !== 'combined') return { success: false, error: 'Entry not found, or not a decathlon / heptathlon entry.' };

  const { data: disc } = await supabaseAdmin
    .from('combined_disciplines')
    .select('code, kind')
    .eq('event_code', String(ev.code).toUpperCase())
    .eq('code', discipline.toUpperCase())
    .maybeSingle();
  if (!disc) return { success: false, error: `${discipline} is not a discipline of ${ev.name}.` };

  const mark = status === 'FINISHED' ? (disc.kind === 'track' ? parseTime(markText) : parseMetres(markText)) : null;
  if (status === 'FINISHED' && mark == null) return { success: false, error: disc.kind === 'track' ? 'Type the time like 10.42 or 1:52.34.' : 'Type the distance or height in metres, like 7.42.' };

  const old = ((ha as any).combined_results || []).find((r: any) => r.discipline === disc.code) || null;
  const { data, error } = await supabaseAdmin.rpc('submit_combined_result', {
    p_heat_athlete_id: heatAthleteId,
    p_discipline: disc.code,
    p_mark: mark,
    p_status: status,
    p_official_id: admin.entityId,
  });
  if (error) return { success: false, error: error.message };

  await logAudit(
    'RESULT_CORRECTED',
    { heatAthleteId, event: ev.name, discipline: disc.code, old: old ? { mark: old.mark, status: old.status, points: old.points } : null, new: { mark, status, points: (data as any)?.points }, reason: reason.trim() },
    admin.displayName || 'Administrator'
  );
  revalidatePath('/admin/results');
  revalidatePath('/results');
  return { success: true, points: (data as any)?.points };
}
