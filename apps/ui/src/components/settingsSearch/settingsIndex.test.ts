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
import { settingsIndex } from './settingsIndex.ts';

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
      ...rowLabels(notificationsSettings, ['Toggle', 'Row']),
      ...rowLabels(sessionsSettings, ['Toggle', 'SettingRow']),
      ...rowLabels(backupSettings, ['Row']),
    ];
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((label) => !labels.has(label))).toEqual([]);
  });

  it('writes like the app: no em dashes', () => {
    expect(entries.filter((entry) => `${entry.label} ${entry.detail ?? ''}`.includes('—')).map((entry) => entry.id)).toEqual([]);
  });
});
