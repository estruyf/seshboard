import { IMAGE_EXTENSIONS } from '@seshboard/protocol/bridge';

/**
 * A file name to suggest when saving an image from the conversation: `image-<message>-<n>.png`, from the
 * image's id (`<message uuid>:<block>:<part>`), so two images from one message don't suggest the same name.
 */
export function imageFileName(imageId: string, mediaType: string): string {
  const [message = '', ...rest] = imageId.split(':');
  const head = message.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const tail = rest.filter((part) => /^\d+$/.test(part)).join('-');
  return `${['image', head, tail].filter(Boolean).join('-')}.${IMAGE_EXTENSIONS[mediaType] ?? 'png'}`;
}

/** The media type and base64 data of a `data:<type>;base64,<data>` URL; null for anything else. */
export function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  return match ? { mediaType: match[1]!, data: match[2]! } : null;
}
