import { REMOTE_IMAGE_BYTES, REMOTE_MAX_IMAGES, type RemoteImage } from '@switchboard/protocol/remote-client';

/**
 * Images for a message: pasted, dropped or photographed. A photo is far bigger than the channel likes, so each is
 * redrawn as a JPEG of at most 2,000px on its longest side at 0.8, and smaller or rougher until it fits
 * `REMOTE_IMAGE_BYTES`. The sizing is pure, with tests; `toImage` needs the browser.
 */

export const LONGEST_SIDE = 2_000;

/** The size to draw at: the image's own, or scaled down so its longest side is `max`. */
export function fitWithin(width: number, height: number, max = LONGEST_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What to try, in order, until one fits: lower quality first, then a smaller size. */
export const ATTEMPTS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: LONGEST_SIDE, quality: 0.8 },
  { side: LONGEST_SIDE, quality: 0.65 },
  { side: 1_600, quality: 0.65 },
  { side: 1_200, quality: 0.6 },
  { side: 900, quality: 0.6 },
];

/** Why another image can't be added, or null when it can. */
export function addReason(count: number): string | null {
  return count >= REMOTE_MAX_IMAGES ? `A message takes up to ${REMOTE_MAX_IMAGES} images.` : null;
}

/** The files of a paste or a drop that are images, as many as still fit. */
export function imageFiles<F extends { type: string }>(files: readonly F[], count: number): F[] {
  return files.filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, REMOTE_MAX_IMAGES - count));
}

/** Base64 of a blob, without the `data:` prefix. */
export async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** An image file as the computer takes it, resized; throws when even the smallest try is too big. */
export async function toImage(file: File): Promise<RemoteImage> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const attempt of ATTEMPTS) {
      const size = fitWithin(bitmap.width, bitmap.height, attempt.side);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) break;
      // JPEG has no transparency: a screenshot's clear parts become white rather than black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', attempt.quality));
      if (!blob) break;
      const data = await base64(blob);
      if (data.length <= REMOTE_IMAGE_BYTES) return { type: 'image', mediaType: 'image/jpeg', data, name: jpegName(file.name) };
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`${file.name || 'This image'} is too big to send.`);
}

/** The file's name with `.jpg`, since that is what it became. */
export function jpegName(name: string): string {
  const base = (name || 'image').replace(/\.[^./\\]+$/, '');
  return `${base.slice(0, 190)}.jpg`;
}
