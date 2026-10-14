import type { FileLinkClick } from '@switchboard/protocol/bridge';

/** What happens to a file: shown in the file manager (selected there), or opened in the editor (at its line). */
export type FileLinkAction = 'show' | 'editor';

/** The names the wording needs; the platform's file manager, and the default editor once the list is known. */
export interface FileLinkNames {
  /** Finder, File Explorer. */
  fileManager: string;
  /** The default editor's name, or null before the editors are listed or when there is none. */
  editor: string | null;
}

const SETTING_ACTION: Record<FileLinkClick, FileLinkAction> = { 'file-manager': 'show', editor: 'editor' };

const other = (action: FileLinkAction): FileLinkAction => (action === 'show' ? 'editor' : 'show');

/**
 * What a click does. The setting picks it and Shift flips it. Where there is no file manager to show the file in,
 * the editor is the only action there is.
 */
export function clickAction(setting: FileLinkClick, shift: boolean, fileManagerAvailable = true): FileLinkAction {
  if (!fileManagerAvailable) return 'editor';
  const action = SETTING_ACTION[setting] ?? 'show';
  return shift ? other(action) : action;
}

/** The editor's name for a sentence: "VS Code", or "your editor" when it isn't known. */
const editorName = (names: FileLinkNames) => names.editor ?? 'your editor';

/** `src/a.ts:12` for the editor, which jumps to the line; the plain path for the file manager, which can't. */
export function fileLinkTarget(path: string, line: number | undefined, action: FileLinkAction): string {
  return action === 'editor' && line ? `${path}:${line}` : path;
}

/**
 * The tooltip (and the description for screen readers) of a file link: what a click does, then what `otherKeys`
 * (the Shift-click, written by the shortcuts registry) does instead. Without a file manager there is nothing else to offer.
 */
export function fileLinkTooltip({ setting, path, line, names, otherKeys, fileManagerAvailable = true }: { setting: FileLinkClick; path: string; line?: number; names: FileLinkNames; otherKeys: string; fileManagerAvailable?: boolean }): string {
  const action = clickAction(setting, false, fileManagerAvailable);
  const target = fileLinkTarget(path, line, action);
  if (action === 'show') return `Show ${target} in ${names.fileManager}. ${otherKeys} opens it in ${editorName(names)}`;
  return fileManagerAvailable ? `Open ${target} in ${editorName(names)}. ${otherKeys} shows it in ${names.fileManager}` : `Open ${target} in ${editorName(names)}`;
}

/** The short label on the "Open ↗" chip beside a file tool: what a click does. */
export function fileLinkChipLabel(action: FileLinkAction): string {
  return action === 'show' ? 'Show ↗' : 'Open ↗';
}

/** One item of a file link's context menu. */
export interface FileLinkMenuItem {
  id: 'show' | 'editor' | 'copy';
  label: string;
}

/**
 * The context menu of a file link: show it in the file manager, open it in the default editor, copy the path.
 * Always both ways, whatever the setting says, so the other action is one right-click away.
 */
export function fileLinkMenu(names: FileLinkNames, fileManagerAvailable = true): FileLinkMenuItem[] {
  return [
    ...(fileManagerAvailable ? [{ id: 'show' as const, label: `Show in ${names.fileManager}` }] : []),
    { id: 'editor', label: `Open in ${editorName(names)}` },
    { id: 'copy', label: 'Copy path' },
  ];
}

/** Why a file could not be shown or opened, for the tooltip and the screen reader. `reason` is the engine's message ("Not found: …"). */
export function fileLinkError(action: FileLinkAction, target: string, names: FileLinkNames, reason: string): string {
  return action === 'show' ? `Couldn't show ${target} in ${names.fileManager}: ${reason}` : `Couldn't open ${target}: ${reason}`;
}
