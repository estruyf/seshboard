import { basename, join } from 'node:path';
import type { AcpConnection, AcpConnectionOptions } from '../acp/acpConnection.ts';
import type { GeminiBinary } from './geminiBinary.ts';
import type { GeminiLatestVersion } from './geminiUpdate.ts';

/** What the demo's Gemini says when asked to run a session. */
export const GEMINI_DEMO_REFUSAL = 'The demo has no Gemini CLI to run sessions';

/** The account the demo's Gemini CLI is signed in as. */
export const GEMINI_DEMO_ACCOUNT = 'demo-user@example.com';

/**
 * A made-up Google Gemini CLI for the demo home (the smoke test and the screenshots), in the process: installed and,
 * with the files `geminiDemoFiles` writes, signed in, with Gemini CLI's own list of models. Its ACP agent refuses to
 * start or load a session (`GEMINI_DEMO_REFUSAL`). Nothing is spawned and nothing ever reaches a real Gemini.
 */
export function demoGemini(): { binary: () => Promise<GeminiBinary | null>; createConnection: (options: AcpConnectionOptions) => AcpConnection; latestVersion: GeminiLatestVersion } {
  const connection: AcpConnection = {
    request: () => Promise.reject(new Error(GEMINI_DEMO_REFUSAL)),
    notify: () => {},
    initialized: () => null,
    onNotification: () => () => {},
    handleRequests: () => {},
    hold: () => () => {},
    onExit: () => () => {},
    pid: () => null,
    dispose: async () => {},
  };
  return {
    binary: async () => ({ path: '/usr/local/bin/gemini', version: '0.67.0' }),
    createConnection: () => connection,
    // Up to date: Settings › About shows the check without a toast over the other steps.
    latestVersion: async () => '0.67.0',
  };
}

/** One file of the demo home, relative to it. */
export interface DemoFile {
  path: string;
  content: string;
  /** When it was last written (its time on disk). */
  at: Date;
}

const iso = (at: number) => new Date(at).toISOString();

/** The demo's Gemini sessions on a project, newest first: their ids, and how long before `at` each ended. */
export const GEMINI_DEMO_SESSIONS = [
  { id: '6e3a1d20-4b7c-4f0e-9a51-0c2f9b7de001', hoursAgo: 0, title: 'Show the cart total with tax' },
  { id: '6e3a1d20-4b7c-4f0e-9a51-0c2f9b7de002', hoursAgo: 26, title: null },
] as const;

/**
 * Gemini CLI's files for the demo's sessions on `cwd`, as Gemini 0.67 writes them: the project's folder named after
 * the folder (with its `.project_root`), `projects.json`, each session's file in `chats/`, and what says it is signed
 * in (its way to sign in in `settings.json`, the account in `google_accounts.json`; no credential, as there is none).
 */
export function geminiDemoFiles(cwd: string, at: number): DemoFile[] {
  const project = basename(cwd);
  const chats = join('.gemini', 'tmp', project, 'chats');
  const now = new Date(at);
  const files: DemoFile[] = [
    { path: join('.gemini', 'settings.json'), content: `${JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }, null, 2)}\n`, at: now },
    { path: join('.gemini', 'google_accounts.json'), content: `${JSON.stringify({ active: GEMINI_DEMO_ACCOUNT, old: [] }, null, 2)}\n`, at: now },
    { path: join('.gemini', 'projects.json'), content: `${JSON.stringify({ projects: { [cwd]: project } }, null, 2)}\n`, at: now },
    { path: join('.gemini', 'tmp', project, '.project_root'), content: cwd, at: now },
  ];
  const [first, second] = GEMINI_DEMO_SESSIONS;
  const end = at - first.hoursAgo * 3_600_000;
  const start = end - 4 * 60_000;
  const t = (seconds: number) => iso(start + seconds * 1000);
  const file = join(cwd, 'src', 'cart', 'total.ts');
  const records = [
    { sessionId: first.id, projectHash: project, startTime: t(0), lastUpdated: t(0), kind: 'main' },
    { id: 'gd1-context', timestamp: t(0), type: 'user', content: [{ text: '<session_context>\nThis is the Gemini CLI. We are setting up the context for our chat.\n</session_context>' }] },
    { id: 'gd1-prompt', timestamp: t(2), type: 'user', content: [{ text: 'Show the cart total with tax, rounded to cents' }] },
    {
      id: 'gd1-read',
      timestamp: t(8),
      type: 'gemini',
      content: 'I will read how the total is computed first.',
      thoughts: [{ subject: 'Finding the total', description: 'The total is computed in src/cart/total.ts.', timestamp: t(5) }],
      model: 'gemini-2.5-pro',
      tokens: { input: 8120, output: 48, cached: 0, thoughts: 210, tool: 0, total: 8378 },
      toolCalls: [
        {
          id: 'read_file_1762510000000_0',
          name: 'read_file',
          args: { file_path: 'src/cart/total.ts' },
          result: [{ functionResponse: { id: 'read_file_1762510000000_0', name: 'read_file', response: { output: 'export const total = (lines: Line[]) => lines.reduce((sum, l) => sum + l.price * l.qty, 0);\n' } } }],
          status: 'success',
          timestamp: t(9),
          resultDisplay: '',
          displayName: 'ReadFile',
        },
      ],
    },
    {
      id: 'gd1-edit',
      timestamp: t(40),
      type: 'gemini',
      content: '',
      model: 'gemini-2.5-pro',
      toolCalls: [
        {
          id: 'replace_1762510040000_0',
          name: 'replace',
          args: { file_path: file, old_string: 'lines.reduce((sum, l) => sum + l.price * l.qty, 0)', new_string: 'Math.round(lines.reduce((sum, l) => sum + l.price * l.qty, 0) * (1 + TAX) * 100) / 100', instruction: 'Add tax and round to cents' },
          result: [{ functionResponse: { id: 'replace_1762510040000_0', name: 'replace', response: { output: `Successfully modified file: ${file} (1 replacements).` } } }],
          status: 'success',
          timestamp: t(42),
          resultDisplay: { fileName: 'total.ts', filePath: file, fileDiff: '', originalContent: '', newContent: '' },
          displayName: 'Edit',
        },
        {
          id: 'run_shell_command_1762510050000_0',
          name: 'run_shell_command',
          args: { command: 'npm test -- cart', description: 'Run the cart tests.' },
          result: [{ functionResponse: { id: 'run_shell_command_1762510050000_0', name: 'run_shell_command', response: { output: 'Output:  ✓ cart/total.test.ts (4 tests)\nExit Code: 0' } } }],
          status: 'success',
          timestamp: t(60),
          resultDisplay: ' ✓ cart/total.test.ts (4 tests)',
          displayName: 'Shell',
        },
      ],
    },
    { id: 'gd1-reply', timestamp: t(70), type: 'gemini', content: 'The cart total now adds tax and rounds to cents. The cart tests pass.', model: 'gemini-2.5-pro' },
    { $set: { lastUpdated: t(70), summary: first.title } },
  ];
  const stamp = (time: number) => new Date(time).toISOString().slice(0, 16).replace(/:/g, '-');
  files.push({ path: join(chats, `session-${stamp(start)}-${first.id.slice(0, 8)}.jsonl`), content: `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, at: new Date(end) });

  const end2 = at - second.hoursAgo * 3_600_000;
  const t2 = (seconds: number) => iso(end2 - 60_000 + seconds * 1000);
  const older = [
    { sessionId: second.id, projectHash: project, startTime: t2(0), lastUpdated: t2(30), kind: 'main' },
    { id: 'gd2-prompt', timestamp: t2(1), type: 'user', content: [{ text: 'What does the checkout page do when the cart is empty?' }] },
    { id: 'gd2-reply', timestamp: t2(30), type: 'gemini', content: 'It shows "Your cart is empty" with a link back to the products, and hides the checkout button.', model: 'gemini-2.5-flash' },
  ];
  files.push({ path: join(chats, `session-${stamp(end2 - 60_000)}-${second.id.slice(0, 8)}.jsonl`), content: `${older.map((r) => JSON.stringify(r)).join('\n')}\n`, at: new Date(end2) });
  return files;
}
