import { describe, expect, it } from 'vitest';
import type { ShellCommandState } from '@switchboard/protocol/bridge';
import { shellCommandAction, shellCommandDetail, shellCommandStatus } from './shellCommand.ts';

const state = (status: ShellCommandState['status'], extra: Partial<ShellCommandState> = {}): ShellCommandState => ({ status, names: ['switchboard', 'seshboard', 'sesh'], dir: '/usr/local/bin', taken: [], ...extra });

describe('shellCommandDetail', () => {
  it('names the commands, and the PATH on Linux', () => {
    expect(shellCommandDetail('darwin')).toBe('Type switchboard . in a terminal to open New session in that folder. seshboard . and sesh . do the same.');
    expect(shellCommandDetail('linux')).toContain('~/.local/bin has to be on your PATH');
  });
});

describe('shellCommandStatus', () => {
  it('says where they go, and that macOS may ask for the password', () => {
    expect(shellCommandStatus(state('missing'), 'darwin')).toBe('Installs switchboard, seshboard and sesh in /usr/local/bin, with your password if that folder needs it.');
    expect(shellCommandStatus(state('installed'), 'darwin')).toBe('switchboard, seshboard and sesh installed in /usr/local/bin.');
    expect(shellCommandStatus(state('installed', { dir: 'C:\\bin' }), 'win32')).toContain('Terminals you open from now on');
  });

  it('says which names another program has', () => {
    expect(shellCommandStatus(state('installed', { names: ['switchboard', 'seshboard'], taken: ['/usr/local/bin/sesh'] }), 'darwin')).toBe(
      'switchboard and seshboard installed in /usr/local/bin. /usr/local/bin/sesh belongs to another program, so Switchboard leaves it alone.',
    );
    expect(shellCommandStatus(state('taken', { names: [], taken: ['/a/switchboard', '/a/seshboard', '/a/sesh'] }), 'darwin')).toBe('/a/switchboard, /a/seshboard and /a/sesh belong to another program, so Switchboard leaves them alone.');
  });
});

describe('shellCommandAction', () => {
  it('installs, updates or removes, and does nothing over another program', () => {
    expect(shellCommandAction(state('missing'))?.label).toBe('Install');
    expect(shellCommandAction(state('outdated'))).toMatchObject({ action: 'install', label: 'Update' });
    expect(shellCommandAction(state('installed'))).toMatchObject({ action: 'remove', busy: 'Removing…' });
    expect(shellCommandAction(state('taken'))).toBeNull();
    expect(shellCommandAction(state('unavailable'))).toBeNull();
  });
});
