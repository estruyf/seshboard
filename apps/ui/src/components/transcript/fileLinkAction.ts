import type { FileLinkClick } from '@switchboard/protocol/bridge';

/** What happens to a file: previewed in Switchboard, shown in the file manager (selected there), or opened in the editor (at its line). */
export type FileLinkAction = 'preview' | 'show' | 'editor';

/** What the click rules need to know about the file and the machine. */
export interface FileLinkContext {
  /** Whether there is a file manager to show the file in. Default true. */
  fileManagerAvailable?: boolean;
  /** Whether Switchboard can preview the file (`previewKind(path) !== null`). Default false. */
  previewable?: boolean;
}

/** The names the wording needs; the platform's file manager, and the default editor once the list is known. */
export interface FileLinkNames {
  /** Finder, File Explorer. */
  fileManager: string;
  /** The default editor's name, or null before the editors are listed or when there is none. */
  editor: string | null;
}

/**
 * What a click does. The setting picks it and Shift flips it:
 * - Open in Switchboard: a previewable file previews and Shift-click opens the editor; any other file shows in the
 *   file manager (the old default) and Shift-click opens the editor.
 * - Show in the file manager: Shift-click opens the editor. Open in editor: Shift-click shows the file.
 * Where there is no file manager, whatever would show the file opens the editor instead; a preview stays a preview.
 */
export function clickAction(setting: FileLinkClick, shift: boolean, { fileManagerAvailable = true, previewable = false }: FileLinkContext = {}): FileLinkAction {
  let action: FileLinkAction;
  if (setting === 'editor') action = shift ? 'show' : 'editor';
  else if (setting === 'file-manager') action = shift ? 'editor' : 'show';
  // "switchboard", and a value this version doesn't know (a newer one's), which falls back to the default.
  else action = shift ? 'editor' : previewable ? 'preview' : 'show';
  return action === 'show' && !fileManagerAvailable ? 'editor' : action;
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
export function fileLinkTooltip({ setting, path, line, names, otherKeys, fileManagerAvailable = true, previewable = false }: { setting: FileLinkClick; path: string; line?: number; names: FileLinkNames; otherKeys: string } & FileLinkContext): string {
  const action = clickAction(setting, false, { fileManagerAvailable, previewable });
  const target = fileLinkTarget(path, line, action);
  if (action === 'preview') return `Preview ${target} in Switchboard. ${otherKeys} opens it in ${editorName(names)}`;
  if (action === 'show') return `Show ${target} in ${names.fileManager}. ${otherKeys} opens it in ${editorName(names)}`;
  return fileManagerAvailable ? `Open ${target} in ${editorName(names)}. ${otherKeys} shows it in ${names.fileManager}` : `Open ${target} in ${editorName(names)}`;
}

/** The short label on the "Open ↗" chip beside a file tool: what a click does. */
export function fileLinkChipLabel(action: FileLinkAction): string {
  if (action === 'preview') return 'Preview ↗';
  return action === 'show' ? 'Show ↗' : 'Open ↗';
}

/** One item of a file link's context menu. */
export interface FileLinkMenuItem {
  id: 'preview' | 'show' | 'editor' | 'copy';
  label: string;
}

/**
 * The context menu of a file link: open it in Switchboard (previewable files only), show it in the file manager,
 * open it in the default editor, copy the path. Always every way that applies, whatever the setting says, so the
 * other action is one right-click away.
 */
export function fileLinkMenu(names: FileLinkNames, { fileManagerAvailable = true, previewable = false }: FileLinkContext = {}): FileLinkMenuItem[] {
  return [
    ...(previewable ? [{ id: 'preview' as const, label: 'Open in Switchboard' }] : []),
    ...(fileManagerAvailable ? [{ id: 'show' as const, label: `Show in ${names.fileManager}` }] : []),
    { id: 'editor', label: `Open in ${editorName(names)}` },
    { id: 'copy', label: 'Copy path' },
  ];
}

/** Why a file could not be previewed, shown or opened, for the tooltip and the screen reader. `reason` is the engine's message ("Not found: …"). */
export function fileLinkError(action: FileLinkAction, target: string, names: FileLinkNames, reason: string): string {
  if (action === 'preview') return `Couldn't preview ${target}: ${reason}`;
  return action === 'show' ? `Couldn't show ${target} in ${names.fileManager}: ${reason}` : `Couldn't open ${target}: ${reason}`;
}
