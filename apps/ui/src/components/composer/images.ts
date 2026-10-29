import type { ImageAttachment } from '@seshboard/protocol/client';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 7_000_000;
/** The most images one message can carry. */
export const MAX_ATTACHMENTS = 20;

export const SKIPPED_NOTICE = 'Only PNG, JPEG, GIF or WebP images up to 7 MB.';

/** Reads a pasted, dropped or picked file as an attachment; null for anything that can't be attached. */
export function readImage(file: File): Promise<ImageAttachment | null> {
  const mediaType = IMAGE_TYPES.find((t) => t === file.type);
  if (!mediaType || file.size > MAX_IMAGE_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result).split(',')[1] ?? '';
      resolve({ type: 'image', mediaType, data, name: file.name || 'pasted image' });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

const isImageType = (type: string) => (IMAGE_TYPES as readonly string[]).includes(type);

/**
 * What a drag over the session view would do, from what is known while dragging: the MIME type of each
 * dragged file (folders have none; sizes are only known on drop). Images are attached while there is
 * room; other files, folders and images past the limit become `@path` mentions when `canMention`.
 */
export type DropVerdict =
  | { kind: 'ok'; attach: number; mention: number; full: boolean }
  | { kind: 'unsupported' }
  | { kind: 'full' }
  | { kind: 'disabled'; reason: string };

/** `null` means the drag carries no files (text, a link) and is none of the composer's business. */
export function dropVerdict(drag: { files: boolean; types: string[] }, state: { attached: number; disabledReason?: string | null; canMention: boolean }): DropVerdict | null {
  if (!drag.files) return null;
  if (state.disabledReason) return { kind: 'disabled', reason: state.disabledReason };
  // Some sources report files without item types; let the drop decide then.
  if (!drag.types.length) return { kind: 'ok', attach: 0, mention: 0, full: false };
  const images = drag.types.filter(isImageType).length;
  const others = drag.types.length - images;
  const room = Math.max(0, MAX_ATTACHMENTS - state.attached);
  const attach = Math.min(images, room);
  const mention = state.canMention ? others + images - attach : 0;
  if (attach + mention > 0) return { kind: 'ok', attach, mention, full: images > room };
  return images ? { kind: 'full' } : { kind: 'unsupported' };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The line the drop overlay shows for a verdict. */
export function dropMessage(verdict: DropVerdict): string {
  switch (verdict.kind) {
    case 'ok': {
      const { attach, mention, full } = verdict;
      if (!attach && !mention) return 'Drop to attach images or add files';
      if (full && !attach) return `${MAX_ATTACHMENTS} images attached already: drop to add ${mention === 1 ? 'it' : 'them'} as ${mention === 1 ? 'a file' : 'files'}`;
      if (!mention) return attach > 1 ? `Drop ${attach} images to attach` : 'Drop images to attach';
      if (!attach) return mention > 1 ? `Drop to add ${mention} files` : 'Drop to add this file';
      return `Drop to attach ${plural(attach, 'image')} and add ${plural(mention, 'file')}`;
    }
    case 'unsupported':
      return SKIPPED_NOTICE;
    case 'full':
      return `${MAX_ATTACHMENTS} images attached already: remove one to add more`;
    case 'disabled':
      return verdict.reason;
  }
}

/** A dropped file as far as the plan needs it; `path` is empty when the file isn't on disk. */
export interface DroppedFile {
  type: string;
  size: number;
  path: string;
  directory: boolean;
}

/**
 * Splits a drop: images that fit are attached (by index), everything else with a path on disk is
 * mentioned, and the rest is skipped (counted for the notice).
 */
export function planDrop(files: DroppedFile[], attached: number): { attach: number[]; mention: DroppedFile[]; skipped: number } {
  let room = Math.max(0, MAX_ATTACHMENTS - attached);
  const attach: number[] = [];
  const mention: DroppedFile[] = [];
  let skipped = 0;
  files.forEach((file, index) => {
    if (!file.directory && isImageType(file.type) && file.size <= MAX_IMAGE_BYTES && room > 0) {
      attach.push(index);
      room--;
    } else if (file.path) mention.push(file);
    else skipped++;
  });
  return { attach, mention, skipped };
}

/**
 * Adds new images to the ones attached, up to the limit, and says what was left out: files that
 * aren't attachable images, and images past the limit.
 */
export function mergeAttachments<T>(current: T[], added: T[], offered: number): { next: T[]; notice: string | null } {
  const room = Math.max(0, MAX_ATTACHMENTS - current.length);
  const next = [...current, ...added.slice(0, room)];
  const overLimit = added.length - Math.min(added.length, room);
  const skipped = offered - added.length;
  const parts = [skipped > 0 && 'Some files were skipped: only PNG, JPEG, GIF or WebP images up to 7 MB.', overLimit > 0 && `${overLimit} ${overLimit === 1 ? 'image was' : 'images were'} left out: ${MAX_ATTACHMENTS} at most per message.`].filter(Boolean);
  return { next, notice: parts.length ? parts.join(' ') : null };
}
