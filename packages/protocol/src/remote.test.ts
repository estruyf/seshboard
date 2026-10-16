import { describe, expect, it } from 'vitest';
import { contract } from './contract.ts';
import { remoteContract, remotePairContract } from './remote.ts';

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
      'options.get',
      'projects.list',
      'push.key',
      'push.subscribe',
      'push.unsubscribe',
      'session.ask',
      'session.askThreads',
      'session.create',
      'session.interrupt',
      'session.markRead',
      'session.queue.remove',
      'session.respond',
      'session.send',
      'session.setEffort',
      'session.setFlags',
      'session.setModel',
      'session.setPermissionMode',
      'sessions.list',
      'transcript.get',
      'transcript.unwatch',
      'transcript.watch',
      'usage.get',
      'usage.tokens',
    ]);
    expect(Object.keys(remoteContract.events).sort()).toEqual(['catchup.changed', 'session.ask', 'session.stream', 'sessions.changed', 'transcript.updated', 'upNext.changed', 'usage.changed']);
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
});
