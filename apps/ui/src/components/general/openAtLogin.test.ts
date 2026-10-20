import { describe, expect, it } from 'vitest';
import { openAtLoginDetail, openAtLoginUnavailable } from './openAtLogin.ts';

describe('openAtLoginDetail', () => {
  it('says log in on a Mac and sign in on Windows', () => {
    expect(openAtLoginDetail('darwin')).toBe('Switchboard opens when you log in to this Mac, so it is running again after a restart.');
    expect(openAtLoginDetail('win32')).toContain('sign in to Windows');
  });
});

describe('openAtLoginUnavailable', () => {
  it('blames the development build on macOS and Windows, and Linux on Linux', () => {
    expect(openAtLoginUnavailable('darwin')).toContain('development build');
    expect(openAtLoginUnavailable('win32')).toContain('development build');
    expect(openAtLoginUnavailable('linux')).toBe('Not available on Linux yet.');
  });
});
