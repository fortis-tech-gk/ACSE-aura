/**
 * Athlete passport photos live in the PRIVATE storage bucket 'athlete-photos'. profiles.photo_url
 * keeps the file's storage URL; whenever a page shows photos, each one is swapped for a signed
 * link that expires. Server-only (uses the service-role client).
 */
import { supabaseAdmin } from '@/lib/supabase';
import { chunk } from '@/lib/db-fetch-all';

export const ATHLETE_PHOTO_BUCKET = 'athlete-photos';
/** Long enough for a PED's working session or for printing every ID card in one go */
const SIGNED_LINK_SECONDS = 12 * 60 * 60;

/** Storage path inside the bucket for a stored photo URL, or null if it isn't one of ours. */
export function photoStoragePath(url?: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/athlete-photos\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Replaces `photo_url` on each row (in place) with a signed link. Rows whose URL isn't an
 * athlete-photos storage URL are left unchanged. Returns the same array for chaining.
 */
export async function signAthletePhotos<T extends { photo_url?: string | null }>(rows: T[]): Promise<T[]> {
  const byPath = new Map<string, T[]>();
  for (const r of rows) {
    const path = photoStoragePath(r?.photo_url);
    if (!path) continue;
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path)!.push(r);
  }
  if (byPath.size === 0) return rows;

  await Promise.all(
    chunk(Array.from(byPath.keys()), 500).map(async (paths) => {
      const { data, error } = await supabaseAdmin.storage.from(ATHLETE_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_LINK_SECONDS);
      if (error || !data) {
        console.warn('Could not create signed athlete photo links:', error?.message);
        return;
      }
      for (const item of data) {
        if (!item?.path || !item.signedUrl) continue;
        for (const r of byPath.get(item.path) || []) r.photo_url = item.signedUrl;
      }
    })
  );
  return rows;
}

/** One signed link (or the input unchanged when it isn't an athlete-photos URL). */
export async function signAthletePhoto(url?: string | null): Promise<string | null> {
  const [row] = await signAthletePhotos([{ photo_url: url ?? null }]);
  return row.photo_url ?? null;
}
