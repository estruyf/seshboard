import { REMOTE_ATTACHMENT_BYTES, REMOTE_FEATURE_ATTACHMENTS, REMOTE_MAX_FILES, REMOTE_MAX_IMAGES, type RemoteFile, type RemoteImage } from '@seshboard/protocol/remote-client';

/**
 * What a message to the computer carries: images (resized, `lib/images.ts`) and, from a Seshboard that says
 * `REMOTE_FEATURE_ATTACHMENTS`, files as they are. Together they fit `REMOTE_ATTACHMENT_BYTES` of base64, the most one
 * line of the channel takes. Older computers take images with `session.send` only. The planning is pure, with tests.
 */

export type Attachment = { id: number; kind: 'image'; image: RemoteImage } | { id: number; kind: 'file'; file: RemoteFile; size: number };

export interface Accepts {
  images: boolean;
  files: boolean;
}

/** What the computer takes: images in a session on every version; files, and images in a new session, need the feature. */
export function acceptsFor(features: readonly string[], newSession: boolean): Accepts {
  const full = features.includes(REMOTE_FEATURE_ATTACHMENTS);
  return { images: full || !newSession, files: full };
}

const count = (items: readonly Attachment[], kind: Attachment['kind']) => items.filter((a) => a.kind === kind).length;

/** The base64 the attachments take. */
export const attachedBytes = (items: readonly Attachment[]) => items.reduce((sum, a) => sum + (a.kind === 'image' ? a.image.data : a.file.data).length, 0);

/** Base64 is 4 characters for every 3 bytes. */
export const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** "2.6 MB": what the budget is in bytes of files, not base64. */
export const megabytes = (base64: number) => `${(((base64 / 4) * 3) / 1_000_000).toFixed(1)} MB`;

/** "12 KB", "1.4 MB": a file's size on its chip. */
export function fileSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** A file's name as the computer takes it: no folders, at most 200 characters. */
export function fileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() ?? '';
  return (base || 'file').slice(-200);
}

/**
 * Where a picked, pasted or dropped file goes: an image, a file, or left out with the reason. An image goes as a file
 * once the images are full; a file too big for what is left of the message is left out.
 */
export function placeFor(file: { type: string; size: number; name: string }, items: readonly Attachment[], accepts: Accepts): { as: 'image' | 'file' } | { skip: string } {
  const image = file.type.startsWith('image/');
  if (image && accepts.images && count(items, 'image') < REMOTE_MAX_IMAGES) return { as: 'image' };
  if (!accepts.files) return { skip: image && accepts.images ? `A message takes up to ${REMOTE_MAX_IMAGES} images.` : 'Update Seshboard on your computer to send files.' };
  if (count(items, 'file') >= REMOTE_MAX_FILES) return { skip: `A message takes up to ${REMOTE_MAX_FILES} files.` };
  if (base64Length(file.size) > REMOTE_ATTACHMENT_BYTES - attachedBytes(items)) return { skip: `${file.name || 'That file'} is too big to send. A message takes ${megabytes(REMOTE_ATTACHMENT_BYTES)} in all.` };
  return { as: 'file' };
}
