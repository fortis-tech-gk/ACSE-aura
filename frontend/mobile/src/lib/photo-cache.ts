/**
 * Athlete photos saved on the phone, so the pass and the scanners still show faces with no network.
 *
 * Photos come from the API as signed links that change every time they are signed. A photo is
 * saved under a name made from the link WITHOUT its signing token, so a fresh link for the same
 * photo finds the same file, while a replaced photo (new storage path) gets a new file.
 *
 * Files live in the app's document folder (not the cache folder), so the phone does not clear
 * them to free space during the meet.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

const SUPPORTED = Platform.OS !== 'web';
const DIR_NAME = 'aura-photos';

let dir: Directory | null = null;
function photoDir(): Directory {
  if (!dir) {
    dir = new Directory(Paths.document, DIR_NAME);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

/** FNV-1a, 32 bit, as 8 hex characters */
function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** File name for a photo link: same photo -> same name, whatever its signing token */
export function photoFileName(url: string): string {
  const base = url.split('?')[0].split('#')[0];
  const ext = /\.(jpe?g|png|webp)$/i.exec(base)?.[1]?.toLowerCase() ?? 'jpg';
  return `${fnv1a(base, 0x811c9dc5)}${fnv1a(base, 0x01234567)}.${ext}`;
}

function fileFor(url: string): File {
  return new File(photoDir(), photoFileName(url));
}

/** The saved copy's file:// uri, or null when this photo is not on the phone */
export function localPhotoUri(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('file:')) return url;
  if (!SUPPORTED) return null;
  try {
    const f = fileFor(url);
    return f.exists && (f.size ?? 0) > 0 ? f.uri : null;
  } catch {
    return null;
  }
}

const inFlight = new Map<string, Promise<string | null>>();

/** Download one photo unless it is already saved. Resolves to the local uri, or null on failure. */
export function savePhoto(url: string | null | undefined): Promise<string | null> {
  if (!SUPPORTED || !url || !/^https?:/i.test(url)) return Promise.resolve(null);
  const existing = localPhotoUri(url);
  if (existing) return Promise.resolve(existing);
  const name = photoFileName(url);
  const running = inFlight.get(name);
  if (running) return running;

  const job = (async () => {
    const target = fileFor(url);
    try {
      const saved = await File.downloadFileAsync(url, target, { idempotent: true });
      if ((saved.size ?? 0) > 0) return saved.uri;
      saved.delete();
      return null;
    } catch {
      // offline, expired link or storage error: leave no half-written file behind
      try {
        if (target.exists) target.delete();
      } catch {
        // ignore
      }
      return null;
    } finally {
      inFlight.delete(name);
    }
  })();
  inFlight.set(name, job);
  return job;
}

export type PhotoSaveProgress = { done: number; saved: number; failed: number; total: number };

/**
 * Save many photos, a few at a time. Already-saved photos count as done straight away.
 * `shouldStop` is checked between downloads so a run can be cancelled.
 */
export async function savePhotos(
  urls: (string | null | undefined)[],
  onProgress?: (p: PhotoSaveProgress) => void,
  opts: { concurrency?: number; shouldStop?: () => boolean } = {}
): Promise<PhotoSaveProgress> {
  const unique = Array.from(new Set(urls.filter((u): u is string => !!u && /^https?:/i.test(u))));
  const p: PhotoSaveProgress = { done: 0, saved: 0, failed: 0, total: unique.length };
  if (!SUPPORTED) return p;

  const todo: string[] = [];
  for (const u of unique) {
    if (localPhotoUri(u)) {
      p.done++;
      p.saved++;
    } else todo.push(u);
  }
  onProgress?.({ ...p });

  let next = 0;
  const worker = async () => {
    while (next < todo.length && !opts.shouldStop?.()) {
      const u = todo[next++];
      const ok = await savePhoto(u);
      p.done++;
      if (ok) p.saved++;
      else p.failed++;
      onProgress?.({ ...p });
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, todo.length) }, worker));
  return p;
}

/** How many of these photos are already saved on the phone */
export function countSavedPhotos(urls: (string | null | undefined)[]): number {
  if (!SUPPORTED) return 0;
  let n = 0;
  for (const u of new Set(urls)) if (u && localPhotoUri(u)) n++;
  return n;
}

/** Delete every saved photo (athlete logout) */
export function clearSavedPhotos(): void {
  if (!SUPPORTED) return;
  try {
    const d = new Directory(Paths.document, DIR_NAME);
    if (d.exists) d.delete();
  } catch {
    // ignore
  }
  dir = null;
}

/**
 * Image source for a photo link: the saved copy when there is one, otherwise the link itself.
 * Any photo shown while online is saved in the background, so it is there next time offline.
 */
export function usePhotoUri(url: string | null | undefined): string | null {
  const [uri, setUri] = useState<string | null>(() => localPhotoUri(url) ?? url ?? null);
  useEffect(() => {
    let alive = true;
    const local = localPhotoUri(url);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUri(local ?? url ?? null);
    if (!local && url) {
      savePhoto(url).then((saved) => {
        if (alive && saved) setUri(saved);
      });
    }
    return () => {
      alive = false;
    };
  }, [url]);
  return uri;
}
