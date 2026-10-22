import { describe, expect, it } from 'vitest';
import { contract } from './contract.ts';
import { RemoteTheme, remoteContract, remotePairContract } from './remote.ts';

describe('the remote contracts', () => {
  it('give a phone only these methods', () => {
    // A paired phone can make Claude run commands on the computer: adding a method here must be a deliberate change,
    // reviewed against the threat model in docs/remote-access.md.
    expect(Object.keys(remoteContract.requests).sort()).toEqual([
      'catchup.get',
      'changes.commit',
      'changes.diff',
      'changes.get',
      'device.visibility',
      'hello',
      'later.add',
      'limits.arm',
      'limits.get',
      'limits.resume',
      'options.get',
      'pipelines.list',
      'pipelines.run',
      'projects.branches',
      'projects.cancelClone',
      'projects.clone',
      'projects.clonePlan',
      'projects.list',
      'push.key',
      'push.subscribe',
      'push.unsubscribe',
      'runs.anotherRound',
      'runs.archive',
      'runs.continue',
      'runs.pushPreview',
      'runs.retryStep',
      'runs.skipStep',
      'runs.stop',
      'runs.write',
      'session.ask',
      'session.askThreads',
      'session.create',
      'session.interrupt',
      'session.markRead',
      'session.markUnread',
      'session.queue.remove',
      'session.queue.sendNow',
      'session.respond',
      'session.send',
      'session.setEffort',
      'session.setFlags',
      'session.setModel',
      'session.setPermissionMode',
      'session.stopTask',
      'sessions.list',
      'theme.get',
      'transcript.get',
      'transcript.unwatch',
      'transcript.watch',
      'usage.get',
      'usage.sessionCost',
      'usage.tokens',
      'usage.windowCosts',
    ]);
    expect(Object.keys(remoteContract.events).sort()).toEqual(['app.icon', 'catchup.changed', 'limits.changed', 'projects.cloneProgress', 'session.ask', 'session.stream', 'sessions.changed', 'theme.changed', 'transcript.updated', 'upNext.changed', 'usage.changed']);
    expect(Object.keys(remotePairContract.requests)).toEqual(['pair.request']);
  });

  it('are not the app\'s contract', () => {
    expect(remoteContract.requests['session.send']).not.toBe(contract.requests['session.send']);
    expect(remoteContract.requests['session.create'].params.safeParse({ cwd: '/tmp', prompt: 'hi' }).success).toBe(false);
  });

  it('validate what a phone sends', () => {
    const send = remoteContract.requests['session.send'].params;
    expect(send.safeParse({ sessionId: 's', text: 'run the tests' }).success).toBe(true);
    expect(send.safeParse({ sessionId: 's', text: '   ' }).success).toBe(false);
    expect(send.safeParse({ sessionId: 's', text: 'hi', attachments: [] }).data).not.toHaveProperty('attachments');
    const create = remoteContract.requests['session.create'].params;
    expect(create.safeParse({ projectId: '0123456789abcdef', prompt: 'hi' }).success).toBe(true);
    expect(create.safeParse({ projectId: '/Users/me/web', prompt: 'hi' }).success).toBe(false);
    expect(remotePairContract.requests['pair.request'].params.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('only take the permission modes that still ask', () => {
    const create = remoteContract.requests['session.create'].params;
    for (const mode of ['default', 'acceptEdits', 'plan', 'auto']) expect(create.safeParse({ projectId: '0123456789abcdef', prompt: 'hi', permissionMode: mode }).success).toBe(true);
    for (const mode of ['bypassPermissions', 'dontAsk']) {
      expect(create.safeParse({ projectId: '0123456789abcdef', prompt: 'hi', permissionMode: mode }).success).toBe(false);
      expect(remoteContract.requests['session.setPermissionMode'].params.safeParse({ sessionId: 's', mode }).success).toBe(false);
      expect(remoteContract.requests['later.add'].params.safeParse({ projectId: '0123456789abcdef', prompt: 'hi', permissionMode: mode }).success).toBe(false);
    }
  });

  it('take a session id for changes, never a folder', () => {
    expect(remoteContract.requests['changes.get'].params.safeParse({ sessionId: 's', cwd: '/tmp' }).data).toEqual({ sessionId: 's' });
    expect(remoteContract.requests['changes.commit'].params.safeParse({ sessionId: 's', message: '  ' }).success).toBe(false);
  });

  it('take only colours in a theme, by token name', () => {
    expect(RemoteTheme.safeParse({ name: 'GitHub', light: { bg: '#ffffff', 'accent-ink': 'oklch(0.5 0.1 250)' }, dark: {} }).success).toBe(true);
    expect(RemoteTheme.safeParse({ name: 'x', light: { bg: 'url(https://example.com)' }, dark: {} }).success).toBe(false);
    expect(RemoteTheme.safeParse({ name: 'x', light: { bg: '#fff; color: red' }, dark: {} }).success).toBe(false);
    expect(RemoteTheme.safeParse({ name: 'x', light: { 'not-a-token': '#ffffff' }, dark: {} }).success).toBe(false);
  });
});
