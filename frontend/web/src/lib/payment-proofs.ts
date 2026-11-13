/**
 * Payment proof files (bank / UPI screenshots) live in the PRIVATE storage bucket
 * 'payment-proofs'. The payments table keeps the file's storage URL; when the admin
 * Payment Verification page loads, each one is swapped for a short-lived signed link.
 * Server-only (uses the service-role client).
 */
import { supabaseAdmin } from '@/lib/supabase';

export const PAYMENT_PROOF_BUCKET = 'payment-proofs';
const SIGNED_LINK_SECONDS = 60 * 60; // 1 hour

/** Storage path inside the bucket for a stored proof URL, or null if it isn't one of ours. */
export function proofStoragePath(url?: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/payment-proofs\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Replaces `screenshot_url` on each payment row (in place) with a 1-hour signed link.
 * Rows whose URL isn't a payment-proofs storage URL are left unchanged.
 */
export async function signPaymentProofLinks(payments: Array<{ screenshot_url?: string | null }>): Promise<void> {
  const byPath = new Map<string, Array<{ screenshot_url?: string | null }>>();
  for (const p of payments) {
    const path = proofStoragePath(p?.screenshot_url);
    if (!path) continue;
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path)!.push(p);
  }
  if (byPath.size === 0) return;

  const { data, error } = await supabaseAdmin.storage
    .from(PAYMENT_PROOF_BUCKET)
    .createSignedUrls(Array.from(byPath.keys()), SIGNED_LINK_SECONDS);
  if (error || !data) {
    console.warn('Could not create signed payment proof links:', error?.message);
    return;
  }
  for (const item of data) {
    if (!item?.path || !item.signedUrl) continue;
    for (const p of byPath.get(item.path) || []) p.screenshot_url = item.signedUrl;
  }
}
