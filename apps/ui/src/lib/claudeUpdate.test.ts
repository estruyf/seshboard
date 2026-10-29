import { describe, expect, it } from 'vitest';
import type { ClaudeUpdateState } from '@seshboard/protocol/client';
import { claudeInstallOptions, claudeUpdateStatusText, claudeUpdateToast } from './claudeUpdate.ts';

const base: ClaudeUpdateState = {
  status: 'available',
  enabled: true,
  path: '/Users/me/.local/bin/claude',
  installedVersion: '2.1.0',
  latestVersion: '2.2.0',
  channel: 'latest',
  method: 'native',
  command: 'claude update',
  canUpdate: true,
  manualReason: null,
  quiet: false,
  dismissedVersion: null,
  checkedAt: 1,
  error: null,
  output: '',
  updatedTo: null,
};

describe('claudeUpdateToast', () => {
  it('offers an update Seshboard can run, or opens About for one it can’t', () => {
    expect(claudeUpdateToast(base)).toMatchObject({ title: 'Claude Code v2.2.0 is available', action: { run: 'update', primary: true }, close: 'dismiss' });
    expect(claudeUpdateToast({ ...base, canUpdate: false })?.action).toMatchObject({ run: 'about', primary: false });
  });

  it('stays hidden after dismissing, until a newer version', () => {
    expect(claudeUpdateToast({ ...base, dismissedVersion: '2.2.0' })).toBeNull();
    expect(claudeUpdateToast({ ...base, dismissedVersion: '2.1.9' })).not.toBeNull();
    expect(claudeUpdateToast({ ...base, latestVersion: '2.10.0', dismissedVersion: '2.9.0' })).not.toBeNull();
  });

  it('doesn’t nag when checks are off or Claude Code’s own updater is turned off', () => {
    expect(claudeUpdateToast({ ...base, enabled: false })).toBeNull();
    expect(claudeUpdateToast({ ...base, quiet: true })).toBeNull();
    expect(claudeUpdateToast({ ...base, status: 'up-to-date' })).toBeNull();
    expect(claudeUpdateToast(null)).toBeNull();
  });

  it('shows an update running, and one that finished until dismissed', () => {
    expect(claudeUpdateToast({ ...base, status: 'updating', quiet: true })).toMatchObject({ tone: 'busy', action: { run: 'about' }, close: 'hide' });
    expect(claudeUpdateToast({ ...base, status: 'updated', updatedTo: '2.2.0' })).toMatchObject({ title: 'Claude Code updated to v2.2.0', tone: 'ok', close: 'dismiss' });
  });
});

describe('claudeUpdateStatusText', () => {
  it('says what new and running sessions use after an update', () => {
    expect(claudeUpdateStatusText({ ...base, status: 'updated', updatedTo: '2.2.0' })).toContain('New sessions use it');
    expect(claudeUpdateStatusText({ ...base, channel: 'stable' })).toBe('Version 2.2.0 is available on the stable channel.');
    expect(claudeUpdateStatusText({ ...base, status: 'error', error: 'offline' })).toBe('offline');
  });
});

describe('claudeInstallOptions', () => {
  it('offers the native installer first, with the platform’s own package manager', () => {
    expect(claudeInstallOptions('darwin').map((o) => o.label)).toEqual(['Native installer', 'Homebrew', 'npm (Node.js 18 or newer)']);
    expect(claudeInstallOptions('win32')[0]!.command).toBe('irm https://claude.ai/install.ps1 | iex');
    expect(claudeInstallOptions('win32').map((o) => o.label)).toContain('WinGet');
    expect(claudeInstallOptions('linux').map((o) => o.label)).toEqual(['Native installer', 'npm (Node.js 18 or newer)']);
  });
});
