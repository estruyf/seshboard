import { describe, expect, it } from 'vitest';
import { COMPANION_PROTOCOL } from '@seshboard/protocol/companion-client';
import { infoFiles, pickInfo } from './discovery.ts';

const info = (pid: number, protocol = COMPANION_PROTOCOL) => JSON.stringify({ protocol, socket: `/tmp/sb-${pid}/engine.sock`, token: 'abc', pid, startedAt: 1, appVersion: '1.2.3' });

describe('discovery', () => {
  it('looks for the installed app first, then a development build, then both by their names before the rename, or where the settings say', () => {
    expect(infoFiles('/Users/me', '', 'darwin')).toEqual([
      '/Users/me/Library/Application Support/Seshboard/companion/engine.json',
      '/Users/me/Library/Application Support/Seshboard Dev/companion/engine.json',
      '/Users/me/Library/Application Support/Switchboard/companion/engine.json',
      '/Users/me/Library/Application Support/Switchboard Dev/companion/engine.json',
    ]);
    expect(infoFiles('/Users/me', '~/sb-data/', 'darwin')).toEqual(['/Users/me/sb-data/companion/engine.json']);
  });

  it('looks in %APPDATA% on Windows and ~/.config on Linux, where Electron keeps app data', () => {
    expect(infoFiles('C:\\Users\\me', '', 'win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toEqual([
      'C:\\Users\\me\\AppData\\Roaming\\Seshboard\\companion\\engine.json',
      'C:\\Users\\me\\AppData\\Roaming\\Seshboard Dev\\companion\\engine.json',
      'C:\\Users\\me\\AppData\\Roaming\\Switchboard\\companion\\engine.json',
      'C:\\Users\\me\\AppData\\Roaming\\Switchboard Dev\\companion\\engine.json',
    ]);
    expect(infoFiles('C:\\Users\\me', '', 'win32', {})[0]).toBe('C:\\Users\\me\\AppData\\Roaming\\Seshboard\\companion\\engine.json');
    expect(infoFiles('C:\\Users\\me', '~\\sb-data', 'win32', {})).toEqual(['C:\\Users\\me\\sb-data\\companion\\engine.json']);
    expect(infoFiles('/home/me', '', 'linux', {})[0]).toBe('/home/me/.config/Seshboard/companion/engine.json');
  });

  it('never reads a folder from the settings that is on another computer, or relative', () => {
    const usual = infoFiles('C:\\Users\\me', '', 'win32', {});
    // Windows would sign in to the server to read it (handing it the login's hash), and its engine.json would decide where to connect.
    for (const folder of ['\\\\attacker\\share', '//attacker/share', 'relative\\folder', 'C:relative', '\\\\?\\UNC\\attacker\\share']) {
      expect(infoFiles('C:\\Users\\me', folder, 'win32', {})).toEqual(usual);
    }
    expect(infoFiles('C:\\Users\\me', 'D:\\sb-data', 'win32', {})).toEqual(['D:\\sb-data\\companion\\engine.json']);
    expect(infoFiles('/Users/me', '//server/share', 'darwin')).toEqual(infoFiles('/Users/me', '', 'darwin'));
  });

  it("takes only the engine's own pipe name as the socket on Windows, and nothing else that is not a path", () => {
    const withSocket = (socket: string) => pickInfo([{ file: 'a', text: JSON.stringify({ protocol: COMPANION_PROTOCOL, socket, token: 'abc', pid: 1 }) }], () => true).kind;
    const pipe = `\\\\.\\pipe\\switchboard-${'0123456789abcdef'.repeat(2)}`;
    expect(withSocket(pipe)).toBe('found');
    expect(withSocket('/tmp/sb/engine.sock')).toBe('found');
    expect(withSocket('engine.sock')).toBe('none');
    expect(withSocket('\\\\server\\share\\engine.sock')).toBe('none');
    // Windows reads `/` and `..` in a pipe name, so these lead to pipes on another computer.
    expect(withSocket(`${pipe}/../../UNC/attacker/pipe/y`)).toBe('none');
    expect(withSocket('\\\\.\\pipe\\x/../../UNC/attacker/pipe/y')).toBe('none');
    expect(withSocket('\\\\?\\pipe\\switchboard-0123')).toBe('none');
    expect(withSocket('\\\\.\\pipe\\someone-else')).toBe('none');
  });

  it('skips files left behind by an engine that is gone, and unreadable ones', () => {
    const found = pickInfo(
      [
        { file: 'a', text: info(1) },
        { file: 'b', text: 'garbage' },
        { file: 'c', text: null },
        { file: 'd', text: info(2) },
      ],
      (pid) => pid === 2,
    );
    expect(found).toMatchObject({ kind: 'found', file: 'd', info: { pid: 2, socket: '/tmp/sb-2/engine.sock', appVersion: '1.2.3' } });
    expect(pickInfo([{ file: 'a', text: info(1) }], () => false)).toEqual({ kind: 'none' });
  });

  it('says when the running Seshboard speaks another version of the protocol', () => {
    expect(pickInfo([{ file: 'a', text: info(1, COMPANION_PROTOCOL + 1) }], () => true)).toMatchObject({ kind: 'incompatible', info: { protocol: COMPANION_PROTOCOL + 1 } });
  });
});
