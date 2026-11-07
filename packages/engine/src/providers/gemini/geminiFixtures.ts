/**
 * Records shaped as Gemini CLI writes them (`ChatRecordingService` in `@google/gemini-cli-core` 0.67.0, and a 0.29
 * session's `.json`), for the tests. Ids and text are made up; the fields, their nesting and the order of the lines are
 * Gemini's.
 */

export const SESSION = '8e189f48-0f7b-4c63-98b4-c867bf4ae604';
export const PROJECT_HASH = '2d462e0865044f6d4daf219358e6c5047688d8a4d5e6e7770381935495e239fb';

const line = (record: unknown) => JSON.stringify(record);

/** The prompt Gemini CLI starts a session with: its own context, not yours. */
export const CONTEXT_PROMPT = { id: 'c0000000-0000-4000-8000-000000000000', timestamp: '2026-11-07T10:00:00.000Z', type: 'user', content: [{ text: '<session_context>\nThis is the Gemini CLI. We are setting up the context for our chat.\n</session_context>' }] };

export const PROMPT = { id: 'u1000000-0000-4000-8000-000000000001', timestamp: '2026-11-07T10:00:05.000Z', type: 'user', content: [{ text: 'Round the total to cents' }, { text: '\n--- Content from referenced files ---' }], displayContent: [{ text: 'Round the total to cents' }] };

export const REPLY = {
  id: 'g1000000-0000-4000-8000-000000000002',
  timestamp: '2026-11-07T10:00:09.000Z',
  type: 'gemini',
  content: 'I will look at how the total is computed.',
  thoughts: [{ subject: 'Finding the total', description: 'The total lives in cart.ts.', timestamp: '2026-11-07T10:00:07.000Z' }],
  tokens: { input: 7875, output: 55, cached: 0, thoughts: 332, tool: 0, total: 8262 },
  model: 'gemini-2.5-pro',
};

export const TOOLS = {
  id: 'g1000000-0000-4000-8000-000000000003',
  timestamp: '2026-11-07T10:00:12.000Z',
  type: 'gemini',
  content: '',
  model: 'gemini-2.5-pro',
  toolCalls: [
    {
      id: 'read_file_1771604034776_0',
      name: 'read_file',
      args: { file_path: 'src/cart.ts' },
      result: [{ functionResponse: { id: 'read_file_1771604034776_0', name: 'read_file', response: { output: 'export const total = (lines) => lines.reduce((a, l) => a + l.price, 0);' } } }],
      status: 'success',
      timestamp: '2026-11-07T10:00:11.000Z',
      resultDisplay: '',
      displayName: 'ReadFile',
      description: 'Reads and returns the content of a specified file.',
      renderOutputAsMarkdown: true,
    },
    {
      id: 'replace_1771604063311_0',
      name: 'replace',
      args: { file_path: '/repo/src/cart.ts', old_string: 'lines.reduce(', new_string: 'Math.round(lines.reduce(', instruction: 'Round the total' },
      result: [{ functionResponse: { id: 'replace_1771604063311_0', name: 'replace', response: { output: 'Successfully modified file: /repo/src/cart.ts (1 replacements).' } } }],
      status: 'success',
      timestamp: '2026-11-07T10:00:12.000Z',
      resultDisplay: { fileDiff: 'Index: cart.ts\n', fileName: 'cart.ts', originalContent: 'a', newContent: 'b' },
      displayName: 'Edit',
    },
    {
      id: 'run_shell_command_1771604241605_0',
      name: 'run_shell_command',
      args: { command: 'npm test', description: 'Run the tests.', dir_path: '.' },
      result: [{ functionResponse: { id: 'run_shell_command_1771604241605_0', name: 'run_shell_command', response: { error: 'Tool "run_shell_command" was canceled by the user.' } } }],
      status: 'cancelled',
      timestamp: '2026-11-07T10:00:12.500Z',
      resultDisplay: 'Tool "run_shell_command" was canceled by the user.',
      displayName: 'Shell',
    },
  ],
};

export const LAST = { id: 'g1000000-0000-4000-8000-000000000004', timestamp: '2026-11-07T10:00:20.000Z', type: 'gemini', content: 'The total is now rounded to cents.', model: 'gemini-2.5-pro' };

export const INFO = { id: 'i1000000-0000-4000-8000-000000000005', timestamp: '2026-11-07T10:00:21.000Z', type: 'info', content: 'Switched to fallback model gemini-2.5-flash' };

/** A session as Gemini CLI 0.67 writes it: a header, then every message as it changes. */
export function sessionJsonl(options: { summary?: string; sessionId?: string } = {}): string {
  const sessionId = options.sessionId ?? SESSION;
  return [
    line({ sessionId, projectHash: PROJECT_HASH, startTime: '2026-11-07T10:00:00.000Z', lastUpdated: '2026-11-07T10:00:00.000Z', kind: 'main' }),
    line(CONTEXT_PROMPT),
    line(PROMPT),
    line({ $set: { lastUpdated: '2026-11-07T10:00:05.000Z' } }),
    // Written without its tokens first, then again with them (same id): the last copy counts.
    line({ ...REPLY, tokens: null }),
    line(REPLY),
    line(TOOLS),
    line(LAST),
    line(INFO),
    ...(options.summary ? [line({ $set: { summary: options.summary } })] : []),
  ].join('\n') + '\n';
}

/** A 0.29 session: one JSON object, written whole each time. */
export function sessionJson(sessionId = SESSION): string {
  return JSON.stringify({ sessionId, projectHash: PROJECT_HASH, startTime: '2026-02-20T16:12:00.000Z', lastUpdated: '2026-02-20T16:20:00.000Z', messages: [PROMPT, REPLY], summary: 'Make app appear in Dock & show bookmarks on click.' }, null, 2);
}
