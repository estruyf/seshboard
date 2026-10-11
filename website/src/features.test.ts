import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../apps/ui/src/components/palette/commands.ts';
import { SHORTCUTS } from '../../apps/ui/src/lib/shortcuts.ts';
import { PROJECT_TABS } from '../../apps/ui/src/state/projectPageStore.ts';
import features from './content/features.json' with { type: 'json' };

/*
 * The docs cover every feature: each palette command, shortcut, Settings section and project tab has an
 * entry in content/features.json, and every entry points at a page that exists. A new command or shortcut
 * fails this test until it is documented (see the Release checklist in CLAUDE.md).
 */

const here = import.meta.dirname;
const entries = features.features as Array<{ id: string; name: string; page: string }>;
const ids = new Set(entries.map((entry) => entry.id));

/** A page slug as the docs link it (`sessions/sidebar`), found in the content collection or src/pages. */
function pageExists(page: string): boolean {
  const docs = join(here, 'content', 'docs');
  return [join(docs, `${page}.mdx`), join(docs, `${page}.md`), join(docs, page, 'index.mdx'), join(docs, page, 'index.md'), join(here, 'pages', `${page}.astro`)].some((path) => existsSync(path));
}

/** Settings' sections, from the `SettingsSection` type the app routes on. */
function settingsSections(): string[] {
  const source = readFileSync(join(here, '..', '..', 'apps', 'ui', 'src', 'state', 'sessionsStore.ts'), 'utf8');
  const union = /export type SettingsSection = ([^;]+);/.exec(source)?.[1];
  if (!union) throw new Error('SettingsSection not found in sessionsStore.ts');
  return [...union.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

const missing = (wanted: string[]) => wanted.filter((id) => !ids.has(id));

describe('features.json', () => {
  it('documents every palette command', () => {
    expect(missing(COMMANDS.map((command) => `palette:${command.id}`))).toEqual([]);
    // The commands made per project, action and theme.
    expect(missing(['palette:action:*', 'palette:theme:*', 'palette:project:*'])).toEqual([]);
  });

  it('documents every keyboard shortcut', () => {
    expect(missing(SHORTCUTS.map((shortcut) => `shortcut:${shortcut.id}`))).toEqual([]);
  });

  it('documents every Settings section', () => {
    expect(missing(settingsSections().map((section) => `settings:${section}`))).toEqual([]);
  });

  it('documents every project tab', () => {
    expect(missing(PROJECT_TABS.map((tab) => `project-tab:${tab}`))).toEqual([]);
  });

  it('points every entry at a page that exists', () => {
    expect(entries.filter((entry) => !pageExists(entry.page)).map((entry) => `${entry.id} → ${entry.page}`)).toEqual([]);
  });

  it('has each feature once, with a name', () => {
    expect(entries.length).toBe(ids.size);
    expect(entries.filter((entry) => !entry.name.trim()).map((entry) => entry.id)).toEqual([]);
  });
});
