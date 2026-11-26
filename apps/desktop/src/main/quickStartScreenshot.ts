/**
 * Take a screenshot in the quick start panel (macOS): the panel hides, the system's area picker opens (the crosshair of
 * ⌃⇧⌘4, Space for a window, Esc to leave it) and the panel comes back with the picture attached to its draft. The
 * picture goes on the clipboard too, as ⌃⇧⌘4 does. The rules are pure, for testing; `takeScreenshot` gets the
 * picker, the files and the clipboard through a host.
 */

import type { QuickStartScreenshot } from '@seshboard/protocol/bridge';

/** The system's screenshot tool. Its full path, so a `screencapture` earlier on the PATH can't stand in for it. */
export const SCREENCAPTURE = '/usr/sbin/screencapture';

/** System Settings › Privacy & Security › Screen Recording. */
export const SCREEN_RECORDING_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/**
 * The largest picture sent as a PNG. An attachment holds up to 7 MB (`MAX_IMAGE_BYTES` in the composer), so a bigger
 * one (a full Retina screen) goes as a JPEG instead.
 */
export const MAX_PNG_BYTES = 5_000_000;
/** What the panel says when the picker wrote nothing and Seshboard has no Screen Recording. */
export const NO_SCREEN_ACCESS = 'Allow Seshboard in Screen Recording to take screenshots. Then quit and open Seshboard again.';

/** The largest attachment, as the composer takes it. */
export const MAX_IMAGE_BYTES = 7_000_000;

/** `screencapture`'s arguments: pick an area (or a window with Space), and write it to `file` as a PNG. */
export const screencaptureArgs = (file: string): string[] => ['-i', '-t', 'png', file];

/** The attachment's name, from the time it was taken: `Screenshot 14.05.09.png`, as the panel shows it. */
export function screenshotName(at: Date, ext: 'png' | 'jpg'): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Screenshot ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}.${ext}`;
}

/** How the picture is sent: as it is, or as a JPEG when the PNG is too big for an attachment. */
export const encodingFor = (pngBytes: number): 'png' | 'jpeg' => (pngBytes <= MAX_PNG_BYTES ? 'png' : 'jpeg');

export interface ScreenshotHost {
  /** A new file in the temp folder for the picker to write. */
  tempFile(): string;
  /** Runs the picker. Resolves when it closes, whether a picture was taken or not, with what it wrote to stderr. */
  pick(file: string): Promise<string>;
  /** The file the picker wrote, or null when there is none (Esc). */
  read(file: string): Promise<Buffer | null>;
  remove(file: string): Promise<void>;
  /** The picture as a JPEG, for one too big as a PNG. */
  toJpeg(png: Buffer): Buffer;
  /** Puts the picture on the clipboard, as ⌃⇧⌘4 does. */
  toClipboard(png: Buffer): void;
  /** Whether macOS lets Seshboard record the screen. */
  screenAccess(): boolean;
  now(): Date;
}

/** Picks an area with the system's picker and returns it as an attachment; the temp file is always removed. */
export async function takeScreenshot(host: ScreenshotHost): Promise<QuickStartScreenshot> {
  const file = host.tempFile();
  try {
    const stderr = (await host.pick(file)).trim();
    const png = await host.read(file);
    if (!png || png.length === 0) {
      // Without Screen Recording, macOS may ask for it and the picker then writes nothing: say so, not "cancelled".
      if (!host.screenAccess()) return { kind: 'failed', message: NO_SCREEN_ACCESS, screenAccess: false };
      return stderr ? { kind: 'failed', message: `Couldn’t take the screenshot: ${stderr}` } : { kind: 'cancelled' };
    }
    host.toClipboard(png);
    const encoding = encodingFor(png.length);
    const bytes = encoding === 'png' ? png : host.toJpeg(png);
    if (bytes.length > MAX_IMAGE_BYTES) return { kind: 'failed', message: 'The screenshot is too big to attach. Pick a smaller area.' };
    return {
      kind: 'image',
      mediaType: encoding === 'png' ? 'image/png' : 'image/jpeg',
      data: bytes.toString('base64'),
      name: screenshotName(host.now(), encoding === 'png' ? 'png' : 'jpg'),
      screenAccess: host.screenAccess(),
    };
  } catch (error) {
    return { kind: 'failed', message: `Couldn’t take the screenshot: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await host.remove(file).catch(() => {});
  }
}
