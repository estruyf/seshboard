import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AcpConnection, AcpConnectionOptions } from '../acp/acpConnection.ts';
import type { AgyBinary } from './agyBinary.ts';
import type { AgyLatestVersion } from './agyUpdate.ts';
import { agyLogFile } from './agyFiles.ts';

/**
 * A made-up Google Antigravity CLI for the demo home (the smoke test and the screenshots), in the process: installed,
 * signed in on Google AI Pro, with three models and their thinking levels, and an `agy acp` that lists and replays
 * the conversations below for those whose step log is in the profile's folder. Starting or continuing a session
 * refuses (`AGY_DEMO_REFUSAL`). Nothing is spawned, and nothing ever reaches a real Antigravity.
 */

/** One made-up conversation: its id (its folder in `brain/`), its title, and its replay in a folder. */
export interface AgyDemoSession {
  id: string;
  title: string;
  prompt: string;
  /** `session/load`'s updates. */
  replay(cwd: string): unknown[];
}

const text = (sessionUpdate: string, value: string) => ({ sessionUpdate, content: { type: 'text', text: value } });

/** The demo's Antigravity sessions, on acme-store. */
export const AGY_DEMO_SESSIONS: readonly AgyDemoSession[] = [
  {
    id: '7a1c0e52-4b3d-4e8f-9a10-0000000a6701',
    title: 'Add Free Shipping Banner',
    prompt: 'Show a banner on the cart page when the order ships for free',
    replay: (cwd) => [
      text('user_message_chunk', 'Show a banner on the cart page when the order ships for free'),
      text('agent_thought_chunk', 'The cart page needs to know the shipping threshold. I will read the cart first.'),
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_demo_read',
        name: 'read_file',
        args: { Path: `${cwd}/src/cart/Cart.tsx` },
        status: 'completed',
        kind: 'read',
        title: 'File src/cart/Cart.tsx',
        locations: [{ path: `${cwd}/src/cart/Cart.tsx` }],
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_demo_edit',
        name: 'edit_file',
        args: { Path: `${cwd}/src/cart/Cart.tsx`, Target: '<CartLines lines={lines} />', Replacement: '{total >= FREE_SHIPPING && <p className="banner">Your order ships for free</p>}\n<CartLines lines={lines} />' },
        status: 'completed',
        kind: 'edit',
        title: 'File src/cart/Cart.tsx',
        locations: [{ path: `${cwd}/src/cart/Cart.tsx` }],
        rawOutput: {},
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_demo_test',
        name: 'run_command',
        args: { CommandLine: 'npm test -- cart', toolSummary: 'Run the cart tests' },
        status: 'completed',
        kind: 'execute',
        title: 'npm test -- cart',
        rawOutput: { output: 'Command exited with code 0.\n\nCommand output:\n✓ cart (6 tests)\r\n', exit_code: 0 },
      },
      text('agent_message_chunk', 'The cart now shows "Your order ships for free" once the total reaches the free shipping amount. The cart tests pass.'),
      { sessionUpdate: 'usage_update', used: 18_240, size: 1_048_576 },
    ],
  },
  {
    id: '7a1c0e52-4b3d-4e8f-9a10-0000000a6702',
    title: 'Explain Checkout Flow',
    prompt: 'How does checkout pick the payment provider?',
    replay: () => [
      text('user_message_chunk', 'How does checkout pick the payment provider?'),
      text('agent_message_chunk', 'Checkout reads the provider from the store settings, then falls back to the card provider when the setting is empty.'),
      { sessionUpdate: 'usage_update', used: 9_120, size: 1_048_576 },
    ],
  },
];

/** What the demo's Antigravity says when asked to start or continue a session. */
export const AGY_DEMO_REFUSAL = 'The demo has no Antigravity CLI to run sessions';

/**
 * A demo conversation's step log, as Antigravity CLI writes its first line (what the session index watches), with the
 * project's folder, which the demo's `agy acp` reads back (Antigravity's own log doesn't have it).
 */
export function agyDemoLog(session: Pick<AgyDemoSession, 'prompt'>, cwd: string, time: Date): string {
  return `${JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: time.toISOString(), content: `<USER_REQUEST>\n${session.prompt}\n</USER_REQUEST>`, cwd })}\n`;
}

const choices = (...values: Array<[string, string]>) => values.map(([value, name]) => ({ value, name }));

/** The config a demo session answers with: its models, thinking levels and modes, and the plan. */
export const AGY_DEMO_CONFIG = [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'gemini-4-neon', options: choices(['gemini-4-neon', 'Gemini 4 Neon'], ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5']) },
  { id: 'thought_level', name: 'Thinking Level', category: 'thought_level', type: 'select', currentValue: 'high', options: choices(['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra']) },
  { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'default', options: choices(['default', 'Default'], ['accept-edits', 'Accept edits'], ['auto', 'Auto'], ['plan', 'Plan']) },
];

/** The demo's commands, after a session starts. */
const DEMO_COMMANDS = [
  { name: 'compact', description: 'Compact the conversation now (summarize history to free up the context window).' },
  { name: 'plan', description: 'Plan carefully before executing a task.' },
];

/** The in-process `agy acp`: the demo sessions with a step log in the profile's folder, read only. */
function demoConnection(options: AcpConnectionOptions, geminiDir: string): AcpConnection {
  const listeners = new Set<(method: string, params: unknown) => void>();
  const emit = (sessionId: string, update: unknown) => {
    for (const listener of [...listeners]) listener('session/update', { sessionId, update });
  };
  const present = () =>
    AGY_DEMO_SESSIONS.flatMap((session) => {
      const log = agyLogFile(geminiDir, session.id);
      const stat = statSync(log, { throwIfNoEntry: false });
      if (!stat) return [];
      let cwd = '';
      try {
        cwd = String((JSON.parse(readFileSync(log, 'utf8').split('\n')[0]!) as { cwd?: unknown }).cwd ?? '');
      } catch {
        cwd = '';
      }
      return [{ session, cwd, updatedAt: new Date(stat.mtimeMs).toISOString() }];
    });
  const answer = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
      case 'session/list':
        return { sessions: present().map(({ session, cwd, updatedAt }) => ({ sessionId: session.id, cwd, title: session.title, updatedAt })) };
      case 'session/load': {
        const found = present().find((p) => p.session.id === params.sessionId);
        if (!found) throw new Error(`Failed to read session ${String(params.sessionId)}`);
        for (const update of found.session.replay(found.cwd)) emit(found.session.id, update);
        emit(found.session.id, { sessionUpdate: 'session_info_update', title: found.session.title });
        return { sessionId: found.session.id, configOptions: AGY_DEMO_CONFIG };
      }
      case 'session/close':
        return {};
      case 'session/new': {
        // Only the status check (a session in the profile's own folder, closed at once) is answered: a smoke run never
        // looks like it started one.
        if (resolve(String(params.cwd ?? '')) !== resolve(geminiDir)) throw new Error(AGY_DEMO_REFUSAL);
        const sessionId = '7a1c0e52-4b3d-4e8f-9a10-0000000a67ff';
        setTimeout(() => emit(sessionId, { sessionUpdate: 'available_commands_update', availableCommands: DEMO_COMMANDS }), 0);
        return { sessionId, configOptions: AGY_DEMO_CONFIG, _meta: { antigravity: { tier: { name: 'Google AI Pro', id: 'g1-pro-tier' } } } };
      }
      default:
        throw new Error(AGY_DEMO_REFUSAL);
    }
  };
  return {
    request: (method, params) => answer(method, (params ?? {}) as Record<string, unknown>) as never,
    notify: () => {},
    initialized: () => ({ protocolVersion: 1, agentInfo: { name: 'Antigravity ACP Server', version: DEMO_VERSION } }),
    onNotification(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    handleRequests: () => {},
    hold: () => () => {},
    onExit: () => () => {},
    pid: () => null,
    dispose: async () => {},
  };
}

/** The demo's Antigravity CLI version. */
const DEMO_VERSION = '1.5.12';

/**
 * The made-up Antigravity CLI, as `ProviderOptions['antigravity']`. Its connection reads the profile's folder from the
 * `--gemini-dir` it is started with, and the demo home's `~/.gemini` without one.
 */
export function demoAntigravity(home: string): { binary: () => Promise<AgyBinary>; createConnection: (options: AcpConnectionOptions) => AcpConnection; latestVersion: AgyLatestVersion } {
  return {
    binary: async () => ({ path: '/demo/bin/agy', version: DEMO_VERSION }),
    // Up to date, so the demo never asks the network.
    latestVersion: async () => DEMO_VERSION,
    createConnection: (options) => {
      // The folder comes with the command, which is only known once asked: read it lazily, per request.
      let folder: string | null = null;
      const real = new Map<string, AcpConnection>();
      const of = async () => {
        if (folder === null) {
          const command = await options.command();
          const at = command?.args.indexOf('--gemini-dir') ?? -1;
          folder = at >= 0 ? command!.args[at + 1]! : join(home, '.gemini');
        }
        let made = real.get(folder);
        if (!made) real.set(folder, (made = demoConnection(options, folder)));
        return made;
      };
      const listeners = new Set<(method: string, params: unknown) => void>();
      const wired = new Set<AcpConnection>();
      const wire = (connection: AcpConnection) => {
        if (wired.has(connection)) return;
        wired.add(connection);
        connection.onNotification((method, params) => {
          for (const listener of [...listeners]) listener(method, params);
        });
      };
      return {
        async request(method, params) {
          const connection = await of();
          wire(connection);
          return connection.request(method, params);
        },
        notify: () => {},
        initialized: () => null,
        onNotification(listener) {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
        handleRequests: () => {},
        hold: () => () => {},
        onExit: () => () => {},
        pid: () => null,
        dispose: async () => {},
      };
    },
  };
}
