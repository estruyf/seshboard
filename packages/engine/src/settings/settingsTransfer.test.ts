import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUP_SECTIONS, DEFAULT_PREFERENCES, parseSettingsFile, ProjectAction } from '@switchboard/protocol';
import { ActionStore } from '../actions/actionStore.ts';
import { createAppStateStore } from '../db/appState.ts';
import { openCacheDatabase, type CacheDatabase } from '../db/database.ts';
import { ProjectRegistry } from '../projects/projectRegistry.ts';
import { exportSettings, planImport, readSettingsFile, writeBackup, writeSettingsFile, type SettingsStores } from './settingsTransfer.ts';

const dirs: string[] = [];
const caches: CacheDatabase[] = [];
afterEach(() => {
  caches.splice(0).forEach((c) => c.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-settings-')));
  dirs.push(dir);
  return dir;
};

/** One Mac's Switchboard: a real cache database and icon folder. */
function mac() {
  const data = tempDir();
  const cache = openCacheDatabase(join(data, 'cache.sqlite'));
  caches.push(cache);
  const stores: SettingsStores = {
    db: cache.db,
    appState: createAppStateStore(cache.db),
    projects: new ProjectRegistry(cache.db, join(data, 'icons')),
    actions: new ActionStore(cache.db),
  };
  return { data, stores };
}

const action = (overrides: Partial<ProjectAction> & { id: string }) => ProjectAction.parse({ name: overrides.id, command: `echo ${overrides.id}`, ...overrides });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ALL = { sections: BACKUP_SECTIONS, mode: 'merge' as const, relocate: [], preferences: DEFAULT_PREFERENCES };

/** Exports through a real file, the way the app does. */
function roundTrip(stores: SettingsStores, preferences: unknown = DEFAULT_PREFERENCES) {
  const path = join(tempDir(), 'switchboard-settings.json');
  writeSettingsFile(path, exportSettings(stores, { sections: BACKUP_SECTIONS, preferences, appVersion: '1.2.3' }));
  return readSettingsFile(path);
}

describe('settings export and import', () => {
  it('restores projects, icons, actions, choices, preferences and sessions on a clean Mac', () => {
    const before = mac();
    const [web, api] = [tempDir(), tempDir()];
    const iconFile = join(tempDir(), 'logo.png');
    writeFileSync(iconFile, PNG);
    before.stores.projects.add(web);
    before.stores.projects.add(api);
    before.stores.projects.reorder([api, web]);
    before.stores.projects.setIcon(web, { kind: 'file', path: iconFile });
    before.stores.projects.setIcon(api, { kind: 'emoji', value: '🚀' });
    before.stores.projects.rename(api, 'Backend');
    before.stores.projects.setDefaults(api, { model: 'opus', effort: null, permissionMode: 'plan', workspace: null, baseRef: null, branch: null });
    before.stores.actions.save(null, action({ id: 'lint', command: 'npm run lint' }));
    before.stores.actions.save(null, action({ id: 'review', type: 'prompt', command: 'Review the diff' }));
    before.stores.actions.save(web, action({ id: 'dev', command: 'npm run dev', shortcut: 'cmd+shift+d', runOnWorktreeCreate: true }));
    before.stores.appState.set('editor.default', 'vscode');
    before.stores.appState.set('shell.path', '/usr/bin');
    before.stores.db.prepare("INSERT INTO session_flags (id, pinned, archived_at) VALUES ('s1', 1, NULL), ('s2', 0, 42), ('s3', 0, 7)").run();
    before.stores.db.prepare("INSERT INTO owned_sessions (id, created_at) VALUES ('s1', 1)").run();

    const file = roundTrip(before.stores, { ...DEFAULT_PREFERENCES, colorScheme: 'dark' });
    expect(file).toMatchObject({ kind: 'switchboard-settings', format: 2, appVersion: '1.2.3' });
    // Only the known app choices travel, never caches like the shell's PATH.
    expect(file.choices).toEqual({ 'editor.default': 'vscode' });

    const after = mac();
    const plan = planImport(after.stores, file, ALL);
    expect(plan.preview.missingFolders).toEqual([]);
    expect(plan.preview.changes.find((c) => c.label === 'Appearance')).toMatchObject({ change: 'change', detail: 'system → dark' });
    expect(plan.preview.changes.filter((c) => c.section === 'projects').map((c) => c.change)).toEqual(['add', 'add']);
    const { preferences } = plan.apply();
    expect(preferences).toEqual({ colorScheme: 'dark' });

    const projects = after.stores.projects.list(new Map());
    expect(projects.map((p) => p.root)).toEqual([api, web]);
    expect(projects[0]).toMatchObject({ name: 'Backend', nameSource: 'custom', icon: { kind: 'emoji', value: '🚀' }, defaults: { model: 'opus', permissionMode: 'plan' } });
    expect(projects[1]?.nameSource).toBe('folder');
    expect(projects[1]?.icon).toMatchObject({ kind: 'image' });
    expect(projects[1]?.iconSource).toBe('custom');

    const listed = Object.fromEntries(after.stores.actions.list(web).actions.map((a) => [a.id, a]));
    expect(listed.dev).toMatchObject({ scope: 'project', shortcut: 'cmd+shift+d', runOnWorktreeCreate: true, trusted: false });
    expect(listed.lint).toMatchObject({ scope: 'global', trusted: false });
    // Prompt actions only send a message, so they don't need approval.
    expect(listed.review).toMatchObject({ scope: 'global', trusted: true });
    after.stores.actions.approve(null, 'lint');
    expect(after.stores.actions.list(web).actions.find((a) => a.id === 'lint')?.trusted).toBe(true);

    expect(after.stores.appState.get('editor.default')).toBe('vscode');
    expect(after.stores.appState.get('shell.path')).toBeNull();
    expect(after.stores.db.prepare('SELECT id, pinned, archived_at FROM session_flags ORDER BY id').all()).toEqual([
      { id: 's1', pinned: 1, archived_at: null },
      { id: 's2', pinned: 0, archived_at: 42 },
      { id: 's3', pinned: 0, archived_at: 7 },
    ]);
    expect(after.stores.db.prepare('SELECT id FROM owned_sessions').all()).toEqual([{ id: 's1' }]);

    // Importing the same file again changes nothing.
    const again = planImport(after.stores, file, { ...ALL, preferences: { ...DEFAULT_PREFERENCES, colorScheme: 'dark' } });
    expect(again.preview.changes).toEqual([]);
    expect(again.preview.unchanged).toBeGreaterThan(5);
  });

  it('imports settled sessions from older files as archived, from the later moment', () => {
    const before = mac();
    const file = roundTrip(before.stores, DEFAULT_PREFERENCES);
    file.sessions = { pinned: [], owned: [], continued: [], settled: [{ id: 's1', at: 42 }, { id: 's2', at: 9 }], archived: [{ id: 's2', at: 7 }] };

    const after = mac();
    const plan = planImport(after.stores, file, ALL);
    expect(plan.preview.changes.filter((c) => c.section === 'sessions').map((c) => c.label)).toEqual(['2 sessions archived']);
    plan.apply();
    expect(after.stores.db.prepare('SELECT id, archived_at FROM session_flags ORDER BY id').all()).toEqual([
      { id: 's1', archived_at: 42 },
      { id: 's2', archived_at: 9 },
    ]);
  });

  it('only exports and imports the chosen sections', () => {
    const before = mac();
    const folder = tempDir();
    before.stores.projects.add(folder);
    before.stores.actions.save(null, action({ id: 'lint' }));
    const file = exportSettings(before.stores, { sections: ['actions'], preferences: DEFAULT_PREFERENCES, appVersion: '1' });
    expect(file.projects).toBeUndefined();
    expect(file.preferences).toBeUndefined();
    expect(file.actions?.global).toHaveLength(1);

    const full = roundTrip(before.stores);
    const after = mac();
    const plan = planImport(after.stores, full, { ...ALL, sections: ['projects'] });
    expect(plan.preview.sections).toEqual(['preferences', 'themes', 'projects', 'actions', 'choices', 'sessions']);
    expect(new Set(plan.preview.changes.map((c) => c.section))).toEqual(new Set(['projects']));
    plan.apply();
    expect(after.stores.actions.all()).toEqual([]);
  });

  it('merges by keeping your values, and replaces to match the file', () => {
    const source = mac();
    const [shared, onlyHere] = [tempDir(), tempDir()];
    source.stores.projects.add(shared);
    source.stores.projects.setIcon(shared, { kind: 'emoji', value: '🍋' });
    source.stores.projects.rename(shared, 'Lemon');
    source.stores.actions.save(null, action({ id: 'test', command: 'npm test' }));
    source.stores.actions.save(null, action({ id: 'build', command: 'npm run build' }));
    source.stores.appState.set('editor.default', 'zed');
    const file = roundTrip(source.stores, { ...DEFAULT_PREFERENCES, sidebarStyle: 'compact', colorScheme: 'light' });

    const target = mac();
    target.stores.projects.add(onlyHere);
    target.stores.projects.add(shared);
    target.stores.projects.setIcon(shared, { kind: 'emoji', value: '🍊' });
    target.stores.projects.rename(shared, 'Orange');
    target.stores.actions.save(null, action({ id: 'test', command: 'vitest' }));
    target.stores.actions.save(null, action({ id: 'build', command: 'npm run build' }));
    target.stores.actions.save(null, action({ id: 'mine', command: 'echo mine' }));
    target.stores.appState.set('editor.default', 'cursor');
    const prefs = { ...DEFAULT_PREFERENCES, colorScheme: 'dark' as const };

    const merge = planImport(target.stores, file, { ...ALL, preferences: prefs });
    const byLabel = Object.fromEntries(merge.preview.changes.map((c) => [c.label, c]));
    expect(byLabel[shared]).toMatchObject({ change: 'keep', detail: 'your name and icon differ' });
    expect(byLabel['test · all projects']).toMatchObject({ change: 'keep' });
    expect(byLabel['Default editor']).toMatchObject({ change: 'keep' });
    // Your appearance is kept; the sidebar style was still the default, so the file's fills it in.
    expect(byLabel.Appearance).toMatchObject({ change: 'keep' });
    expect(merge.apply().preferences).toEqual({ sidebarStyle: 'compact' });
    expect(target.stores.projects.list(new Map()).find((p) => p.root === shared)).toMatchObject({ name: 'Orange', icon: { kind: 'emoji', value: '🍊' } });
    expect(target.stores.actions.all().map((a) => a.action.id).sort()).toEqual(['build', 'mine', 'test']);

    const replace = planImport(target.stores, file, { ...ALL, mode: 'replace', preferences: prefs });
    expect(replace.preview.changes.filter((c) => c.change === 'remove').map((c) => c.label)).toEqual([onlyHere, 'mine · all projects']);
    expect(replace.apply().preferences).toEqual({ colorScheme: 'light', sidebarStyle: 'compact' });
    expect(target.stores.projects.addedRoots()).toEqual([shared]);
    expect(target.stores.projects.list(new Map())[0]).toMatchObject({ name: 'Lemon', icon: { kind: 'emoji', value: '🍋' } });
    const actions = Object.fromEntries(target.stores.actions.list(shared).actions.map((a) => [a.id, a]));
    expect(Object.keys(actions).sort()).toEqual(['build', 'test']);
    // A changed command needs approval; the identical one you already had stays approved.
    expect(actions.test).toMatchObject({ command: 'npm test', trusted: false });
    expect(actions.build).toMatchObject({ trusted: true });
    expect(target.stores.appState.get('editor.default')).toBe('zed');
  });

  it('skips folders missing on this Mac unless they are pointed elsewhere', () => {
    const source = mac();
    const gone = tempDir();
    source.stores.projects.add(gone);
    source.stores.projects.setIcon(gone, { kind: 'emoji', value: '📦' });
    source.stores.actions.save(gone, action({ id: 'dev' }));
    const file = roundTrip(source.stores);
    rmSync(gone, { recursive: true });

    const target = mac();
    const skipped = planImport(target.stores, file, ALL);
    expect(skipped.preview.missingFolders).toEqual([gone]);
    expect(skipped.preview.changes.filter((c) => c.section !== 'preferences').map((c) => [c.section, c.change])).toEqual([
      ['projects', 'skip'],
      ['actions', 'skip'],
    ]);

    const moved = tempDir();
    const plan = planImport(target.stores, file, { ...ALL, relocate: [{ from: gone, to: moved }] });
    expect(plan.preview.missingFolders).toEqual([]);
    expect(plan.preview.changes.find((c) => c.section === 'projects')).toMatchObject({ label: moved, change: 'add', detail: `from ${gone}` });
    plan.apply();
    expect(target.stores.projects.list(new Map())[0]).toMatchObject({ root: moved, icon: { kind: 'emoji', value: '📦' } });
    expect(target.stores.actions.list(moved).actions.map((a) => a.id)).toEqual(['dev']);
  });

  it('reads a file from another platform: its folders count as missing until pointed at folders here', () => {
    const source = mac();
    const folder = tempDir();
    source.stores.projects.add(folder);
    const file = roundTrip(source.stores);
    // The same project as another platform writes it: a Mac folder on Windows, a Windows folder elsewhere.
    const foreign = process.platform === 'win32' ? '/Users/me/dev/app' : 'C:\\Users\\me\\dev\\app';
    const text = JSON.stringify(file).split(JSON.stringify(folder).slice(1, -1)).join(JSON.stringify(foreign).slice(1, -1));
    const fromElsewhere = parseSettingsFile(JSON.parse(text));
    if ('error' in fromElsewhere) throw new Error(fromElsewhere.error);

    const target = mac();
    expect(planImport(target.stores, fromElsewhere.file, ALL).preview.missingFolders).toEqual([foreign]);
    const plan = planImport(target.stores, fromElsewhere.file, { ...ALL, relocate: [{ from: foreign, to: folder }] });
    expect(plan.preview.missingFolders).toEqual([]);
    plan.apply();
    expect(target.stores.projects.list(new Map()).map((p) => p.root)).toEqual([folder]);
  });

  it('skips unreadable entries instead of refusing the file', () => {
    const folder = tempDir();
    const path = join(tempDir(), 'settings.json');
    writeFileSync(
      path,
      JSON.stringify({
        kind: 'switchboard-settings',
        format: 1,
        future: 'ignored',
        projects: [{ path: 'relative/path' }, { path: folder, icon: { kind: 'emoji', value: '✨' }, defaults: { model: 'opus', effort: 'way-too-high' } }],
        actions: { global: [{ id: 'BAD ID', name: 'Bad', command: 'x' }, { id: 'ok', name: 'OK', command: 'true' }] },
      }),
    );
    const target = mac();
    const plan = planImport(target.stores, readSettingsFile(path), ALL);
    expect(plan.preview.changes.map((c) => [c.label, c.change])).toEqual([
      ['Project 1', 'skip'],
      [folder, 'add'],
      ['Bad · all projects', 'skip'],
      ['OK · all projects', 'add'],
    ]);
    plan.apply();
    // The defaults field that no longer validates is dropped; the rest is kept.
    expect(target.stores.projects.list(new Map())[0]?.defaults).toMatchObject({ model: 'opus', effort: null });
  });

  it('refuses files that are not settings files, damaged, or from a newer version', () => {
    const dir = tempDir();
    const write = (name: string, content: string) => {
      writeFileSync(join(dir, name), content);
      return join(dir, name);
    };
    expect(() => readSettingsFile(write('a.json', 'not json'))).toThrow(/not valid JSON/);
    expect(() => readSettingsFile(write('b.json', '{"actions": []}'))).toThrow(/not a Switchboard settings file/);
    expect(() => readSettingsFile(write('c.json', '{"kind": "switchboard-settings", "format": 99}'))).toThrow(/newer version of Switchboard/);
    expect(() => readSettingsFile(write('d.json', '{"kind": "switchboard-settings", "format": 1, "projects": "nope"}'))).toThrow(/damaged/);
    expect(() => readSettingsFile(join(dir, 'missing.json'))).toThrow(/No file/);
  });

  it('keeps the newest backups', () => {
    const { stores } = mac();
    const dir = join(tempDir(), 'backups');
    mkdirSync(dir);
    const file = exportSettings(stores, { sections: BACKUP_SECTIONS, preferences: DEFAULT_PREFERENCES, appVersion: '1' });
    let last = '';
    for (let i = 0; i < 12; i++) last = writeBackup(dir, file, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    const kept = readdirSync(dir).sort();
    expect(kept).toHaveLength(10);
    expect(join(dir, kept.at(-1)!)).toBe(last);
    expect(JSON.parse(readFileSync(last, 'utf8'))).toMatchObject({ kind: 'switchboard-settings' });
  });

  it('carries imported themes: adds new ones, keeps or replaces one with the same name, and skips broken ones', () => {
    const nord = { name: 'Nord', version: 1, dark: { canvas: '#2e3440', accent: '#88c0d0' } };
    const paper = { name: 'Paper', version: 1, light: { canvas: '#fdf6e3', accent: '#b58900' } };
    const path = join(tempDir(), 'switchboard-settings.json');
    const exported = exportSettings(mac().stores, { sections: ['themes'], preferences: DEFAULT_PREFERENCES, themes: [nord, paper, { name: 'Broken' }], appVersion: '1.2.3' });
    // Only valid themes are written.
    expect(exported.themes).toEqual([nord, paper]);
    writeSettingsFile(path, { ...exported, themes: [nord, paper, { name: 'Bad', version: 1, dark: { colors: { bg: 'url(x)' } } }] });
    const file = readSettingsFile(path);

    const here = mac();
    const mine = { ...nord, dark: { canvas: '#000000' } };
    const merge = planImport(here.stores, file, { ...ALL, sections: ['themes'], themes: [mine] });
    expect(merge.preview.changes).toEqual([
      { section: 'themes', label: 'Nord', change: 'keep', detail: 'you have a theme with this name' },
      { section: 'themes', label: 'Paper', change: 'add', detail: null },
      { section: 'themes', label: 'Theme 3', change: 'skip', detail: expect.stringMatching(/^dark\.colors\.bg uses url/) },
    ]);
    expect(merge.apply().themes).toEqual([{ raw: paper, how: 'add' }]);

    const replace = planImport(here.stores, file, { ...ALL, sections: ['themes'], mode: 'replace', themes: [mine, paper] });
    expect(replace.preview.unchanged).toBe(1);
    expect(replace.apply().themes).toEqual([{ raw: nord, how: 'replace' }]);
  });
});
