import { describe, expect, it } from 'vitest';
import { codexAnswer, codexPermissionRequest } from './codexPermissions.ts';
import type { ServerRequest, ThreadItem } from './protocol.ts';

const NOW = 1_778_600_000_000;
const base = { threadId: 'th', turnId: 'tu', startedAtMs: NOW };

/** Made-up requests in the shapes `codex app-server` sends (codex-cli 0.167). */
const COMMAND: ServerRequest = {
  id: 3,
  method: 'item/commandExecution/requestApproval',
  params: {
    ...base,
    kind: 'command',
    itemId: 'call_rm',
    environmentId: null,
    reason: 'Remove the build output',
    command: "/bin/zsh -lc 'rm -rf dist'",
    cwd: '/repo',
    commandActions: [{ type: 'unknown', command: 'rm -rf dist' }],
    proposedExecpolicyAmendment: ['rm', '-rf'],
  },
};

const FILE_CHANGE: ServerRequest = { id: 4, method: 'item/fileChange/requestApproval', params: { ...base, itemId: 'call_patch', reason: null, grantRoot: null } };
const CHANGE_ITEM = {
  type: 'fileChange',
  id: 'call_patch',
  status: 'inProgress',
  changes: [{ path: '/repo/src/app.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' }],
} as unknown as ThreadItem;

const QUESTION: ServerRequest = {
  id: 5,
  method: 'item/tool/requestUserInput',
  params: {
    ...base,
    itemId: 'call_ask',
    isBlocking: true,
    autoResolutionMs: null,
    questions: [
      { id: 'db', header: 'Database', question: 'Which database?', isOther: true, isSecret: false, options: [{ label: 'Postgres', description: 'The default' }, { label: 'SQLite', description: '' }] },
      { id: 'name', header: 'Name', question: 'What should the service be called?', isOther: true, isSecret: false, options: null },
    ],
  },
};

describe('codexPermissionRequest', () => {
  it('shows a command as Bash, without the shell around it, with its reason', () => {
    expect(codexPermissionRequest('3', COMMAND, null, NOW)).toEqual({
      requestId: '3',
      toolName: 'Bash',
      toolUseId: 'tu~call_rm',
      input: { command: 'rm -rf dist', cwd: '/repo', description: 'Remove the build output' },
      title: 'Codex wants to run a command',
      description: 'Remove the build output',
      decisionReason: null,
      blockedPath: null,
      alwaysLabel: 'Allow this command in this session',
      agentId: null,
      createdAt: NOW,
    });
  });

  it('offers Always allow only when Codex takes it', () => {
    const only = (decisions: unknown[]) => ({ ...COMMAND, params: { ...(COMMAND.params as object), availableDecisions: decisions } });
    expect(codexPermissionRequest('3', only(['accept', 'acceptForSession', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['rm'] } }, 'cancel']), null, NOW)?.alwaysLabel).toBe('Allow this command in this session');
    expect(codexPermissionRequest('3', only(['accept', 'decline', 'cancel']), null, NOW)?.alwaysLabel).toBeNull();
  });

  it('takes the command from the item when the request has none', () => {
    const request = { ...COMMAND, params: { ...(COMMAND.params as object), command: null, cwd: null } };
    const item = { type: 'commandExecution', id: 'call_rm', command: "/bin/zsh -lc 'ls'", cwd: '/repo' } as unknown as ThreadItem;
    expect(codexPermissionRequest('3', request, item, NOW)?.input).toEqual({ command: 'ls', cwd: '/repo', description: 'Remove the build output' });
  });

  it('shows a file change with the diff from its item', () => {
    expect(codexPermissionRequest('4', FILE_CHANGE, CHANGE_ITEM, NOW)).toMatchObject({
      toolName: 'Edit',
      toolUseId: 'tu~call_patch',
      input: { file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' },
      title: 'Codex wants to edit app.ts',
      alwaysLabel: 'Allow changes to these files in this session',
    });
    const add = { ...CHANGE_ITEM, changes: [{ path: '/repo/new.ts', kind: { type: 'add' }, diff: 'x\n' }] } as unknown as ThreadItem;
    expect(codexPermissionRequest('4', FILE_CHANGE, add, NOW)).toMatchObject({ toolName: 'Write', input: { file_path: '/repo/new.ts', content: 'x\n' }, title: 'Codex wants to create new.ts' });
  });

  it('lists several changes, and says so when Codex asks for a whole folder', () => {
    const two = { ...CHANGE_ITEM, changes: [...(CHANGE_ITEM as unknown as { changes: unknown[] }).changes, { path: '/repo/b.ts', kind: { type: 'delete' }, diff: '' }] } as unknown as ThreadItem;
    const several = codexPermissionRequest('4', FILE_CHANGE, two, NOW)!;
    expect(several).toMatchObject({ toolName: 'Edit', title: 'Codex wants to change 2 files', description: '/repo/src/app.ts\n/repo/b.ts', input: { file_path: '/repo/src/app.ts' } });
    expect((several.input as { changes: unknown[] }).changes).toEqual([
      { path: '/repo/src/app.ts', name: 'Edit', input: { file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' } },
      { path: '/repo/b.ts', name: 'Delete', input: { file_path: '/repo/b.ts' } },
    ]);
    const root = { ...FILE_CHANGE, params: { ...(FILE_CHANGE.params as object), grantRoot: '/repo/out' } };
    expect(codexPermissionRequest('4', root, null, NOW)).toMatchObject({
      toolName: 'Edit',
      input: { file_path: '/repo/out' },
      title: 'Codex wants to write in /repo/out',
      description: 'Allow lets Codex change any file in /repo/out for the rest of this session.',
    });
  });

  it('shows questions on the question card', () => {
    expect(codexPermissionRequest('5', QUESTION, null, NOW)).toMatchObject({
      toolName: 'AskUserQuestion',
      toolUseId: 'tu~call_ask',
      alwaysLabel: null,
      input: {
        questions: [
          { question: 'Which database?', header: 'Database', multiSelect: false, options: [{ label: 'Postgres', description: 'The default' }, { label: 'SQLite', description: '' }] },
          { question: 'What should the service be called?', header: 'Name', multiSelect: false, options: [] },
        ],
      },
    });
  });

  it('leaves out the requests Seshboard does not show', () => {
    for (const method of ['item/permissions/requestApproval', 'mcpServer/elicitation/request', 'item/tool/call', 'applyPatchApproval', 'execCommandApproval', 'account/chatgptAuthTokens/refresh']) {
      expect(codexPermissionRequest('9', { id: 9, method, params: base }, null, NOW)).toBeNull();
    }
    expect(codexPermissionRequest('9', { id: 9, method: 'item/tool/requestUserInput', params: { ...base, questions: [] } }, null, NOW)).toBeNull();
    expect(() => codexPermissionRequest('9', { id: 9, method: 'item/commandExecution/requestApproval', params: null }, null, NOW)).not.toThrow();
  });
});

describe('codexAnswer', () => {
  it('answers approvals with Codex decisions', () => {
    expect(codexAnswer(COMMAND, { behavior: 'allow' })).toEqual({ decision: 'accept' });
    expect(codexAnswer(COMMAND, { behavior: 'allow', always: true })).toEqual({ decision: 'acceptForSession' });
    expect(codexAnswer(FILE_CHANGE, { behavior: 'deny' })).toEqual({ decision: 'decline' });
    expect(codexAnswer(FILE_CHANGE, { behavior: 'deny', interrupt: true })).toEqual({ decision: 'cancel' });
  });

  it('declines a command edited on the card, which Codex cannot run instead', () => {
    expect(codexAnswer(COMMAND, { behavior: 'allow', updatedInput: { command: 'rm -rf dist/cache' } })).toEqual({ decision: 'decline' });
    expect(codexAnswer(COMMAND, { behavior: 'allow', updatedInput: { command: 'rm -rf dist' } })).toEqual({ decision: 'accept' });
  });

  it('answers questions by their id', () => {
    const answers = { 'Which database?': 'SQLite', 'What should the service be called?': 'health-api' };
    expect(codexAnswer(QUESTION, { behavior: 'allow', updatedInput: { answers } })).toEqual({ answers: { db: { answers: ['SQLite'] }, name: { answers: ['health-api'] } } });
    expect(codexAnswer(QUESTION, { behavior: 'deny' })).toEqual({ answers: {} });
    expect(codexAnswer({ id: 1, method: 'item/tool/call', params: {} }, { behavior: 'allow' })).toBeNull();
  });
});
