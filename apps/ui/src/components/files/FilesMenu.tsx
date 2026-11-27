import { joinPath, type ContextItem } from '@seshboard/protocol/client';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { contextMenuPoint, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { basename } from '../../lib/format.ts';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { fileManagerName } from '../../lib/platform.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useFilesPanel } from '../../state/filesPanelStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { filesActionLabel, filesMenu, type FilesAction, type FilesMenuTarget } from './filesMenu.ts';
import { insideFolder } from './touchedFiles.ts';

/** What only the viewer can do from its menu: the lines picked in it, and the text selected when the menu opened. */
export interface ViewerMenuActions {
  addLines(focus: boolean): void;
  selectedText?: string;
}

/** Opens the Files menu for a target: at the pointer for a right-click, at `element` for Shift+F10. */
export type OpenFilesMenu = (target: FilesMenuTarget, event: MouseEvent | null, element: Element, viewer?: ViewerMenuActions) => void;

/**
 * Adds files, folders and lines to the session's message, as the VS Code companion does from the editor: the chip goes
 * in the message box of the session the panel belongs to. A toast says what went in.
 */
export function addToMessage(sessionId: string, items: ContextItem[], what: string): void {
  useDrafts.getState().addContext(sessionId, items);
  toast(`Added ${what} to the message`);
}

/**
 * The Files panel's context menu: on a file or folder of the tree, the viewer and a tab. Its first items add to the
 * message, then open, then copy.
 */
export function useFilesMenu(sessionId: string, cwd: string): { open: OpenFilesMenu; menu: ReactNode } {
  const [state, setState] = useState<{ target: FilesMenuTarget; at: ContextMenuPoint; viewer?: ViewerMenuActions } | null>(null);
  const editors = useHosts((s) => s.editors);
  const openIn = useOpenIn();

  const open: OpenFilesMenu = (target, event, element, viewer) => {
    event?.preventDefault();
    const rect = element.getBoundingClientRect();
    setState({ target, at: contextMenuPoint(event ? { x: event.clientX, y: event.clientY } : null, rect, window.innerHeight), viewer });
  };

  /** The target's path, absolute (the tree's paths are relative to the folder). */
  const absolute = (target: FilesMenuTarget) => (target.kind === 'file' || target.kind === 'folder' ? joinPath(cwd, target.path) : target.path);

  const run = (action: FilesAction, target: FilesMenuTarget, viewer?: ViewerMenuActions) => {
    const path = absolute(target);
    const name = basename(path);
    const files = useFilesPanel.getState();
    const failed = (what: string) => (e: unknown) => toast(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(`${what} copied`), failed(`copy the ${what.toLowerCase()}`));
    switch (action) {
      case 'copy-link':
        return target.kind === 'viewer' && target.link ? copy(target.link, 'Link') : undefined;
      case 'copy':
        return viewer?.selectedText ? void navigator.clipboard.writeText(viewer.selectedText).catch(failed('copy the selection')) : undefined;
      case 'add-lines':
        return viewer?.addLines(false);
      case 'ask-lines':
        return viewer?.addLines(true);
      case 'add-file':
        return addToMessage(sessionId, [{ kind: 'file', path, directory: false }], name);
      case 'add-folder':
        return addToMessage(sessionId, [{ kind: 'file', path, directory: true }], `${name}/`);
      case 'add-open-files': {
        const tabs = files.get(sessionId).tabs;
        return addToMessage(sessionId, tabs.map((t): ContextItem => ({ kind: 'file', path: t.path, directory: false })), `${tabs.length} files`);
      }
      case 'open':
        return files.openFile(sessionId, path);
      case 'open-full':
        return files.openFile(sessionId, path, { full: true });
      case 'open-editor': {
        const line = target.kind === 'viewer' ? target.lines?.start : undefined;
        return void openIn(path, line ? { line } : {}).catch(failed(`open ${name}`));
      }
      case 'reveal':
        return void openIn(path, { editorId: editors.find((e) => e.kind === 'finder')?.id ?? 'finder' }).catch(failed(`show ${name} in ${fileManagerName()}`));
      case 'search-folder': {
        const folder = target.kind === 'folder' ? target.path : null;
        files.setSearch(sessionId, { include: folder ? `${folder}/**` : '' });
        files.setMode(sessionId, 'search');
        return files.command(sessionId, 'search');
      }
      case 'find':
        return files.command(sessionId, 'find');
      case 'go-to-line':
        return files.command(sessionId, 'goto');
      case 'copy-path':
        return copy(path, 'Path');
      case 'copy-relative-path':
        return copy(insideFolder(path, cwd) ?? path, 'Relative path');
      case 'close':
        return files.closeTab(sessionId, path);
      case 'close-others':
        for (const t of files.get(sessionId).tabs) if (t.path !== path) files.closeTab(sessionId, t.path);
        return;
      case 'close-all':
        for (const t of files.get(sessionId).tabs) files.closeTab(sessionId, t.path);
        return;
    }
  };

  let menu: ReactNode = null;
  if (state) {
    const { target, viewer } = state;
    const entries: MenuEntry[] = filesMenu(target).map((action) =>
      action === 'separator'
        ? 'separator'
        : {
            label: filesActionLabel(action, target, fileManagerName()),
            ...(action === 'add-lines' || (action === 'add-file' && target.kind === 'viewer' && !target.lines) ? { hint: formatKeys(keysFor('files.add-lines')) } : {}),
            data: { 'data-files-menu-item': action },
            onSelect: () => run(action, target, viewer),
          },
    );
    menu = <Menu x={state.at.x} y={state.at.y} above={state.at.above} width={240} label="Files" entries={entries} onClose={() => setState(null)} />;
  }
  return { open, menu };
}
