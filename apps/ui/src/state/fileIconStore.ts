import { useEffect } from 'react';
import { create } from 'zustand';
import type { FileIconTheme } from '@seshboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePreferences } from './preferencesStore.ts';

/**
 * The file icon theme of Settings › Theme › File icons, loaded once for every tree, and its icons as data URLs,
 * fetched as rows ask for them. The engine reads them from VS Code's extensions folder (`fileIcons.*`).
 */
interface FileIconsState {
  /** The theme `theme` is, or is loading. */
  themeId: string;
  theme: FileIconTheme | null;
  /** Icon id to data URL; null for one that can't be shown. Missing while it loads. */
  urls: Readonly<Record<string, string | null>>;
}

export const useFileIcons = create<FileIconsState>()(() => ({ themeId: '', theme: null, urls: {} }));

let client: EngineClient | null = null;
const pending = new Set<string>();
let flushing = false;

async function load(id: string): Promise<void> {
  useFileIcons.setState({ themeId: id, theme: null, urls: {} });
  pending.clear();
  if (!id || !client) return;
  try {
    const { theme } = await client.call('fileIcons.theme', { id });
    if (useFileIcons.getState().themeId === id) useFileIcons.setState({ theme });
  } catch {
    // No icons: the tree looks as it does without a theme.
  }
}

/** Asks the engine for the icons rows wanted since the last time, in one call. */
function flush(): void {
  if (flushing || !client || !pending.size) return;
  flushing = true;
  queueMicrotask(async () => {
    const id = useFileIcons.getState().themeId;
    const ids = [...pending].slice(0, 500);
    for (const icon of ids) pending.delete(icon);
    try {
      const { icons } = await client!.call('fileIcons.icons', { id, icons: ids });
      if (useFileIcons.getState().themeId === id) useFileIcons.setState((s) => ({ urls: { ...s.urls, ...icons } }));
    } catch {
      if (useFileIcons.getState().themeId === id) useFileIcons.setState((s) => ({ urls: { ...s.urls, ...Object.fromEntries(ids.map((i) => [i, null])) } }));
    } finally {
      flushing = false;
      flush();
    }
  });
}

/** Asks for an icon a row shows; it arrives in `urls`. */
export function wantFileIcon(icon: string): void {
  if (icon in useFileIcons.getState().urls || pending.has(icon)) return;
  pending.add(icon);
  flush();
}

/** The file icon theme to draw with, or null for none: loads the one Settings names when it changes. */
export function useFileIconTheme(): FileIconTheme | null {
  const id = usePreferences((s) => s.prefs.fileIconTheme);
  const connection = useEngineConnection();
  const connected = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!connected) return;
    client = connected;
    // `load` sets `themeId` at once, so a second tree on screen doesn't load the theme again.
    if (useFileIcons.getState().themeId !== id) void load(id);
  }, [id, connected]);
  const theme = useFileIcons((s) => s.theme);
  return id && theme?.id === id ? theme : null;
}
