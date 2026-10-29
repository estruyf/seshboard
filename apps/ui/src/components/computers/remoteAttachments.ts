import { REMOTE_ATTACHMENT_BYTES, REMOTE_IMAGE_BYTES, REMOTE_MAX_FILES, REMOTE_MAX_IMAGES, type RemoteFile, type RemoteImage } from '@seshboard/protocol/client';
import type { DropVerdict } from '../composer/images.ts';

/**
 * Images and files for a message to another computer (docs/remote-access.md, Other computers). Images go as the phone
 * sends them: redrawn as a JPEG that fits `REMOTE_IMAGE_BYTES`. Files go as they are, and that computer mentions them
 * by path in the prompt. Together they fit `REMOTE_ATTACHMENT_BYTES`, the most one line of the channel takes. The
 * planning is pure, with tests; reading needs the browser.
 */

export type RemoteAttachment = { id: number; kind: 'image'; image: RemoteImage } | { id: number; kind: 'file'; file: RemoteFile; size: number };

/** What that computer takes: images on every version, files only with `REMOTE_FEATURE_ATTACHMENTS`. */
export interface Accepts {
  images: boolean;
  files: boolean;
}

/** The base64 the attachments take. */
export const attachedBytes = (items: readonly RemoteAttachment[]) => items.reduce((sum, a) => sum + (a.kind === 'image' ? a.image.data : a.file.data).length, 0);

/** Base64 is 4 characters for every 3 bytes. */
export const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

const count = (items: readonly RemoteAttachment[], kind: RemoteAttachment['kind']) => items.filter((a) => a.kind === kind).length;

/**
 * Where a picked, pasted or dropped file goes: attached as an image, as a file, or left out with the reason. An image
 * goes as a file once the images are full; a file too big for what is left of the message is left out.
 */
export function placeFor(file: { type: string; size: number; name: string }, items: readonly RemoteAttachment[], accepts: Accepts, computer: string): { as: 'image' | 'file' } | { skip: string } {
  const image = file.type.startsWith('image/');
  if (image && accepts.images && count(items, 'image') < REMOTE_MAX_IMAGES) return { as: 'image' };
  if (!accepts.files) return { skip: image ? `A message takes up to ${REMOTE_MAX_IMAGES} images.` : `Update Seshboard on ${computer} to send files.` };
  if (count(items, 'file') >= REMOTE_MAX_FILES) return { skip: `A message takes up to ${REMOTE_MAX_FILES} files.` };
  if (base64Length(file.size) > REMOTE_ATTACHMENT_BYTES - attachedBytes(items)) return { skip: `${file.name || 'That file'} is too big to send. A message takes ${megabytes(REMOTE_ATTACHMENT_BYTES)} in all.` };
  return { as: 'file' };
}

/** "2.6 MB": what the budget is in bytes of files, not base64. */
export function megabytes(base64: number): string {
  return `${((base64 / 4) * 3 / 1_000_000).toFixed(1)} MB`;
}

/** "12 KB", "1.4 MB": a file's size on its chip. */
export function fileSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** What a drag over the view would do, from the types alone (sizes are only known on drop). */
export function remoteDropVerdict(drag: { files: boolean; types: string[] }, state: { items: readonly RemoteAttachment[]; accepts: Accepts; disabledReason: string | null; computer: string }): DropVerdict | null {
  if (!drag.files) return null;
  if (state.disabledReason) return { kind: 'disabled', reason: state.disabledReason };
  if (!drag.types.length) return { kind: 'ok', attach: 0, mention: 0, full: false };
  const { items, accepts } = state;
  const images = drag.types.filter((t) => t.startsWith('image/')).length;
  const attach = accepts.images ? Math.min(images, Math.max(0, REMOTE_MAX_IMAGES - count(items, 'image'))) : 0;
  const mention = accepts.files ? Math.min(drag.types.length - attach, Math.max(0, REMOTE_MAX_FILES - count(items, 'file'))) : 0;
  if (attach + mention > 0) return { kind: 'ok', attach, mention, full: false };
  // The overlay's own "full" counts the local limit.
  if (images && accepts.images) return { kind: 'disabled', reason: `A message takes up to ${REMOTE_MAX_IMAGES} images.` };
  return { kind: 'disabled', reason: accepts.files ? `A message takes up to ${REMOTE_MAX_FILES} files.` : `Update Seshboard on ${state.computer} to send files.` };
}

// ---------------------------------------------------------------------------------------------------------
// Reading (browser)

const LONGEST_SIDE = 2_000;
/** As the phone tries (apps/remote/src/lib/images.ts): lower quality first, then a smaller size. */
const ATTEMPTS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: LONGEST_SIDE, quality: 0.8 },
  { side: LONGEST_SIDE, quality: 0.65 },
  { side: 1_600, quality: 0.65 },
  { side: 1_200, quality: 0.6 },
  { side: 900, quality: 0.6 },
];

/** The size to draw at: the image's own, or scaled down so its longest side is `max`. */
export function fitWithin(width: number, height: number, max = LONGEST_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Base64 of a blob, without the `data:` prefix. */
export async function readBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** An image as the other computer takes it, redrawn to fit; throws when even the smallest try is too big. */
export async function readRemoteImage(file: File): Promise<RemoteImage> {
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
      const data = await readBase64(blob);
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

/** A file's name as the other computer takes it: no folders, at most 200 characters. */
export function remoteFileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() ?? '';
  return (base || 'file').slice(-200);
}
