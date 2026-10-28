import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ThemeState } from '@seshboard/protocol/theme-format';
import { BUILT_IN_THEMES } from '../../../ui/src/themes/index.ts';
import { isTrashableThemeFile } from './trashGuard.ts';
import { readThemeFile, ThemeStore } from './themes.ts';

const dirs: string[] = [];
const stores: ThemeStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(onChange?: (state: ThemeState) => void) {
  const root = mkdtempSync(join(tmpdir(), 'seshboard-themes-'));
  dirs.push(root);
  const dir = join(root, 'themes');
  const store = new ThemeStore(dir, BUILT_IN_THEMES, onChange);
  stores.push(store);
  return { root, dir, store };
}

const sepia = { name: 'Sepia', author: 'Someone', version: 1, light: { canvas: '#fdf6e3', accent: '#b58900' }, dark: { canvas: '#002b36', accent: '#b58900' } };
// File events can be slow while the whole suite runs, so the watcher tests wait generously.
const waitFor = async (check: () => boolean, ms = 8_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('ThemeStore', () => {
  it('lists the built-ins first, in order', () => {
    const { store } = setup();
    expect(store.state().themes.map((t) => t.id)).toEqual(['demo-time', 'catppuccin', 'nord', 'solarized', 'graphite', 'midnight', 'paper', 'signal', 'forest', 'plum', 'aluminium', 'ocean', 'neon']);
    expect(store.state().themes.every((t) => t.builtIn && t.path === null)).toBe(true);
  });

  it('adds a theme as a file, and keeps both or replaces on a clash', () => {
    const { dir, store } = setup();
    expect(store.add(sepia, 'add')).toBe('sepia');
    const saved = JSON.parse(readFileSync(join(dir, 'sepia.json'), 'utf8'));
    expect(saved.$schema).toMatch(/switchboard-theme\.schema\.json$/);
    expect(saved.name).toBe('Sepia');
    expect(store.add({ ...sepia, author: 'Copy' }, 'keep-both')).toBe('sepia-2');
    expect(store.get('sepia-2')?.file.name).toBe('Sepia 2');
    expect(store.add({ ...sepia, dark: { canvas: '#000000' } }, 'replace')).toBe('sepia');
    expect(store.get('sepia')?.file.dark).toEqual({ canvas: '#000000' });
    // A built-in's name is never replaced: the import gets the next free one.
    expect(store.add({ name: 'Solarized', version: 1, dark: {} }, 'replace')).toBe('solarized-2');
    expect(store.get('solarized-2')?.file.name).toBe('Solarized 2');
    expect(() => store.add({ name: 'Bad', version: 1, dark: { colors: { bg: 'url(x)' } } }, 'add')).toThrow(/url/);
  });

  it('duplicates any theme, built in or imported', () => {
    const { store } = setup();
    const id = store.duplicate('demo-time');
    expect(store.get(id)?.file.name).toBe('Demo Time 2');
    expect(store.get(id)?.file.dark?.colors).toEqual(store.get('demo-time')?.file.dark?.colors);
  });

  it('loads themes from the folder at start, skipping broken files', () => {
    const { dir } = setup();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'frost.json'), JSON.stringify({ name: 'Frost', version: 1, dark: { canvas: '#2e3440', accent: '#88c0d0' } }));
    writeFileSync(join(dir, 'broken.json'), '{ "name": "Broken", "version": 1, "dark": { "colors": { "bg": "var(--x)" } } }');
    writeFileSync(join(dir, 'Not An Id.json'), JSON.stringify(sepia));
    const store = new ThemeStore(dir, BUILT_IN_THEMES);
    stores.push(store);
    expect(store.state().themes.filter((t) => !t.builtIn).map((t) => t.id)).toEqual(['frost']);
  });

  it('reloads an edited file, and keeps the last good version when an edit is broken', async () => {
    const changes: ThemeState[] = [];
    const { dir, store } = setup((state) => changes.push(state));
    store.add(sepia, 'add');
    store.watch();
    // FSEvents needs a moment before it reports changes to a folder it just started watching.
    await new Promise((r) => setTimeout(r, 200));
    const file = join(dir, 'sepia.json');
    writeFileSync(file, JSON.stringify({ ...sepia, dark: { canvas: '#111111', accent: '#b58900' } }));
    await waitFor(() => store.get('sepia')?.file.dark?.canvas === '#111111');
    writeFileSync(file, JSON.stringify({ ...sepia, dark: { canvas: 'url(evil)' } }));
    await waitFor(() => store.state().problems.sepia !== undefined);
    expect(store.state().problems.sepia).toMatch(/^dark\.canvas uses url/);
    expect(store.get('sepia')?.file.dark?.canvas).toBe('#111111');
    writeFileSync(file, JSON.stringify(sepia));
    await waitFor(() => store.state().problems.sepia === undefined);
    expect(store.get('sepia')?.file.dark?.canvas).toBe('#002b36');
    rmSync(file);
    await waitFor(() => store.get('sepia') === undefined);
    expect(changes.length).toBeGreaterThan(3);
  }, 30_000);

  it("uses the theme's background for the window, and Demo Time's for a missing mode", () => {
    const { store } = setup();
    store.add({ name: 'Frost', version: 1, dark: { canvas: 'oklch(0.32 0.02 265)', colors: { bg: '#2e3440' } } }, 'add');
    expect(store.background('frost', true)).toBe('#2e3440');
    expect(store.background('frost', false)).toBe('#ffffff');
    expect(store.background('solarized', true)).toBe('#002b36');
    expect(store.background('missing', true)).toBe('#15181f');
  });

  it('reads JSONC and refuses files that are not themes', () => {
    const { root } = setup();
    const file = join(root, 'mine.json');
    writeFileSync(file, '{\n  // mine\n  "name": "Mine", "version": 1, "dark": { "canvas": "#000" },\n}');
    expect(readThemeFile(file)).toMatchObject({ ok: true, fileName: 'mine.json' });
    writeFileSync(file, 'not json');
    expect(readThemeFile(file)).toMatchObject({ ok: false, error: expect.stringMatching(/valid JSON/) });
  });

  it('only lets imported theme files go to the Trash', () => {
    const { dir, store } = setup();
    store.add(sepia, 'add');
    expect(isTrashableThemeFile(join(dir, 'sepia.json'), dir)).toBe(true);
    expect(isTrashableThemeFile(dir, dir)).toBe(false);
    expect(isTrashableThemeFile(`${dir}/../themes/sepia.json`, dir)).toBe(false);
    expect(isTrashableThemeFile(join(dir, 'missing.json'), dir)).toBe(false);
    expect(isTrashableThemeFile(join(dir, '..', 'preferences.json'), dir)).toBe(false);
  });
});
