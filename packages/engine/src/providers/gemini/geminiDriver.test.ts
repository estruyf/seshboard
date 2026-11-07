import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { geminiCandidates, npmGemini, parseGeminiVersion } from './geminiBinary.ts';
import { geminiModeId, geminiSignIn, geminiStatus, geminiToolCard, geminiToolNameOf, isModeNote, promptIdIn } from './geminiDriver.ts';
import { detectGeminiInstall, geminiUpdatesOff } from './geminiUpdate.ts';

describe("Gemini's modes", () => {
  it("are Gemini CLI's approval modes, and a read-only session asks before anything that writes", () => {
    expect(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'].map((m) => geminiModeId(m as never))).toEqual(['default', 'autoEdit', 'plan', 'yolo', 'default']);
    expect(geminiModeId('auto', true)).toBe('default');
    expect(isModeNote('[MODE_UPDATE] yolo')).toBe(true);
    expect(isModeNote('Done.')).toBe(false);
  });
});

describe('tool calls over ACP', () => {
  it("reads a tool's name from the id Gemini gives its call", () => {
    expect(geminiToolNameOf({ toolCallId: 'write_todos-1771604241605-3' })).toBe('write_todos');
    expect(geminiToolNameOf({ toolCallId: 'run_shell_command_1771604241605_0' })).toBe('run_shell_command');
    expect(geminiToolNameOf({ toolCallId: 'abc' })).toBeNull();
  });

  it('names an MCP tool, and a tool ACP has no kind for, as Claude Code would', () => {
    expect(geminiToolCard({ toolCallId: 'x', kind: 'other', title: 'search docs', _meta: { 'gemini-cli': { mcp: { server_name: 'docs', tool_name: 'search' } } } })).toEqual({ toolName: 'mcp__docs__search', input: { description: 'search docs' } });
    expect(geminiToolCard({ toolCallId: 'google_web_search-1771604241605-1', kind: 'other', title: 'Searching the web for: "vitest"' })).toEqual({ toolName: 'WebSearch', input: { description: 'Searching the web for: "vitest"' } });
    expect(geminiToolCard({ toolCallId: 'run_shell_command-1771604241605-1', kind: 'execute', title: 'npm test' })).toBeNull();
  });
});

describe('promptIdIn', () => {
  const at = Date.parse('2026-11-07T10:00:00.000Z');
  const conversation = {
    sessionId: 's',
    messages: [
      { id: 'old', type: 'user', timestamp: '2026-11-07T09:00:00.000Z', content: [{ text: 'hi' }] },
      { id: 'reply', type: 'gemini', timestamp: '2026-11-07T10:00:01.000Z', content: 'Hello' },
      { id: 'new', type: 'user', timestamp: '2026-11-07T10:00:02.000Z', content: [{ text: 'hi' }, { text: '\n--- Content from referenced files ---' }], displayContent: [{ text: 'hi' }] },
    ],
  };
  it('finds the prompt Gemini wrote since it was sent, by its text', () => {
    expect(promptIdIn(conversation, 'hi', at)).toBe('new');
    expect(promptIdIn({ ...conversation, messages: conversation.messages.slice(0, 2) }, 'hi', at)).toBeNull();
    expect(promptIdIn(null, 'hi', at)).toBeNull();
  });
});

describe('signed in to Gemini CLI', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'seshboard-gemini-auth-'));
  it("reads how Gemini signs in and its account's email, never a credential", () => {
    const google = dir();
    writeFileSync(join(google, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
    writeFileSync(join(google, 'oauth_creds.json'), '{"never":"read"}');
    writeFileSync(join(google, 'google_accounts.json'), JSON.stringify({ active: 'me@example.com', old: [] }));
    expect(geminiSignIn(google, {})).toEqual({ signedIn: true, account: 'me@example.com' });
    expect(geminiStatus({ path: '/bin/gemini', version: '0.67.0' }, google, {})).toEqual({ binary: '/bin/gemini', version: '0.67.0', signedIn: true, account: 'me@example.com', login: 'me@example.com', problem: null });

    const key = dir();
    writeFileSync(join(key, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } }));
    expect(geminiSignIn(key, {})).toEqual({ signedIn: false, account: null });
    expect(geminiSignIn(key, { GEMINI_API_KEY: 'x' })).toEqual({ signedIn: true, account: 'API key' });

    expect(geminiStatus({ path: '/bin/gemini', version: null }, dir(), {})).toMatchObject({ signedIn: false, problem: expect.stringContaining('Not signed in to Gemini CLI') });
  });
});

describe('finding gemini', () => {
  it('looks on PATH, then where Homebrew and npm put it', () => {
    expect(geminiCandidates({ PATH: '/a:/b' }, '/Users/me', 'darwin')).toEqual(['/a/gemini', '/b/gemini', '/Users/me/.local/bin/gemini', '/opt/homebrew/bin/gemini', '/usr/local/bin/gemini', '/Users/me/.npm-global/bin/gemini']);
    expect(geminiCandidates({ PATH: 'C:\\bin' }, 'C:\\Users\\me', 'win32')).toEqual(['C:\\bin\\gemini.exe']);
  });

  it("runs npm's script with node on Windows, where npm leaves only a .cmd", () => {
    const files = new Set(['C:\\node\\node.exe', 'C:\\npm\\gemini.cmd', 'C:\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js']);
    const found = npmGemini({ PATH: 'C:\\node;C:\\npm' }, 'win32', { exists: (p) => files.has(p), readJson: () => ({ bin: { gemini: 'bundle/gemini.js' } }) });
    expect(found).toEqual({ path: 'C:\\node\\node.exe', args: ['C:\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js'] });
    expect(npmGemini({ PATH: '/x' }, 'darwin', { exists: () => true, readJson: () => null })).toBeNull();
  });

  it('reads its version', () => {
    expect(parseGeminiVersion('0.67.0\n')).toBe('0.67.0');
    expect(parseGeminiVersion('0.68.0-preview.1')).toBe('0.68.0-preview.1');
  });
});

describe("Gemini CLI's updates", () => {
  it('updates it the way it was installed', () => {
    expect(detectGeminiInstall('/opt/homebrew/Cellar/gemini-cli/0.67.0/libexec/lib/node_modules/@google/gemini-cli/bundle/gemini.js', 'darwin')).toMatchObject({ method: 'homebrew', command: 'brew upgrade gemini-cli', run: { file: '/opt/homebrew/bin/brew' } });
    expect(detectGeminiInstall('/usr/local/lib/node_modules/@google/gemini-cli/bundle/gemini.js', 'linux')).toMatchObject({ method: 'npm', run: { file: '/usr/local/bin/npm', args: ['install', '-g', '@google/gemini-cli@latest'] } });
    expect(detectGeminiInstall('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js', 'win32')).toMatchObject({ method: 'npm', run: { args: ['install', '-g', '--prefix', 'C:\\Users\\me\\AppData\\Roaming\\npm', '@google/gemini-cli@latest'] } });
    expect(detectGeminiInstall('/home/me/.bun/install/global/node_modules/@google/gemini-cli/bundle/gemini.js', 'linux')).toMatchObject({ run: null, command: 'bun install -g @google/gemini-cli@latest' });
  });

  it("doesn't nag when Gemini's own update nag is off", () => {
    expect(geminiUpdatesOff(JSON.stringify({ general: { disableUpdateNag: true } }), {})).toBe(true);
    expect(geminiUpdatesOff('{}', { CI: '1' })).toBe(true);
    expect(geminiUpdatesOff('{}', {})).toBe(false);
  });
});
