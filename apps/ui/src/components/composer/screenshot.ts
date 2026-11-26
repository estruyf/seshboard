import type { ImageAttachment } from '@seshboard/protocol/client';
import type { QuickStartScreenshot } from '@seshboard/protocol/bridge';

/** What a message box says when a screenshot was taken without Screen Recording (it then shows only the desktop). */
export const SCREEN_ACCESS_HINT = 'Allow Seshboard in Screen Recording, or screenshots show only the desktop.';

/**
 * What Take a screenshot came back with, for a message box or the quick start panel: the image to attach, what to say
 * under the box, and whether macOS is missing Screen Recording (the panel then offers Open Settings).
 */
export function screenshotOutcome(result: QuickStartScreenshot | undefined): { image: ImageAttachment | null; notice: string | null; noScreenAccess: boolean } {
  if (!result || result.kind === 'cancelled') return { image: null, notice: null, noScreenAccess: false };
  if (result.kind === 'failed') return { image: null, notice: result.message, noScreenAccess: result.screenAccess === false };
  const image: ImageAttachment = { type: 'image', mediaType: result.mediaType, data: result.data, name: result.name };
  return { image, notice: result.screenAccess ? null : SCREEN_ACCESS_HINT, noScreenAccess: !result.screenAccess };
}
