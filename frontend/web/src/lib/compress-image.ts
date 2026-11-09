/**
 * Browser-side image shrinking before upload.
 *
 * Uploads go to server actions as base64 text, which is about 33% larger than the file, and
 * Vercel rejects any request over 4.5 MB. A normal phone photo (3–6 MB) would therefore fail.
 * Re-encoding to JPEG at a sensible size keeps passport photos and payment screenshots to a
 * few hundred KB with no visible loss.
 *
 * Client-only (uses canvas): import it from 'use client' components.
 */

/** Largest base64 payload we send (leaves room for the rest of the form under 4.5 MB) */
export const MAX_UPLOAD_DATA_URL_CHARS = 3_500_000;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be opened. Please choose a JPG or PNG photo.'));
    img.src = src;
  });
}

/**
 * Returns a JPEG data URL whose longest side is at most `maxSide` pixels.
 * Falls back to the original file when it is already small and cannot be decoded.
 */
export async function shrinkImageToDataUrl(file: File, maxSide: number, quality = 0.85): Promise<string> {
  const original = await readAsDataUrl(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(original);
  } catch (e) {
    if (original.length <= MAX_UPLOAD_DATA_URL_CHARS) return original;
    throw e;
  }

  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  // White background so transparent PNGs do not turn black as JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const jpeg = canvas.toDataURL('image/jpeg', quality);
  // Keep whichever is smaller (a tiny original PNG can beat its JPEG)
  return original.length < jpeg.length && original.length <= MAX_UPLOAD_DATA_URL_CHARS ? original : jpeg;
}

export { readAsDataUrl };
