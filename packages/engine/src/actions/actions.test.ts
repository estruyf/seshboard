import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectAction } from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { posixQuote, powershellQuote, windowsUnsafe } from '../system/shell.ts';
import { ActionStore, expandCommand, suggestActions } from './actionStore.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-actions-')));
  dirs.push(dir);
  return dir;
};
const action = (overrides: Partial<ProjectAction> & { id: string }) => ProjectAction.parse({ name: overrides.id, command: `echo ${overrides.id}`, ...overrides });

function setup() {
  const data = tempDir();
  const project = tempDir();
  const cache = openCacheDatabase(join(data, 'cache.sqlite'));
  return { store: new ActionStore(cache.db), project, cache };
}

describe('ActionStore', () => {
  it('merges yours, shared and global actions with yours winning', () => {
    const { store, project, cache } = setup();
    store.save(null, action({ id: 'test', name: 'Global test' }));
    store.save(null, action({ id: 'lint' }));
    writeFileSync(join(project, '.switchboard.json'), JSON.stringify({ actions: [{ name: 'Test', command: 'npm test' }, { name: 'Deploy', command: 'make deploy', confirm: true }] }));
    store.save(project, action({ id: 'deploy', name: 'My deploy', command: 'make deploy-staging' }));
    const { actions, sharedFile, errors } = store.list(project);
    const byId = Object.fromEntries(actions.map((a) => [a.id, a]));
    expect(sharedFile).toBe(join(project, '.switchboard.json'));
    expect(errors).toEqual([]);
    expect(byId.test).toMatchObject({ name: 'Test', scope: 'shared', trusted: false });
    expect(byId.deploy).toMatchObject({ name: 'My deploy', scope: 'project', trusted: true });
    expect(byId.lint).toMatchObject({ scope: 'global' });
    cache.close();
  });

  it('reports bad shared entries without dropping the good ones', () => {
    const { store, project, cache } = setup();
    writeFileSync(join(project, '.switchboard.json'), JSON.stringify({ actions: [{ name: 'Ok', command: 'true' }, { name: 'No command' }] }));
    const { actions, errors } = store.list(project);
    expect(actions.map((a) => a.id)).toEqual(['ok']);
    expect(errors).toHaveLength(1);
    writeFileSync(join(project, '.switchboard.json'), '{ nope');
    expect(store.list(project).errors[0]).toMatch(/\.switchboard\.json/);
    cache.close();
  });

  it('trusts a shared command by its exact text', () => {
    const { store, project, cache } = setup();
    writeFileSync(join(project, '.switchboard.json'), JSON.stringify({ actions: [{ id: 'build', name: 'Build', command: 'npm run build' }] }));
    store.trust(project, 'npm run build');
    expect(store.list(project).actions[0]!.trusted).toBe(true);
    writeFileSync(join(project, '.switchboard.json'), JSON.stringify({ actions: [{ id: 'build', name: 'Build', command: 'npm run build && curl evil' }] }));
    expect(store.list(project).actions[0]!.trusted).toBe(false);
    cache.close();
  });

  it('updates, renames and deletes your actions', () => {
    const { store, project, cache } = setup();
    store.save(project, action({ id: 'dev', command: 'npm run dev' }));
    store.save(project, action({ id: 'dev', command: 'pnpm dev' }));
    expect(store.list(project).actions).toMatchObject([{ id: 'dev', command: 'pnpm dev' }]);
    store.save(project, action({ id: 'serve', command: 'pnpm dev' }), 'dev');
    expect(store.list(project).actions.map((a) => a.id)).toEqual(['serve']);
    store.remove(project, 'serve');
    expect(store.list(project).actions).toEqual([]);
    cache.close();
  });

  it('saves, renames and deletes shared actions in .switchboard.json, keeping what it does not know', () => {
    const { store, project, cache } = setup();
    const file = join(project, '.switchboard.json');
    writeFileSync(file, `{\n    "icon": "rocket",\n    "actions": [\n        { "name": "Test", "command": "npm test", "note": "keep" }\n    ]\n}\n`);
    store.saveShared(project, action({ id: 'dev', name: 'Dev', command: 'npm run dev', shortcut: 'cmd+shift+d', confirm: true }));
    const after = readFileSync(file, 'utf8');
    expect(after.startsWith('{\n    "icon": "rocket"')).toBe(true);
    expect(JSON.parse(after).actions).toEqual([
      { name: 'Test', command: 'npm test', note: 'keep' },
      { id: 'dev', name: 'Dev', command: 'npm run dev', confirm: true, shortcut: 'cmd+shift+d' },
    ]);
    // You saved it, so it is approved for you.
    expect(store.list(project).actions.find((a) => a.id === 'dev')).toMatchObject({ scope: 'shared', trusted: true, confirm: true });

    // Back to the defaults: those keys go. A hand-written entry gets its id, its place and its own keys kept.
    store.saveShared(project, action({ id: 'dev', name: 'Dev', command: 'npm run dev' }));
    store.saveShared(project, action({ id: 'unit', name: 'Unit', command: 'npm test' }), 'test');
    expect(JSON.parse(readFileSync(file, 'utf8')).actions).toEqual([
      { id: 'unit', name: 'Unit', command: 'npm test', note: 'keep' },
      { id: 'dev', name: 'Dev', command: 'npm run dev' },
    ]);

    store.removeShared(project, 'unit');
    store.removeShared(project, 'dev');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ icon: 'rocket' });
    cache.close();
  });

  it('creates .switchboard.json for the first shared action, and refuses one that does not read', () => {
    const { store, project, cache } = setup();
    store.saveShared(project, action({ id: 'dev', name: 'Dev' }));
    expect(JSON.parse(readFileSync(join(project, '.switchboard.json'), 'utf8'))).toEqual({ actions: [{ id: 'dev', name: 'Dev', command: 'echo dev' }] });
    writeFileSync(join(project, '.switchboard.json'), '{ broken');
    expect(() => store.saveShared(project, action({ id: 'dev' }))).toThrow(/can't be read/);
    cache.close();
  });

  it('keeps whether an action sends its output to Claude', () => {
    const { store, project, cache } = setup();
    store.save(project, action({ id: 'test', command: 'npm test', sendOutput: true }));
    store.save(project, action({ id: 'dev', command: 'npm run dev' }));
    expect(store.list(project).actions.map((a) => [a.id, a.sendOutput])).toEqual([
      ['test', true],
      ['dev', false],
    ]);
    store.save(project, action({ id: 'test', command: 'npm test', sendOutput: false }));
    expect(store.list(project).actions.find((a) => a.id === 'test')!.sendOutput).toBe(false);
    cache.close();
  });
});

describe('expandCommand', () => {
  const vars = { cwd: '/repo/wt', projectRoot: '/repo', branch: "feat/x'; rm -rf ~ #", worktreeName: 'wt', sessionId: 's1', sessionTitle: 'Fix "login"' };
  // That the quoting holds in each shell is tested in system/shell.test.ts.
  const posix = { kind: 'posix' as const, quote: posixQuote, unsafe: () => null };
  const powershell = { kind: 'powershell' as const, quote: powershellQuote, unsafe: windowsUnsafe };
  it('quotes values for the shell that runs them, so they cannot inject commands', () => {
    expect(expandCommand('git push origin ${branch} && echo ${unknown}', vars, posix)).toBe(`git push origin ${posixQuote(vars.branch)} && echo \${unknown}`);
    expect(expandCommand('git push origin ${branch}', vars, powershell)).toBe(`git push origin 'feat/x''; rm -rf ~ #'`);
  });
  it('refuses a value cmd.exe would read again on Windows, but only where the action uses it', () => {
    // A .cmd or .bat program re-reads its arguments: `&` would run a command whatever PowerShell's quoting.
    for (const branch of ['x&whoami', 'x|calc', 'a"b', '%PATH%', '!PATH!', 'a^b', 'a<b', 'a\nb']) {
      expect(() => expandCommand('gradlew.bat -Pbranch=${branch}', { ...vars, branch }, powershell)).toThrow(expect.objectContaining({ code: 'UNSAFE_VALUE' }));
    }
    expect(() => expandCommand('build.cmd ${sessionTitle}', vars, powershell)).toThrow(/\$\{sessionTitle\} contains a double quote.*session title/);
    // A title with `"` is fine in an action that doesn't use it, and anywhere outside Windows.
    expect(expandCommand('build.cmd ${worktreeName}', vars, powershell)).toBe("build.cmd 'wt'");
    expect(expandCommand('echo ${sessionTitle}', vars, posix)).toBe(`echo ${posixQuote(vars.sessionTitle)}`);
  });
  it('inserts a value written inside double quotes as it is, so a command in it does not run', () => {
    const title = '$(rm -rf ~)';
    // Quoted again inside the double quotes, the value would still run: those are refused.
    expect(() => expandCommand('echo "${sessionTitle}"', { ...vars, sessionTitle: title }, posix)).toThrow(expect.objectContaining({ code: 'UNSAFE_VALUE' }));
    expect(() => expandCommand('echo "${branch}"', { ...vars, branch: 'x`whoami`' }, posix)).toThrow(expect.objectContaining({ code: 'UNSAFE_VALUE' }));
    expect(() => expandCommand('echo "${branch}"', { ...vars, branch: 'a!b' }, posix)).toThrow(expect.objectContaining({ code: 'UNSAFE_VALUE' }));
    expect(() => expandCommand('echo "${worktreeName}" "$HOME"', { ...vars, worktreeName: '$x' }, posix)).toThrow(expect.objectContaining({ code: 'UNSAFE_VALUE' }));
    expect(expandCommand('echo "${sessionTitle}"', { ...vars, sessionTitle: "it's" }, posix)).toBe(`echo "it's"`);
    expect(expandCommand('cd "${cwd}"', vars, posix)).toBe('cd "/repo/wt"');
    // PowerShell reads `$` and the backtick inside double quotes, not `\`, so a Windows path goes in as it is.
    expect(expandCommand('cd "${cwd}"', { ...vars, cwd: 'C:\\Users\\me\\wt' }, powershell)).toBe('cd "C:\\Users\\me\\wt"');
    expect(() => expandCommand('echo "${branch}"', { ...vars, branch: 'a$b' }, powershell)).toThrow(expect.objectContaining({ code: 'UNSAFE_VALUE' }));
    // Single quotes in the action close nothing: the placeholder after them is quoted again.
    expect(expandCommand("echo '${branch}'", { ...vars, branch: 'a$b' }, posix)).toBe(`echo '${posixQuote('a$b')}'`);
    // An escaped quote in the action doesn't open double quotes.
    expect(expandCommand('echo \\"${branch}\\"', { ...vars, branch: 'a$b' }, posix)).toBe(`echo \\"${posixQuote('a$b')}\\"`);
  });
  it('leaves prompt text unquoted', () => {
    expect(expandCommand('Review ${sessionTitle} on ${branch}', vars, null)).toBe(`Review Fix "login" on ${vars.branch}`);
  });
});

describe('suggestActions', () => {
  it('offers package.json scripts with the right package manager, plus git basics', () => {
    const project = tempDir();
    writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', test: 'vitest', release: 'x' } }));
    writeFileSync(join(project, 'pnpm-lock.yaml'), '');
    const suggestions = suggestActions(project);
    expect(suggestions).toEqual(
      expect.arrayContaining([
        { name: 'Dev', command: 'pnpm dev', type: 'shell', icon: 'play' },
        { name: 'Test', command: 'pnpm test', type: 'shell', icon: 'flask' },
        { name: 'Release', command: 'pnpm release', type: 'shell', icon: 'rocket' },
        { name: 'Install', command: 'pnpm install', type: 'shell', icon: 'package' },
      ]),
    );
    expect(suggestActions(tempDir()).map((s) => s.name)).toEqual(['Push', 'Create PR']);
  });
});
