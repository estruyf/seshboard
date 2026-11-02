import { describe, expect, it } from 'vitest';
import sessionsStore from '../../state/sessionsStore.ts?raw';
import settingsView from '../SettingsView.tsx?raw';
import aboutSettings from '../updates/AboutSettings.tsx?raw';
import autoModelSettings from '../session/AutoModelSettings.tsx?raw';
import backupSettings from '../backup/BackupSettings.tsx?raw';
import claudeCodeUpdates from '../updates/ClaudeCodeUpdates.tsx?raw';
import focusSettings from '../focus/FocusSettings.tsx?raw';
import notificationsSettings from '../notifications/NotificationsSettings.tsx?raw';
import sessionsSettings from '../sessions/SessionsSettings.tsx?raw';
import remoteSettings from '../remote/RemoteSettings.tsx?raw';
import modsSettings from '../mods/ModsSettings.tsx?raw';
import usageSettings from '../usage/UsageSettings.tsx?raw';
import cloneSettings from '../clone/CloneSettings.tsx?raw';
import appIconSettings from '../theme/AppIconSettings.tsx?raw';
import { settingsIndex } from './settingsIndex.ts';
import { searchSettings } from './searchSettings.ts';

const entries = settingsIndex();
const labels = new Set(entries.map((entry) => entry.label));

/** The `label="…"` of each `<Tag` in a file's source: the settings rows it draws. */
function rowLabels(source: string, tags: string[]): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(new RegExp(`<(${tags.join('|')})\\b`, 'g'))) {
    // The label is among the opening tag's first props.
    const label = /\blabel="([^"]+)"/.exec(source.slice(match.index, match.index + 400))?.[1];
    if (label) out.push(label);
  }
  return out;
}

describe('the settings index', () => {
  it('has each setting once', () => {
    expect(entries.length).toBe(new Set(entries.map((entry) => entry.id)).size);
  });

  it('covers every page', () => {
    const pages = [.../export type SettingsSection = ([^;]+);/.exec(sessionsStore)![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(pages.filter((page) => !entries.some((entry) => entry.page === page))).toEqual([]);
  });

  // A switch or a labelled row added to a Settings page fails this until search can find it.
  it('has every labelled row on the Settings pages', () => {
    const rows = [
      ...rowLabels(settingsView, ['Toggle']),
      ...rowLabels(autoModelSettings, ['Toggle']),
      ...rowLabels(aboutSettings, ['Toggle']),
      ...rowLabels(claudeCodeUpdates, ['Toggle']),
      ...rowLabels(focusSettings, ['Toggle', 'Row']),
      ...rowLabels(notificationsSettings, ['CardHeader', 'Row']),
      ...rowLabels(sessionsSettings, ['Toggle', 'SettingRow']),
      ...rowLabels(backupSettings, ['Row']),
      ...rowLabels(remoteSettings, ['Toggle']),
      ...rowLabels(modsSettings, ['Toggle']),
      ...rowLabels(usageSettings, ['Toggle']),
      ...rowLabels(cloneSettings, ['Toggle']),
      ...rowLabels(appIconSettings, ['Toggle']),
    ];
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((label) => !labels.has(label))).toEqual([]);
  });

  it('finds Settings › Mods by the words people use for it', () => {
    for (const query of ['mods', 'plugins', 'panes', 'status line']) {
      expect(searchSettings(query, entries, (page) => page, 'darwin').map((match) => match.entry.page)).toContain('mods');
    }
  });

  it('finds the prompt outline by the words people use for it', () => {
    for (const query of ['outline', 'prompts', 'rail']) {
      expect(searchSettings(query, entries, (page) => page, 'darwin').map((match) => match.entry.id)).toContain('prompt-outline');
    }
  });

  it('finds quick actions on hover by the words people use for it', () => {
    for (const query of ['hover', 'archive', 'quick actions', 'mark as read']) {
      expect(searchSettings(query, entries, (page) => page, 'darwin').map((match) => match.entry.id)).toContain('quick-actions');
    }
  });

  it('finds the app icon by the words people use for it', () => {
    for (const platform of ['darwin', 'win32']) {
      for (const query of ['icon', 'app icon', 'dock', 'taskbar', 'logo']) {
        expect(searchSettings(query, entries, (page) => page, platform).map((match) => match.entry.id)).toContain('app-icon');
      }
    }
  });

  it('finds the menu bar settings by menu bar, tray, notification area and dock', () => {
    const found = (query: string, platform: string) => searchSettings(query, entries, (page) => page, platform).map((match) => match.entry.id);
    for (const query of ['menu bar', 'tray', 'notification area', 'dock']) {
      expect(found(query, 'darwin'), query).toEqual(expect.arrayContaining(['menu-bar', 'keep-running', 'hide-dock']));
      expect(found(query, 'win32'), query).toEqual(expect.arrayContaining(['menu-bar', 'keep-running']));
    }
    // Hiding the Dock icon is a Mac's only.
    expect(found('dock', 'win32')).not.toContain('hide-dock');
  });

  it('finds quick start by quick start, launcher, global shortcut and raycast', () => {
    const found = (query: string) => searchSettings(query, entries, (page) => page, 'darwin').map((match) => match.entry.id);
    for (const query of ['quick start', 'launcher', 'global shortcut', 'raycast']) {
      expect(found(query), query).toEqual(expect.arrayContaining(['quick-start-shortcut', 'quick-start-background', 'quick-start-needs-you']));
    }
  });

  it('writes like the app: no em dashes', () => {
    expect(entries.filter((entry) => `${entry.label} ${entry.detail ?? ''}`.includes('—')).map((entry) => entry.id)).toEqual([]);
  });
});
