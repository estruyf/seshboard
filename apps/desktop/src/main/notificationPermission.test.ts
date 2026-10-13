import { describe, expect, it } from 'vitest';
import { macPermissionFrom, windowsPermissionFrom } from './notificationPermission.ts';

/** `plutil -extract apps xml1` of com.apple.ncprefs, trimmed: one app with notifications allowed, one without. */
const NCPREFS = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<array>
\t<dict>
\t\t<key>bundle-id</key>
\t\t<string>com.tinyspeck.slackmacgap</string>
\t\t<key>flags</key>
\t\t<integer>310386702</integer>
\t</dict>
\t<dict>
\t\t<key>bundle-id</key>
\t\t<string>dev.switchboard.app</string>
\t\t<key>content_visibility</key>
\t\t<integer>0</integer>
\t\t<key>flags</key>
\t\t<integer>276832270</integer>
\t\t<key>src</key>
\t\t<array>
\t\t\t<dict>
\t\t\t\t<key>flags</key>
\t\t\t\t<integer>33554432</integer>
\t\t\t</dict>
\t\t</array>
\t</dict>
</array>
</plist>`;

describe('macPermissionFrom', () => {
  it('reads the Allow notifications bit of the app, not of its sources', () => {
    expect(macPermissionFrom(NCPREFS, 'com.tinyspeck.slackmacgap')).toBe('allowed');
    expect(macPermissionFrom(NCPREFS, 'dev.switchboard.app')).toBe('blocked');
  });

  it('cannot tell for an app that is not listed, or another format', () => {
    expect(macPermissionFrom(NCPREFS, 'com.github.Electron')).toBe('unknown');
    expect(macPermissionFrom('', 'dev.switchboard.app')).toBe('unknown');
  });
});

describe('windowsPermissionFrom', () => {
  const value = (name: string, hex: string) => `\r\nHKEY_CURRENT_USER\\Software\\...\r\n    ${name}    REG_DWORD    ${hex}\r\n`;

  it('is blocked when the app or every app is turned off', () => {
    expect(windowsPermissionFrom(value('Enabled', '0x0'), value('ToastEnabled', '0x1'))).toBe('blocked');
    expect(windowsPermissionFrom('', value('ToastEnabled', '0x0'))).toBe('blocked');
  });

  it('is allowed when on, or never set', () => {
    expect(windowsPermissionFrom(value('Enabled', '0x1'), value('ToastEnabled', '0x1'))).toBe('allowed');
    expect(windowsPermissionFrom('', '')).toBe('allowed');
    expect(windowsPermissionFrom(value('Enabled', '0x10'), '')).toBe('allowed');
  });
});
