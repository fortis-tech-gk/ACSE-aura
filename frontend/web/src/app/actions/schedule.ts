'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth-guard';
import { revalidatePath } from 'next/cache';

/**
 * Admin Schedule & Heats desk (/admin/schedule).
 * Previously the page called the Express API at http://localhost:5000 with a placeholder
 * token, which never worked in production (and 401'd locally). These server actions talk to
 * Supabase directly behind the admin session, like the other admin pages.
 */

const STAGES = new Set(['HEATS', 'SEMI_FINAL', 'FINAL', 'QUALIFYING']);

export async function listEventHeatsAction(eventId: string, stage: string) {
  await requireAdmin();
  if (!eventId || !STAGES.has(stage)) return { heats: [], error: 'Invalid event or stage.' };

  const { data, error } = await supabaseAdmin
    .from('heats')
    .select(`
      id, stage, heat_number, wind_reading, status,
      heat_athletes (
        id, lane_number, call_room_reported, call_room_reported_at, seed_mark,
        profiles ( id, sslc_name, usn, bid_number, squads ( gender, colleges ( name, code ) ) ),
        relay_teams ( id, squads ( colleges ( name, code ) ) )
      )
    `)
    .eq('event_id', eventId)
    .eq('stage', stage)
    .order('heat_number', { ascending: true });

  if (error) return { heats: [], error: error.message };
  // Lanes in order within each heat
  const heats = (data || []).map((h: any) => ({
    ...h,
    heat_athletes: [...(h.heat_athletes || [])].sort((a: any, b: any) => a.lane_number - b.lane_number),
  }));
  return { heats };
}

export async function generateHeatDrawAction(eventId: string, stage: string, numLanes: number) {
  await requireAdmin();
  if (!eventId || !STAGES.has(stage)) return { success: false, error: 'Invalid event or stage.' };
  const lanes = Math.min(10, Math.max(4, Math.round(Number(numLanes) || 8)));

  const { data, error } = await supabaseAdmin.rpc('generate_heat_draw', {
    p_event_id: eventId,
    p_stage: stage,
    p_num_lanes: lanes,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath('/admin/schedule');
  revalidatePath('/admin/heats');
  return { success: true, draw: data as {
      num_heats?: number;
      total_athletes?: number;
      left_out?: { not_accredited?: number; not_paid?: number };
    } | null };
}

export async function setCallRoomReportedAction(heatAthleteId: string, reported: boolean) {
  await requireAdmin();
  if (!heatAthleteId) return { success: false, error: 'Missing athlete.' };

  const { error } = await supabaseAdmin
    .from('heat_athletes')
    .update({
      call_room_reported: reported,
      call_room_reported_at: reported ? new Date().toISOString() : null,
    })
    .eq('id', heatAthleteId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
