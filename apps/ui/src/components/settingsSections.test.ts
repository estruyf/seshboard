import { describe, expect, it } from 'vitest';
import sessionsStore from '../state/sessionsStore.ts?raw';
import { navGroups, SETTINGS_SECTIONS, settingsPageOrder, settingsPageShown } from './settingsSections.ts';

/** Every page the app routes on, from the `SettingsSection` union. */
const PAGES = [.../export type SettingsSection = ([^;]+);/.exec(sessionsStore)![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

describe('navGroups', () => {
  const groups = navGroups(SETTINGS_SECTIONS);

  it('lists the groups and their pages in the menu order', () => {
    expect(groups.map((g) => [g.group, g.pages.map((p) => p.id)])).toEqual([
      ['app', ['general', 'browser', 'theme', 'sidebar', 'notifications', 'focus']],
      ['claude', ['conversation', 'profiles', 'usage', 'memory']],
      ['work', ['projects', 'sessions', 'prompts', 'pipelines']],
      ['connect', ['vscode', 'remote', 'mods']],
      ['bottom', ['backup', 'diagnostics', 'about']],
    ]);
  });

  // A new page without a group, or one missing from the menu, fails here.
  it('puts every page in exactly one group', () => {
    const listed = groups.flatMap((g) => g.pages.map((p) => p.id));
    expect([...listed].sort()).toEqual([...PAGES].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('keeps the flat list in the same order as the groups', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(groups.flatMap((g) => g.pages.map((p) => p.id)));
  });

  it('skips a group with no pages', () => {
    expect(navGroups([{ group: 'connect' as const }, { group: 'app' as const }]).map((g) => g.group)).toEqual(['app', 'connect']);
  });
});

describe('settingsPageShown', () => {
  it('shows Browser only with the browser on, and every other page always', () => {
    expect(settingsPageShown('browser', { browser: true })).toBe(true);
    expect(settingsPageShown('browser', { browser: false })).toBe(false);
    expect(settingsPageShown('general', { browser: false })).toBe(true);
  });
});

describe('settingsPageOrder', () => {
  it('is the page’s place in the menu', () => {
    expect(settingsPageOrder('general')).toBe(0);
    expect(settingsPageOrder('about')).toBe(SETTINGS_SECTIONS.length - 1);
    expect(settingsPageOrder('conversation')).toBeLessThan(settingsPageOrder('pipelines'));
  });
});
