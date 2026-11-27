/**
 * One way for every official scanner (food, warden, accreditation) to say who it means:
 *   { qrToken }  — the signed QR on the ID card / pass (verified here, so a home-made QR is rejected)
 *   { bib }      — typed by the official when a card is damaged or missing
 *   { athleteId} — a profile id the app already resolved
 *
 * The id that comes back is an athlete profile OR a faculty / PED / official pass
 * (migration 0057): passes share the athlete QR format and their pass numbers (90001+) sit
 * outside the bib ranges, so a typed number is never ambiguous. The RPCs that follow
 * (scan_meal_coupon, process_accreditation_scan) work out which of the two it is.
 */
import { supabase } from '../config/supabase';
import { verifyAthleteQrToken } from './athlete-qr';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolveResult = { ok: true; athleteId: string } | { ok: false; status: number; error: string };

export async function resolveAthlete(body: any): Promise<ResolveResult> {
  const qrToken = typeof body?.qrToken === 'string' ? body.qrToken.trim() : '';
  if (qrToken) {
    const id = verifyAthleteQrToken(qrToken);
    return id ? { ok: true, athleteId: id } : { ok: false, status: 400, error: 'This QR code is not a valid AURA athlete ID card.' };
  }

  const bibRaw = body?.bib != null ? String(body.bib).trim() : '';
  if (bibRaw) {
    if (!/^\d{1,5}$/.test(bibRaw)) return { ok: false, status: 400, error: 'Enter a valid bib or pass number.' };
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('bid_number', Number(bibRaw))
      .neq('accreditation_status', 'WITHDrAWN')
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: 'Could not look up the bib number. Please try again.' };
    if (data) return { ok: true, athleteId: data.id };

    // Not a bib: a faculty / PED / official pass number (90001+)
    const { data: pass, error: passErr } = await supabase
      .from('delegates')
      .select('id')
      .eq('pass_no', Number(bibRaw))
      .neq('accreditation_status', 'WITHDRAWN')
      .maybeSingle();
    if (passErr) return { ok: false, status: 500, error: 'Could not look up that number. Please try again.' };
    if (!pass) return { ok: false, status: 404, error: `No athlete bib or pass is numbered ${bibRaw}.` };
    return { ok: true, athleteId: pass.id };
  }

  const athleteId = typeof body?.athleteId === 'string' ? body.athleteId.trim() : '';
  if (athleteId && UUID_RE.test(athleteId)) return { ok: true, athleteId };

  return { ok: false, status: 400, error: 'Scan the athlete ID card or enter a bib number.' };
}

/** Client-generated scan id (UUID) — makes offline re-sends safe. */
export function isClientScanUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
