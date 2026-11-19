import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import { disposeProvider, type DriverEvents } from '../provider.ts';
import { agyProvider } from './agyProvider.ts';

/**
 * Real Antigravity CLI, opt-in, in a throwaway folder (it costs a few small requests on your Google plan):
 * `SESHBOARD_LIVE_AGY_CWD=/path/to/throwaway/repo npx vitest run agy.live`. The sessions go in a throwaway
 * `--gemini-dir`; the login is the system's, so you must be signed in to `agy` already.
 */
const cwd = process.env.SESHBOARD_LIVE_AGY_CWD;
const model = process.env.SESHBOARD_LIVE_AGY_MODEL ?? 'gemini-3.8-flash';

describe.skipIf(!cwd)('Antigravity CLI, live', () => {
  it('runs a turn whose live messages are the ones a read gives later, and lists the session', async () => {
    const geminiDir = mkdtempSync(join(tmpdir(), 'seshboard-agy-live-'));
    const adapter = agyProvider({ profileId: 'live', geminiDir, userHome: homedir() });
    try {
      const status = await adapter.driver!.status();
      expect(status.signedIn).toBe(true);
      const live: RawSessionMessage[] = [];
      let finish: (state: string) => void = () => {};
      const ended = new Promise<string>((resolve) => (finish = resolve));
      const events: DriverEvents = {
        stream: () => {},
        messages: (m) => live.push(...m),
        state: (s, e) => s !== 'running' && finish(e ? `${s}: ${e}` : s),
        permission: () => {},
        permissionDone: () => {},
        usage: () => {},
        model: () => {},
      };
      const session = await adapter.driver!.start({ cwd: cwd!, model, effort: 'low', permissionMode: 'auto', instructions: 'End every reply with the word kiwi.' }, events);
      await session.send('Run `ls` with your shell tool, then say how many entries there are, in one short sentence.', []);
      expect(await ended).toBe('idle');
      await session.close();
      // The log is written as it works: give the last step a moment.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const read = await adapter.source.messages(session.sessionId);
      expect(live.map((m) => m.uuid)).toEqual(read.map((m) => m.uuid));
      expect(read.some((m) => JSON.stringify(m.message).includes('"name":"Bash"'))).toBe(true);
      expect((await adapter.source.list()).map((s) => s.sessionId)).toContain(session.sessionId);
      expect(adapter.files.files().has(session.sessionId)).toBe(true);
      // Ask about this session: a session of its own reads the conversation and answers, and is discarded after.
      const discarded: string[] = [];
      const asking = agyProvider({ profileId: 'live-ask', geminiDir, userHome: homedir(), discard: async (paths) => void discarded.push(...paths) });
      try {
        const forks: string[] = [];
        const answer = await asking.driver!.ask!({ sessionId: session.sessionId, cwd: cwd!, model, prompt: 'Which shell command ran in that conversation? Answer with the command only.', onText: () => {}, onFork: (id) => forks.push(id) });
        expect(answer.error).toBeUndefined();
        expect(answer.answer).toMatch(/ls/);
        expect(forks).toHaveLength(1);
        expect(discarded.some((p) => p.includes(forks[0]!))).toBe(true);
      } finally {
        await disposeProvider(asking);
      }
    } finally {
      await disposeProvider(adapter);
    }
  }, 300_000);
});
