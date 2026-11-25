'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth-guard';
import { isHeatEvent, lifTimeToSeconds, parseLaneBibText } from '@/lib/finishlynx';

/**
 * Photo finish desk (/admin/photo-finish).
 *
 *   APP mode    (default) the app draws the heats from the call room roll call.
 *   MANUAL mode the photo finish vendor makes the heats; the admin types lane + bib of every heat
 *               (or semi-final / final) here, and the times come back by file or typing.
 * Switching is one click and works at any time; heats already made are never touched by it.
 */

const STAGES = ['HEATS', 'SEMI_FINAL', 'FINAL'];
const DONE = ['COMPLETED', 'OFFICIAL'];
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

async function logAudit(action: string, details: Record<string, unknown>, by: string) {
  const { error } = await supabaseAdmin.from('admin_audit_logs').insert({ action, details, performed_by: by });
  if (error) console.warn('Audit log not written:', action, error.message);
}

async function currentMode(): Promise<'APP' | 'MANUAL'> {
  const { data } = await supabaseAdmin.from('meet_settings').select('photo_finish_mode').limit(1).maybeSingle();
  return (data as any)?.photo_finish_mode === 'MANUAL' ? 'MANUAL' : 'APP';
}

export async function setPhotoFinishModeAction(mode: 'APP' | 'MANUAL'): Promise<{ success: boolean; mode?: 'APP' | 'MANUAL'; error?: string }> {
  const admin = await requireAdmin();
  if (mode !== 'APP' && mode !== 'MANUAL') return { success: false, error: 'Unknown mode.' };
  const { data: row } = await supabaseAdmin.from('meet_settings').select('id').limit(1).maybeSingle();
  if (!row?.id) return { success: false, error: 'Meet settings row not found.' };
  const { error } = await supabaseAdmin
    .from('meet_settings')
    .update({ photo_finish_mode: mode, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (error) return { success: false, error: error.message };
  await logAudit('PHOTO_FINISH_MODE', { mode }, admin.displayName || 'Administrator');
  revalidatePath('/admin/photo-finish');
  revalidatePath('/admin/heats');
  return { success: true, mode };
}

/**
 * MANUAL mode: make (or replace) one heat from the vendor's sheet. `text` has one "lane bib" per
 * line; for a relay the bib is the college code. Empty text removes the heat.
 * The athletes are marked as reported and the heat goes straight to the referee.
 */
export async function saveManualHeatAction(
  eventId: string,
  stage: string,
  heatNumber: number,
  text: string
): Promise<{ success: boolean; entries?: number; removed?: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!STAGES.includes(stage)) return { success: false, error: 'Choose heats, semi-final or final.' };
  const hn = Math.round(Number(heatNumber));
  if (!Number.isInteger(hn) || hn < 1 || hn > 30) return { success: false, error: 'Heat number must be 1 to 30.' };
  if ((await currentMode()) !== 'MANUAL') return { success: false, error: 'Switch to MANUAL mode first. In App mode the heats come from the call room.' };

  const { data: ev } = await supabaseAdmin.from('events').select('id, name, code, category, max_lanes').eq('id', eventId).maybeSingle();
  if (!ev) return { success: false, error: 'Event not found.' };
  if (!isHeatEvent((ev as any).code)) return { success: false, error: `${(ev as any).name} has no heats: it is one race, run as a final.` };
  const relay = (ev as any).category === 'relay';
  const maxLane = Math.max(8, Number((ev as any).max_lanes) || 8);

  const { data: existing } = await supabaseAdmin
    .from('heats')
    .select('id, status, schedule_item_id, heat_athletes(id, track_results(id))')
    .eq('event_id', eventId)
    .eq('stage', stage)
    .eq('heat_number', hn)
    .maybeSingle();
  if (existing) {
    if (DONE.includes((existing as any).status)) return { success: false, error: 'This heat is already finalized. Reopen it from Results & Corrections first.' };
    const hasResult = ((existing as any).heat_athletes || []).some((a: any) => (Array.isArray(a.track_results) ? a.track_results.length : a.track_results));
    if (hasResult) return { success: false, error: 'Results are already saved for this heat, so its lanes cannot be changed.' };
  }

  // Round order: no earlier round once a later one exists; a later round only after the earlier
  // one is finished; sprint finals are one race (no "final 2").
  const rank = (s: string) => STAGES.indexOf(s);
  const { data: allHeats } = await supabaseAdmin
    .from('heats')
    .select('id, stage, status, heat_number, heat_athletes(profile_id, relay_team_id, qualified_as)')
    .eq('event_id', eventId);
  const later = (allHeats || []).filter((h: any) => rank(h.stage) > rank(stage));
  if (later.length && !existing) return { success: false, error: `${(ev as any).name} already has a later round, so no heat can be added to an earlier round.` };
  if (stage === 'FINAL' && hn > 1) return { success: false, error: 'A sprint, hurdles or relay final is one race: use heat number 1.' };
  const earlierStages = [...new Set((allHeats || []).filter((h: any) => rank(h.stage) < rank(stage)).map((h: any) => h.stage as string))];
  const prevStage = earlierStages.sort((a, b) => rank(b) - rank(a))[0];
  const prevHeats = (allHeats || []).filter((h: any) => h.stage === prevStage);
  if (prevStage && prevHeats.some((h: any) => !DONE.includes(h.status))) {
    return { success: false, error: `Finish every heat of the previous round first (the referee presses Finish heat), so the qualifiers are known.` };
  }
  const qualifiedKeys = new Set<string>(
    prevHeats.flatMap((h: any) => (h.heat_athletes || []).filter((a: any) => a.qualified_as).map((a: any) => String(a.profile_id || a.relay_team_id)))
  );

  // First round: if the call room took a roll call, only those marked present may run
  const { data: rollCall } = await supabaseAdmin
    .from('roll_calls')
    .select('id, roll_call_entries(profile_id, relay_team_id, status)')
    .eq('event_id', eventId)
    .eq('stage', stage)
    .maybeSingle();
  const presentKeys = rollCall
    ? new Set<string>(((rollCall as any).roll_call_entries || []).filter((e: any) => e.status === 'REPORTED').map((e: any) => String(e.profile_id || e.relay_team_id)))
    : null;
  /** Problem with this entrant for this round, or null */
  const roundCheck = (key: string, label: string): string | null => {
    if (prevStage && !qualifiedKeys.has(key)) return `${label} did not qualify (Q or q) from the ${prevStage.toLowerCase().replace('_', '-')}.`;
    if (!prevStage && presentKeys && !presentKeys.has(key)) return `${label} is not marked present on the call room roll call.`;
    return null;
  };

  const trimmed = text.trim();
  if (!trimmed) {
    if (!existing) return { success: true, removed: true, entries: 0 };
    const { error } = await supabaseAdmin.from('heats').delete().eq('id', (existing as any).id);
    if (error) return { success: false, error: error.message };
    await logAudit('PHOTO_FINISH_HEAT_REMOVED', { eventId, stage, heatNumber: hn }, admin.displayName || 'Administrator');
    revalidatePath('/admin/photo-finish');
    return { success: true, removed: true, entries: 0 };
  }

  const parsed = parseLaneBibText(trimmed);
  if (!Array.isArray(parsed)) return { success: false, error: parsed.error };
  if (parsed.length < 1) return { success: false, error: 'Nothing to save.' };
  const lanes = new Set<number>();
  const bibs = new Set<string>();
  for (const r of parsed) {
    if (r.lane < 1 || r.lane > maxLane) return { success: false, error: `Line ${r.line}: lane ${r.lane} is not between 1 and ${maxLane}.` };
    if (lanes.has(r.lane)) return { success: false, error: `Line ${r.line}: lane ${r.lane} is used twice.` };
    if (bibs.has(r.bib)) return { success: false, error: `Line ${r.line}: ${r.bib} is listed twice.` };
    lanes.add(r.lane);
    bibs.add(r.bib);
  }

  // Resolve every bib (or college code for a relay) to a profile / relay team of THIS event
  const rows: { lane: number; profile_id: string | null; relay_team_id: string | null }[] = [];
  if (relay) {
    const { data: teams } = await supabaseAdmin
      .from('relay_teams')
      .select('id, squads(payment_status, colleges(code)), relay_members(profiles(accreditation_status))')
      .eq('event_id', eventId);
    for (const r of parsed) {
      const hits = (teams || []).filter((t: any) => String(one<any>(one<any>(t.squads)?.colleges)?.code || '').toUpperCase() === r.bib);
      if (hits.length === 0) return { success: false, error: `Line ${r.line}: no ${(ev as any).name} team from college "${r.bib}". Use the college code.` };
      if (hits.length > 1) return { success: false, error: `Line ${r.line}: college "${r.bib}" has more than one team in this event.` };
      const t: any = hits[0];
      if (one<any>(t.squads)?.payment_status !== 'VERIFIED') return { success: false, error: `Line ${r.line}: the payment of college "${r.bib}" is not verified.` };
      const accredited = (t.relay_members || []).filter((m: any) => one<any>(m.profiles)?.accreditation_status === 'ACCREDITED').length;
      if (accredited < 4) return { success: false, error: `Line ${r.line}: the "${r.bib}" team has only ${accredited} accredited runners (4 needed).` };
      const bad = roundCheck(t.id, `Line ${r.line}: the "${r.bib}" team`);
      if (bad) return { success: false, error: bad };
      rows.push({ lane: r.lane, profile_id: null, relay_team_id: t.id });
    }
  } else {
    const nums = parsed.map((r) => (/^\d+$/.test(r.bib) ? Number(r.bib) : NaN));
    const badIdx = nums.findIndex((n) => Number.isNaN(n));
    if (badIdx >= 0) return { success: false, error: `Line ${parsed[badIdx].line}: "${parsed[badIdx].bib}" is not a bib number.` };
    const { data: profs, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, bid_number, sslc_name, accreditation_status, squads(payment_status), registrations(event_id, kind)')
      .in('bid_number', nums);
    if (pErr) return { success: false, error: pErr.message };
    for (let i = 0; i < parsed.length; i++) {
      const r = parsed[i];
      const hits = (profs || []).filter((p: any) => p.bid_number === nums[i]);
      if (hits.length === 0) return { success: false, error: `Line ${r.line}: no athlete has bib ${r.bib}.` };
      if (hits.length > 1) return { success: false, error: `Line ${r.line}: bib ${r.bib} belongs to more than one athlete. Tell the developer.` };
      const p: any = hits[0];
      const label = `Line ${r.line}: ${p.sslc_name} (bib ${p.bid_number})`;
      if (rows.some((x) => x.profile_id === p.id)) return { success: false, error: `${label} is listed twice.` };
      const kinds = (p.registrations || []).filter((x: any) => x.event_id === eventId).map((x: any) => x.kind);
      const regular = kinds.some((k: string) => k === 'regular' || k === 'half_marathon');
      if (!regular && !kinds.includes('reserve')) return { success: false, error: `${label} is not entered in ${(ev as any).name}.` };
      // A reserve runs only in place of an absent athlete, which the call room roll call records
      if (!regular && !prevStage && !presentKeys) return { success: false, error: `${label} is only a reserve here. A reserve comes in through the call room roll call (reserve swap).` };
      if (p.accreditation_status !== 'ACCREDITED') return { success: false, error: `${label} is not accredited.` };
      if (one<any>(p.squads)?.payment_status !== 'VERIFIED') return { success: false, error: `${label}: the college payment is not verified.` };
      const bad = roundCheck(p.id, label);
      if (bad) return { success: false, error: bad };
      rows.push({ lane: r.lane, profile_id: p.id, relay_team_id: null });
    }
    // Not already in another heat of the same round
    const ids = rows.map((x) => x.profile_id!);
    const { data: clash } = await supabaseAdmin
      .from('heat_athletes')
      .select('profile_id, profiles(sslc_name, bid_number), heats!inner(event_id, stage, heat_number)')
      .in('profile_id', ids)
      .eq('heats.event_id', eventId)
      .eq('heats.stage', stage)
      .neq('heats.heat_number', hn);
    if (clash && clash.length) {
      const c: any = clash[0];
      const pr: any = one(c.profiles);
      return { success: false, error: `${pr?.sslc_name} (bib ${pr?.bid_number}) is already in heat ${one<any>(c.heats)?.heat_number} of this round.` };
    }
  }
  if (relay) {
    const ids = rows.map((x) => x.relay_team_id!);
    const { data: clash } = await supabaseAdmin
      .from('heat_athletes')
      .select('relay_team_id, heats!inner(event_id, stage, heat_number)')
      .in('relay_team_id', ids)
      .eq('heats.event_id', eventId)
      .eq('heats.stage', stage)
      .neq('heats.heat_number', hn);
    if (clash && clash.length) return { success: false, error: `A team is already in heat ${one<any>((clash[0] as any).heats)?.heat_number} of this round.` };
  }

  // Make / refresh the heat
  const now = new Date().toISOString();
  let heatId: string;
  let previousRows: any[] = [];
  if (existing) {
    heatId = (existing as any).id;
    const { data: old } = await supabaseAdmin
      .from('heat_athletes')
      .select('heat_id, profile_id, relay_team_id, lane_number, call_room_reported, call_room_reported_at, seed_mark')
      .eq('heat_id', heatId);
    previousRows = old || [];
    const { error } = await supabaseAdmin.from('heat_athletes').delete().eq('heat_id', heatId);
    if (error) return { success: false, error: error.message };
  } else {
    let scheduleItem: string | null = null;
    const { data: sib } = await supabaseAdmin.from('heats').select('schedule_item_id').eq('event_id', eventId).eq('stage', stage).not('schedule_item_id', 'is', null).limit(1).maybeSingle();
    scheduleItem = (sib as any)?.schedule_item_id ?? null;
    if (!scheduleItem) {
      const { data: si } = await supabaseAdmin.from('schedule_items').select('id').eq('event_id', eventId).eq('stage', stage).limit(1).maybeSingle();
      scheduleItem = (si as any)?.id ?? null;
    }
    const { data: h, error } = await supabaseAdmin
      .from('heats')
      .insert({ event_id: eventId, stage, heat_number: hn, schedule_item_id: scheduleItem, status: 'ON_TRACK' })
      .select('id')
      .single();
    if (error || !h) return { success: false, error: error?.message || 'Could not create the heat.' };
    heatId = (h as any).id;
  }
  const { error: insErr } = await supabaseAdmin.from('heat_athletes').insert(
    rows.map((r) => ({ heat_id: heatId, profile_id: r.profile_id, relay_team_id: r.relay_team_id, lane_number: r.lane, call_room_reported: true, call_room_reported_at: now }))
  );
  if (insErr) {
    // Put the old lanes back so a failed save never leaves an empty heat
    if (previousRows.length) await supabaseAdmin.from('heat_athletes').insert(previousRows);
    else if (!existing) await supabaseAdmin.from('heats').delete().eq('id', heatId);
    return { success: false, error: `Nothing was changed: ${insErr.message}` };
  }
  const { error: hErr } = await supabaseAdmin
    .from('heats')
    .update({
      status: 'ON_TRACK',
      call_room_opened_at: now,
      call_room_closed_at: now,
      call_room_close_note: `Manual photo finish mode: lanes typed by ${admin.displayName || 'the admin'} from the vendor's heat sheet.`,
    })
    .eq('id', heatId);
  if (hErr) return { success: false, error: hErr.message };

  await logAudit('PHOTO_FINISH_HEAT_SAVED', { eventId, event: (ev as any).name, stage, heatNumber: hn, entries: rows.length }, admin.displayName || 'Administrator');
  revalidatePath('/admin/photo-finish');
  revalidatePath('/admin/heats');
  return { success: true, entries: rows.length };
}

export type TimeRow = { heatAthleteId: string; timeText: string; status: 'FINISHED' | 'DNF' | 'DQ' | 'DNS' };

/**
 * Save times / statuses typed or imported for one heat. A FINISHED row without a time is skipped
 * (nothing is erased). Finalizing the heat — which builds the next round and awards points — is
 * the referee's "Finish heat" in the Officials app, exactly as before.
 */
export async function saveHeatTimesAction(heatId: string, rows: TimeRow[]): Promise<{ success: boolean; saved?: number; skipped?: number; error?: string }> {
  const admin = await requireAdmin();
  const { data: heat } = await supabaseAdmin
    .from('heats')
    .select('id, status, events(name, code), heat_athletes(id, call_room_reported)')
    .eq('id', heatId)
    .maybeSingle();
  if (!heat) return { success: false, error: 'Heat not found.' };
  if (!isHeatEvent(one<any>((heat as any).events)?.code)) return { success: false, error: 'Times are entered here only for 100m, 200m, 400m, hurdles and relays.' };
  if (DONE.includes((heat as any).status)) return { success: false, error: 'This heat is finalized. Reopen it from Results & Corrections to change a time.' };
  if (['SCHEDULED', 'DELAYED', 'CALL_ROOM'].includes((heat as any).status)) return { success: false, error: "The call room for this heat isn't closed yet." };

  const entries = new Map<string, any>(((heat as any).heat_athletes || []).map((a: any) => [a.id, a]));
  let saved = 0;
  let skipped = 0;
  for (const r of rows) {
    const entry = entries.get(r.heatAthleteId);
    if (!entry) return { success: false, error: 'A row does not belong to this heat. Reload the page.' };
    if (!['FINISHED', 'DNF', 'DQ', 'DNS'].includes(r.status)) return { success: false, error: 'Unknown status.' };
    let secs: number | null = null;
    if (r.status === 'FINISHED') {
      if (!r.timeText.trim()) { skipped++; continue; }
      secs = lifTimeToSeconds(r.timeText);
      if (secs == null) return { success: false, error: `"${r.timeText}" is not a time. Write it like 10.42 or 1:52.34.` };
    }
    if (!entry.call_room_reported) return { success: false, error: 'An athlete in this heat did not report to the call room, so no result can be entered for them.' };
    const { error } = await supabaseAdmin.rpc('submit_track_result', {
      p_heat_athlete_id: r.heatAthleteId,
      p_time_seconds: secs,
      p_status: r.status,
      p_dq_rule: r.status === 'DQ' ? 'Photo finish desk' : '',
      p_official_id: admin.entityId || null,
    });
    if (error) return { success: false, error: error.message };
    saved++;
  }
  await logAudit('PHOTO_FINISH_TIMES_SAVED', { heatId, event: one<any>((heat as any).events)?.name, saved, skipped }, admin.displayName || 'Administrator');
  revalidatePath('/admin/photo-finish');
  revalidatePath('/admin/results');
  return { success: true, saved, skipped };
}
