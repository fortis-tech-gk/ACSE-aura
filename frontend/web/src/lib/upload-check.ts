/**
 * Upload content checks (server-only). The browser's MIME type is only a claim, so the first bytes
 * of every uploaded photo / payment proof are checked against the real file signature.
 */

/** Returns the real type of the bytes, or null when it is not a JPEG, PNG, WebP or PDF. */
export function sniffFileType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** True when the bytes really are one of the allowed types (image/jpg counts as image/jpeg). */
export function contentMatches(buf: Buffer, allowed: string[]): boolean {
  const real = sniffFileType(buf);
  const norm = allowed.map((t) => (t === 'image/jpg' ? 'image/jpeg' : t));
  return real !== null && norm.includes(real);
}

/** Storage object path of a public/sign URL inside `bucket`, or null. */
export function storagePathFromUrl(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  const marker = `/${bucket}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0]) || null;
}
