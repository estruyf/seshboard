import { describe, expect, it } from 'vitest';
import type { SettingsSection } from '../../state/sessionsStore.ts';
import { groupByPage, searchSettings, type SettingEntry } from './searchSettings.ts';

const ENTRIES: SettingEntry[] = [
  { id: 'startup', page: 'general', label: 'On startup', detail: 'What Seshboard shows when it opens.', target: '[data-startup-view]' },
  { id: 'quit', page: 'general', label: 'Ask before quitting', detail: 'Shows a prompt first.', keywords: 'close exit', target: '[data-confirm-quit]' },
  { id: 'appearance', page: 'theme', label: 'Appearance', detail: 'Match System, Light or Dark.', keywords: 'dark mode light mode', target: '[data-appearance]' },
  { id: 'scope', page: 'sidebar', label: 'Show sessions from other apps', detail: 'Also list sessions from Terminal.', target: '[data-session-scope]' },
  { id: 'windows-only', page: 'general', label: 'Close to tray', target: '[data-tray]', os: 'win32' },
];
const LABELS: Record<string, string> = { general: 'General', theme: 'Theme', sidebar: 'Sidebar' };
const pageLabel = (page: SettingsSection) => LABELS[page] ?? page;
const ids = (query: string, platform = 'darwin') => searchSettings(query, ENTRIES, pageLabel, platform).map((m) => m.entry.id);

describe('searchSettings', () => {
  it('finds nothing for an empty query', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('needs every word, in any of label, detail, keywords or page', () => {
    expect(ids('sessions apps')).toEqual(['scope']);
    expect(ids('sessions printer')).toEqual([]);
    // "dark mode" is only a keyword; "theme" only the page.
    expect(ids('dark mode')).toEqual(['appearance']);
    expect(ids('theme')).toEqual(['appearance']);
  });

  it('ranks a word in the label above one in the text under it', () => {
    // "shows" is in quit's detail and startup's detail; "startup" only in startup's label.
    expect(ids('shows')).toEqual(['startup', 'quit']);
    expect(ids('quit')).toEqual(['quit']);
    expect(ids('prompt')).toEqual(['quit']);
  });

  it('skips settings for another platform', () => {
    expect(ids('tray')).toEqual([]);
    expect(ids('tray', 'win32')).toEqual(['windows-only']);
  });

  it('marks each word in the label and the detail, case-insensitively', () => {
    const [match] = searchSettings('SESSIONS from', ENTRIES, pageLabel, 'darwin');
    expect(match!.label).toEqual([
      [5, 13],
      [14, 18],
    ]);
    expect(match!.detail).toEqual([
      [10, 18],
      [19, 23],
    ]);
  });

  it('joins overlapping marks', () => {
    const [match] = searchSettings('appear pear', ENTRIES, pageLabel, 'darwin');
    expect(match!.label).toEqual([[0, 6]]);
  });

  it('groups by page, the best page first', () => {
    const groups = groupByPage(searchSettings('s', ENTRIES, pageLabel, 'darwin'));
    expect(groups.map((g) => g.page)).toEqual(['general', 'sidebar', 'theme']);
    expect(groups[0]!.matches.map((m) => m.entry.id)).toEqual(['startup', 'quit']);
  });
});
