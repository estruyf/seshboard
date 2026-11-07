/**
 * Real Google Gemini CLI through its ACP agent, with the user's own `gemini` and login (their `~/.gemini`, used as it
 * is): a reply that lands in Gemini's own file with the id `send` returned, a command approved in Ask before edits, a
 * file written in Accept edits, the session loaded again in a new process, and a stop. Costs a few small turns on the
 * account's flash model. Opt-in, in a throwaway git repository only:
 * SESHBOARD_LIVE_GEMINI_CWD=/path/to/throwaway/repo npx vitest run gemini.live
 * (SESHBOARD_LIVE_GEMINI_MODEL picks the model.)
 */
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PermissionRequest } from '@seshboard/protocol';
import type { DriverEvents } from '../provider.ts';
import { geminiProvider } from './geminiProvider.ts';
import { geminiHome } from './geminiSource.ts';

const cwd = process.env.SESHBOARD_LIVE_GEMINI_CWD;
const model = process.env.SESHBOARD_LIVE_GEMINI_MODEL ?? 'gemini-2.5-flash';

const until = async (condition: () => boolean, ms = 180_000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe.skipIf(!cwd)('live Gemini through its ACP agent', () => {
  it('replies into its own file, asks before a command, writes in Accept edits, loads again and stops', async () => {
    const make = () => geminiProvider({ profileId: 'live', geminiHome: geminiHome(process.env, homedir()), userHome: homedir(), log: (level, message) => console.log(`[${level}] ${message}`) });
    let adapter = make();
    for (const file of ['approved.txt', 'hello.txt']) rmSync(join(cwd!, file), { force: true });
    const states: string[] = [];
    const permissions: Array<Omit<PermissionRequest, 'sessionId'>> = [];
    let streamed = 0;
    let session: Awaited<ReturnType<NonNullable<typeof adapter.driver>['start']>>;
    const events: DriverEvents = {
      stream: () => void streamed++,
      messages: () => {},
      state: (state, error) => void states.push(error ? `${state}: ${error}` : state),
      permission: (request) => {
        permissions.push(request);
        session.respond(request.requestId, { behavior: 'allow' });
      },
      permissionDone: () => {},
      usage: () => {},
      model: () => {},
    };
    const turn = async (text: string) => {
      const ends = states.length;
      const id = await session.send(text, []);
      await until(() => states.slice(ends).some((s) => s === 'idle' || s.startsWith('error')));
      return id;
    };
    try {
      expect(await adapter.driver!.status()).toMatchObject({ signedIn: true, problem: null });
      session = await adapter.driver!.start({ cwd: cwd!, model, permissionMode: 'default' }, events);
      const id = await turn('Reply with the single word: ready');
      expect(states.at(-1)).toBe('idle');
      expect(streamed).toBeGreaterThan(0);
      // The prompt's id is Gemini's, from its own file, and the reply is in the transcript read from it.
      const messages = await adapter.source.messages(session.sessionId);
      expect(messages.some((m) => m.uuid === id && m.type === 'user')).toBe(true);
      expect(JSON.stringify(messages).toLowerCase()).toContain('ready');

      // Ask before edits: a command asks, as Bash with the command.
      await turn('Run the shell command `touch approved.txt` and nothing else.');
      expect(permissions.some((p) => p.toolName === 'Bash' && JSON.stringify(p.input).includes('approved.txt'))).toBe(true);
      expect(existsSync(join(cwd!, 'approved.txt'))).toBe(true);

      // Accept edits: a new file is written without asking.
      await session.setMode('acceptEdits');
      const asked = permissions.length;
      await turn('Create a file named hello.txt containing the word hello. Use your file writing tool, not the shell.');
      expect(existsSync(join(cwd!, 'hello.txt'))).toBe(true);
      expect(permissions.slice(asked).filter((p) => p.toolName === 'Write' || p.toolName === 'Edit')).toEqual([]);

      // A new process loads the session (its history sent again is left out) and goes on with it.
      await session.close();
      await adapter.driver!.dispose();
      adapter = make();
      const before = streamed;
      session = await adapter.driver!.start({ cwd: cwd!, resume: session.sessionId, model, permissionMode: 'default' }, events);
      await turn('Reply with the single word: again');
      expect(streamed).toBeGreaterThan(before);
      expect(JSON.stringify(await adapter.source.messages(session.sessionId)).toLowerCase()).toContain('again');

      // Stop ends a turn under way.
      const ends = states.length;
      await session.send('Count slowly from 1 to 200, one number per line.', []);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await session.interrupt();
      await until(() => states.slice(ends).some((s) => s === 'idle' || s.startsWith('error')), 30_000);
    } finally {
      await adapter.driver!.dispose();
    }
  }, 600_000);
});
