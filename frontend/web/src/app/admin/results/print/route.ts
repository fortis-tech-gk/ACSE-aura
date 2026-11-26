import { requireAdmin } from '@/lib/auth-guard';
import { loadResultSheets } from '@/lib/result-sheets-data';
import { renderResultSheets, type SheetFormat } from '@/lib/result-sheets';

export const dynamic = 'force-dynamic';

/**
 * Printable official result sheets of finished finals (Print / Save as PDF from the page).
 *   ?group=men|women|mixed   (men / women include the 4x400m Mixed Relay)
 *   ?format=full|top3        (full = all finalists in lane order with rank; top3 = medal winners)
 *   ?event=100M-M            (optional: one event only)
 */
export async function GET(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const g = url.searchParams.get('group');
  const group = g === 'women' || g === 'mixed' ? g : 'men';
  const format: SheetFormat = url.searchParams.get('format') === 'top3' ? 'top3' : 'full';
  const event = (url.searchParams.get('event') || '').replace(/[^A-Za-z0-9-]/g, '') || undefined;

  const events = await loadResultSheets(group, event);
  const html = renderResultSheets({
    format,
    events,
    logos: { vtu: `${url.origin}/vtu.png`, acs: `${url.origin}/acsce-logo.png` },
    generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
    toolbar: true,
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
