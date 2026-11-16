/**
 * Athlete passport photos live in the PRIVATE storage bucket 'athlete-photos'. profiles.photo_url
 * keeps the file's storage URL; every API response swaps it for a signed link that expires.
 * Same rules as frontend/web/src/lib/photo-links.ts.
 *
 * The apps cache the athlete pass and the officials roster for offline use, so links last 7 days.
 */
import { supabase } from '../config/supabase';

const BUCKET = 'athlete-photos';
const SIGNED_LINK_SECONDS = 7 * 24 * 60 * 60;
const CHUNK = 500;

/** Storage path inside the bucket for a stored photo URL, or null if it isn't one of ours. */
export function photoStoragePath(url?: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/athlete-photos\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Signed links for many stored photo URLs: original URL -> signed URL (unknown URLs are left out). */
export async function signPhotoUrls(urls: Array<string | null | undefined>): Promise<Map<string, string>> {
  const pathOf = new Map<string, string>();
  for (const u of urls) {
    const p = photoStoragePath(u);
    if (u && p) pathOf.set(u, p);
  }
  const out = new Map<string, string>();
  if (pathOf.size === 0) return out;

  const paths = Array.from(new Set(pathOf.values()));
  const signedByPath = new Map<string, string>();
  const parts: string[][] = [];
  for (let i = 0; i < paths.length; i += CHUNK) parts.push(paths.slice(i, i + CHUNK));
  await Promise.all(
    parts.map(async (part) => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(part, SIGNED_LINK_SECONDS);
      if (error || !data) {
        console.warn('Could not create signed athlete photo links:', error?.message);
        return;
      }
      for (const item of data) if (item?.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    })
  );
  for (const [u, p] of pathOf) {
    const s = signedByPath.get(p);
    if (s) out.set(u, s);
  }
  return out;
}

/** One signed link; the input unchanged when it isn't an athlete-photos URL or signing fails. */
export async function signPhotoUrl(url?: string | null): Promise<string | null> {
  if (!url) return null;
  return (await signPhotoUrls([url])).get(url) ?? url;
}

/**
 * Replaces every `photo_url` field found anywhere inside `value` (nested objects / arrays, e.g. a
 * heat with its athletes and relay members) with a signed link, in place. Returns `value`.
 */
export async function signPhotoFieldsDeep<T>(value: T): Promise<T> {
  const holders: Array<{ photo_url: string }> = [];
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v.photo_url === 'string') holders.push(v);
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(value);
  if (holders.length === 0) return value;
  const signed = await signPhotoUrls(holders.map((h) => h.photo_url));
  for (const h of holders) h.photo_url = signed.get(h.photo_url) ?? h.photo_url;
  return value;
}
