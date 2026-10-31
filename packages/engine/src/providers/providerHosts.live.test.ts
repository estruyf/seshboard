/**
 * Real GitHub Copilot through ProviderHosts: Accept edits, Up next and usage. Costs two small requests.
 * Opt-in, in a throwaway git repository only: SESHBOARD_LIVE_COPILOT_CWD=/path/to/throwaway/repo npx vitest run providerHosts.live
 */
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PermissionRequest, SessionHostInfo } from '@seshboard/protocol';
import type { TurnOutcome } from '../host/sessionHost.ts';
import { copilotProvider } from './copilot/copilotProvider.ts';
import { copilotHome } from './copilot/copilotSource.ts';
import { ProviderHosts } from './providerHosts.ts';

const cwd = process.env.SESHBOARD_LIVE_COPILOT_CWD;

describe.skipIf(!cwd)('live GitHub Copilot through ProviderHosts', () => {
  it('accepts edits itself, sends Up next after the turn, and reports usage', async () => {
    const provider = copilotProvider({ profileId: 'live', copilotHome: copilotHome(process.env, homedir()), userHome: homedir() });
    const file = join(cwd!, 'hello.txt');
    rmSync(file, { force: true });
    const infos: SessionHostInfo[] = [];
    const permissions: PermissionRequest[] = [];
    const turns: TurnOutcome[] = [];
    let ended: () => void = () => {};
    let left = 2;
    const done = new Promise<void>((resolve) => (ended = resolve));
    const hosts = new ProviderHosts({
      providers: () => [provider],
      profileOf: () => 'live',
      sessionCwd: () => cwd!,
      onInfo: (info) => infos.push(info),
      onStream: () => {},
      onMessages: () => {},
      onPermission: (request) => {
        permissions.push(request);
        // Anything that still asks (a command) is declined: the test needs none.
        hosts.respond(request.requestId, { behavior: 'deny', message: 'Not in this test.' });
      },
      onPermissionResolved: () => {},
      onTurnEnd: (_id, outcome) => {
        turns.push(outcome);
        if (--left === 0) ended();
      },
      onCreated: () => {},
      log: () => {},
    });
    try {
      const id = await hosts.create({ profileId: 'live', cwd: cwd!, prompt: 'Create a file named hello.txt in this folder containing the word hi, with the file creation tool. Then reply: Done.', attachments: [], model: process.env.SESHBOARD_LIVE_COPILOT_MODEL ?? 'claude-haiku-4.5', permissionMode: 'acceptEdits' });
      const queued = await hosts.send({ sessionId: id, text: 'Reply with exactly: second', attachments: [], mode: 'queue' });
      expect(queued.queued).toBe(true);
      await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 150_000))]);
      expect(existsSync(file)).toBe(true);
      expect(permissions.filter((p) => p.toolName === 'Edit' || p.toolName === 'Write')).toEqual([]);
      expect(turns.map((t) => t.ok)).toEqual([true, true]);
      const last = infos.filter((i) => i.sessionId === id).at(-1)!;
      expect(last).toMatchObject({ state: 'idle', permissionMode: 'acceptEdits', queue: [] });
      expect(last.contextMax).toBeGreaterThan(0);
      expect(last.providerUsage?.unit).toBe('premium requests');
      expect(last.providerUsage?.amount).toBeGreaterThan(0);
    } finally {
      await hosts.closeAll();
      await provider.driver!.dispose();
      rmSync(file, { force: true });
    }
  }, 200_000);
});
