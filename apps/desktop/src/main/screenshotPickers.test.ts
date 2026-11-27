import { describe, expect, it } from 'vitest';
import { findOnPath, linuxPicker, linuxToolOrder, snipRunning, waitForSnip, type SnipHost } from './screenshotPickers.ts';

const installed = (...files: string[]) => (file: string) => files.includes(file);

describe('Linux pickers', () => {
  it('finds a command on the PATH', () => {
    expect(findOnPath('grim', '/usr/local/bin:/usr/bin/', installed('/usr/bin/grim'))).toBe('/usr/bin/grim');
    expect(findOnPath('grim', '/usr/bin', installed())).toBeNull();
    expect(findOnPath('grim', undefined, installed('/grim'))).toBeNull();
  });

  it('tries the desktop’s own tool first, and only the tools for this session', () => {
    expect(linuxToolOrder({ XDG_CURRENT_DESKTOP: 'KDE', WAYLAND_DISPLAY: 'wayland-0' })).toEqual(['spectacle', 'flameshot', 'grim', 'gnome']);
    expect(linuxToolOrder({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toEqual(['gnome', 'flameshot', 'spectacle', 'maim', 'scrot']);
    expect(linuxToolOrder({ XDG_CURRENT_DESKTOP: 'sway', WAYLAND_DISPLAY: 'wayland-1' })).toEqual(['flameshot', 'grim', 'spectacle', 'gnome']);
  });

  it('builds the command, with the file as an argument', () => {
    const env = { PATH: '/usr/bin', XDG_CURRENT_DESKTOP: 'GNOME', WAYLAND_DISPLAY: 'wayland-0' };
    expect(linuxPicker(env, installed('/usr/bin/gnome-screenshot'), '/tmp/a b.png')).toEqual({ name: 'GNOME Screenshot', file: 'gnome-screenshot', args: ['-a', '-f', '/tmp/a b.png'] });
    expect(linuxPicker({ ...env, XDG_CURRENT_DESKTOP: 'sway' }, installed('/usr/bin/grim', '/usr/bin/slurp'), '/tmp/x.png')).toEqual({
      name: 'grim and slurp',
      file: '/bin/sh',
      args: ['-c', 'area=$(slurp) && grim -g "$area" "$1"', 'sh', '/tmp/x.png'],
    });
  });

  it('needs every command of a tool, and returns null when none is installed', () => {
    const env = { PATH: '/usr/bin', XDG_CURRENT_DESKTOP: 'sway', WAYLAND_DISPLAY: 'wayland-1' };
    expect(linuxPicker(env, installed('/usr/bin/grim'), '/tmp/x.png')).toBeNull();
    // maim is for X11 only.
    expect(linuxPicker(env, installed('/usr/bin/maim'), '/tmp/x.png')).toBeNull();
  });
});

describe('the Snipping Tool', () => {
  it('sees the picker in tasklist', () => {
    expect(snipRunning('"explorer.exe","1234","Console","1","90,000 K"\r\n"ScreenClippingHost.exe","5678","Console","1","30,000 K"\r\n')).toBe(true);
    expect(snipRunning('"explorer.exe","1234","Console","1","90,000 K"\r\n')).toBe(false);
  });

  /** A clipboard and a picker that change at the times given (in polls). */
  function snip(script: { image?: [at: number, Buffer]; running?: [from: number, to: number] }, before: Buffer | null = null) {
    let t = 0;
    let polls = 0;
    const host: SnipHost = {
      readImage: async () => (script.image && polls >= script.image[0] ? script.image[1] : before),
      open: async () => {},
      running: async () => !!script.running && polls >= script.running[0] && polls < script.running[1],
      sleep: async (ms) => {
        t += ms;
        polls += 1;
      },
      now: () => t,
    };
    return { host, polls: () => polls };
  }

  it('returns the new picture on the clipboard', async () => {
    const picture = Buffer.from('new');
    const { host } = snip({ image: [3, picture], running: [1, 3] }, Buffer.from('old'));
    expect(await waitForSnip(host, 10_000, 100)).toBe(picture);
  });

  it('stops when the picker closes without a picture (Esc)', async () => {
    const { host, polls } = snip({ running: [1, 4] }, Buffer.from('old'));
    expect(await waitForSnip(host, 10_000, 100)).toBeNull();
    expect(polls()).toBe(5);
  });

  it('ignores the picture that was already there, and waits out the time when the picker is never seen', async () => {
    const old = Buffer.from('old');
    const { host, polls } = snip({}, old);
    expect(await waitForSnip(host, 1_000, 100)).toBeNull();
    expect(polls()).toBe(10);
  });
});
