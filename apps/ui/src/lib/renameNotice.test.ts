import { describe, expect, it } from 'vitest';
import { renameNotice } from './renameNotice.ts';

describe('renameNotice', () => {
  it('shows only for data from Switchboard, until it is dismissed', () => {
    expect(renameNotice(false, false, 'darwin')).toBeNull();
    expect(renameNotice(true, true, 'darwin')).toBeNull();
    expect(renameNotice(true, false, 'darwin')?.title).toBe('Switchboard is now Seshboard');
  });

  it('says to pair again, and how to put the shortcut back on each platform', () => {
    const body = (platform: string) => renameNotice(true, false, platform)!.body;
    for (const platform of ['darwin', 'win32', 'linux']) expect(body(platform)).toContain('pair it again in Settings › Remote');
    expect(body('darwin')).toContain('open Seshboard from Applications and keep it in the Dock');
    expect(body('win32')).toContain('pin Seshboard again');
    expect(body('linux')).toContain('add Seshboard again');
  });
});
