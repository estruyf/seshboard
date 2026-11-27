import { describe, expect, it } from 'vitest';
import { encodingFor, MAX_PNG_BYTES, NO_SCREEN_ACCESS, screencaptureArgs, screenshotName, takeScreenshot, type ScreenshotHost } from './quickStartScreenshot.ts';

function host(picture: Buffer | null, overrides: Partial<ScreenshotHost> = {}) {
  const log: string[] = [];
  const fake: ScreenshotHost = {
    tempFile: () => '/tmp/shot.png',
    pick: async (file) => {
      log.push(`pick ${file}`);
      return '';
    },
    read: async () => picture,
    remove: async (file) => void log.push(`remove ${file}`),
    toJpeg: (png) => png.subarray(0, 10),
    toClipboard: () => void log.push('clipboard'),
    screenAccess: () => true,
    now: () => new Date(2026, 10, 26, 14, 5, 9),
    ...overrides,
  };
  return { fake, log };
}

describe('screenshot rules', () => {
  it('picks an area into a PNG file', () => {
    expect(screencaptureArgs('/tmp/a.png')).toEqual(['-i', '-t', 'png', '/tmp/a.png']);
  });

  it('names the picture after the time it was taken', () => {
    expect(screenshotName(new Date(2026, 0, 2, 3, 4, 5), 'png')).toBe('Screenshot 03.04.05.png');
  });

  it('sends a big picture as a JPEG', () => {
    expect(encodingFor(MAX_PNG_BYTES)).toBe('png');
    expect(encodingFor(MAX_PNG_BYTES + 1)).toBe('jpeg');
  });
});

describe('takeScreenshot', () => {
  it('returns the picture, puts it on the clipboard and removes the file', async () => {
    const { fake, log } = host(Buffer.from('png bytes'));
    const result = await takeScreenshot(fake);
    expect(result).toEqual({ kind: 'image', mediaType: 'image/png', data: Buffer.from('png bytes').toString('base64'), name: 'Screenshot 14.05.09.png', screenAccess: true });
    expect(log).toEqual(['pick /tmp/shot.png', 'clipboard', 'remove /tmp/shot.png']);
  });

  it('is cancelled when the picker wrote nothing (Esc)', async () => {
    const { fake, log } = host(null);
    expect(await takeScreenshot(fake)).toEqual({ kind: 'cancelled' });
    expect(log).toEqual(['pick /tmp/shot.png', 'remove /tmp/shot.png']);
  });

  it('says Screen Recording is missing when the picker wrote nothing without it', async () => {
    const { fake } = host(null, { screenAccess: () => false });
    expect(await takeScreenshot(fake)).toEqual({ kind: 'failed', message: NO_SCREEN_ACCESS, screenAccess: false });
  });

  it('reports what the picker said when it wrote nothing', async () => {
    const { fake } = host(null, { pick: async () => 'could not create image from display\n' });
    expect(await takeScreenshot(fake)).toEqual({ kind: 'failed', message: 'Couldn’t take the screenshot: could not create image from display' });
  });

  it('says when macOS has not given Screen Recording', async () => {
    const { fake } = host(Buffer.from('x'), { screenAccess: () => false });
    expect(await takeScreenshot(fake)).toMatchObject({ kind: 'image', screenAccess: false });
  });

  it('sends a picture too big for a PNG as a JPEG', async () => {
    const { fake } = host(Buffer.alloc(MAX_PNG_BYTES + 1));
    expect(await takeScreenshot(fake)).toMatchObject({ kind: 'image', mediaType: 'image/jpeg', name: 'Screenshot 14.05.09.jpg' });
  });

  it('reports a picker that fails, and still removes the file', async () => {
    const { fake, log } = host(null, { pick: async () => Promise.reject(new Error('spawn ENOENT')) });
    expect(await takeScreenshot(fake)).toEqual({ kind: 'failed', message: 'Couldn’t take the screenshot: spawn ENOENT' });
    expect(log).toEqual(['remove /tmp/shot.png']);
  });
});
