/**
 * Real GitHub Copilot CLI, through the SDK and the user's own `copilot` and login. Costs one small request.
 * Opt-in, in a throwaway git repository only: SESHBOARD_LIVE_COPILOT_CWD=/path/to/throwaway/repo npx vitest run copilot.live
 * SESHBOARD_LIVE_COPILOT_MODEL picks the model (a free one keeps it at no cost).
 */
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import { copilotProvider } from './copilotProvider.ts';
import { copilotHome } from './copilotSource.ts';

const cwd = process.env.SESHBOARD_LIVE_COPILOT_CWD;

describe.skipIf(!cwd)('live GitHub Copilot session', () => {
  it('is signed in with its own login, runs a turn and reads it back from disk', async () => {
    const provider = copilotProvider({ profileId: 'live', copilotHome: copilotHome(process.env, homedir()), userHome: homedir() });
    const driver = provider.driver!;
    try {
      const status = await driver.status();
      expect(status.problem).toBeNull();
      const messages: RawSessionMessage[] = [];
      const states: string[] = [];
      let idle: () => void = () => {};
      const done = new Promise<void>((resolve) => (idle = resolve));
      const session = await driver.start(
        { cwd: cwd!, model: process.env.SESHBOARD_LIVE_COPILOT_MODEL ?? null, permissionMode: 'default' },
        {
          stream: () => {},
          messages: (m) => messages.push(...m),
          state: (s) => (states.push(s), s !== 'running' && idle()),
          // Nothing to allow: the prompt needs no tools.
          permission: (r) => session.respond(r.requestId, { behavior: 'deny', message: 'Not in this test.' }),
          permissionDone: () => {},
          usage: () => {},
          model: () => {},
        },
      );
      await session.send('Reply with exactly: OK', []);
      await done;
      expect(states.at(-1)).toBe('idle');
      expect(messages.some((m) => m.type === 'assistant')).toBe(true);
      await session.close();
      const fromDisk = await provider.source.info(session.sessionId);
      expect(fromDisk).toMatchObject({ provider: 'copilot', origin: 'app', cwd });
    } finally {
      await driver.dispose();
    }
  }, 120_000);
});
