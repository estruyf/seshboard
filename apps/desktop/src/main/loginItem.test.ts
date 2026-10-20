import { describe, expect, it } from 'vitest';
import { loginItemsSettingsUrl, openAtLoginFrom } from './loginItem.ts';

describe('openAtLoginFrom', () => {
  it('reads the status on macOS 13 and later', () => {
    expect(openAtLoginFrom({ openAtLogin: true, status: 'enabled' }, 'darwin')).toBe('on');
    expect(openAtLoginFrom({ openAtLogin: false, status: 'not-registered' }, 'darwin')).toBe('off');
    expect(openAtLoginFrom({ openAtLogin: false, status: 'not-found' }, 'darwin')).toBe('off');
    expect(openAtLoginFrom({ openAtLogin: false, status: 'requires-approval' }, 'darwin')).toBe('needs-approval');
  });

  it('falls back to openAtLogin on an older Mac', () => {
    expect(openAtLoginFrom({ openAtLogin: true }, 'darwin')).toBe('on');
    expect(openAtLoginFrom({ openAtLogin: false }, 'darwin')).toBe('off');
  });

  it('counts as off on Windows when Startup apps turned it off', () => {
    expect(openAtLoginFrom({ openAtLogin: true, executableWillLaunchAtLogin: true }, 'win32')).toBe('on');
    expect(openAtLoginFrom({ openAtLogin: true, executableWillLaunchAtLogin: false }, 'win32')).toBe('off');
    expect(openAtLoginFrom({ openAtLogin: false, executableWillLaunchAtLogin: false }, 'win32')).toBe('off');
  });
});

describe('loginItemsSettingsUrl', () => {
  it('opens Login Items on macOS and Startup apps on Windows', () => {
    expect(loginItemsSettingsUrl('darwin')).toContain('LoginItems');
    expect(loginItemsSettingsUrl('win32')).toBe('ms-settings:startupapps');
    expect(loginItemsSettingsUrl('linux')).toBeNull();
  });
});
