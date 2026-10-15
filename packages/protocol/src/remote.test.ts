import { describe, expect, it } from 'vitest';
import { contract } from './contract.ts';
import { remoteContract, remotePairContract } from './remote.ts';

describe('the remote contracts', () => {
  it('give a phone only these methods', () => {
    // A paired phone can make Claude run commands on the computer: adding a method here must be a deliberate change,
    // reviewed against the threat model in docs/remote-access.md.
    expect(Object.keys(remoteContract.requests).sort()).toEqual([
      'hello',
      'projects.list',
      'session.create',
      'session.interrupt',
      'session.queue.remove',
      'session.respond',
      'session.send',
      'sessions.list',
      'transcript.get',
      'transcript.unwatch',
      'transcript.watch',
    ]);
    expect(Object.keys(remoteContract.events).sort()).toEqual(['session.stream', 'sessions.changed', 'transcript.updated', 'upNext.changed']);
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
});
