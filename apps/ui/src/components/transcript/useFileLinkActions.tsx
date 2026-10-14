import { Code, Copy, Folder } from 'lucide-react';
import { useContext, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { fileManagerName } from '../../lib/platform.ts';
import { clickKeysFor, formatKeys } from '../../lib/shortcuts.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { MessageMenuContext } from '../memory/RememberLayer.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { clickAction, fileLinkError, fileLinkMenu, fileLinkTarget, fileLinkTooltip, type FileLinkAction, type FileLinkMenuItem } from './fileLinkAction.ts';

const MENU_ICON: Record<FileLinkMenuItem['id'], ReactNode> = { show: <Folder size={13} />, editor: <Code size={13} />, copy: <Copy size={12} /> };

/** What a file link in the conversation does, for the element that draws it (`FileLink`, the chip beside a file tool). */
export interface FileLinkActions {
  /** What a plain click does now: the setting's action. */
  action: FileLinkAction;
  /** The tooltip: what a click does and what Shift-click does; the reason when the last try failed. */
  tooltip: string;
  /** Why the last try failed, or null. */
  error: string | null;
  /** Handlers for the link or button: click and Shift-click, right-click and Shift+F10. */
  handlers: {
    onClick(event: MouseEvent<HTMLElement>): void;
    onMouseDown(event: MouseEvent<HTMLElement>): void;
    onContextMenu(event: MouseEvent<HTMLElement>): void;
    onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  };
  /** The context menu while it is open, and the status for screen readers. Render next to the link. */
  extras: ReactNode;
}

/**
 * Shows the file in the file manager or opens it in the editor, as the Clicking a file link setting says (Shift-click
 * does the other), and lists both, with Copy path, in a context menu: the message's own menu (with Quote and Remember this…)
 * for a link in a reply, a menu of its own elsewhere. A file that is gone fails like any other open: the
 * engine says so, and the link shows it. `path` is absolute and exists as far as the engine told us.
 */
export function useFileLinkActions(path: string, line?: number): FileLinkActions {
  const setting = usePreferences((s) => s.prefs.fileLinkClick);
  const editors = useHosts((s) => s.editors);
  const defaultId = useHosts((s) => s.defaultEditorId);
  const openIn = useOpenIn();
  const openMessageMenu = useContext(MessageMenuContext);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<ContextMenuPoint | null>(null);

  const fileManager = editors.find((e) => e.kind === 'finder');
  // Before the editors are listed there is no telling, so the file manager is assumed.
  const fileManagerAvailable = editors.length === 0 || fileManager !== undefined;
  const names = { fileManager: fileManagerName(), editor: editors.find((e) => e.id === defaultId)?.name ?? null };
  const action = clickAction(setting, false, fileManagerAvailable);

  const run = (what: FileLinkAction) => {
    setError(null);
    const target = fileLinkTarget(path, line, what);
    const done = what === 'show' ? openIn(path, { editorId: fileManager?.id ?? 'finder' }) : openIn(path, line ? { line } : {});
    done.catch((e: unknown) => setError(fileLinkError(what, target, names, e instanceof Error ? e.message : String(e))));
  };

  const copy = () =>
    void navigator.clipboard.writeText(path).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1_500);
      },
      () => setError("Couldn't copy the path"),
    );

  const entries: MenuEntry[] = fileLinkMenu(names, fileManagerAvailable).map((item) => ({
    label: item.label,
    icon: MENU_ICON[item.id],
    onSelect: () => (item.id === 'copy' ? copy() : run(item.id)),
    data: { 'data-file-link-menu-item': item.id },
  }));

  const openMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // A context menu opened from the keyboard reports no pointer position: open it at the link.
    const pointer = 'clientX' in event && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : null;
    if (openMessageMenu?.(event.currentTarget, pointer, entries)) return;
    setMenu(contextMenuPoint(pointer, event.currentTarget.getBoundingClientRect(), window.innerHeight));
  };

  const extras = (
    <>
      {menu && <Menu x={menu.x} y={menu.y} above={menu.above} entries={entries} onClose={() => setMenu(null)} label="File link" />}
      {copied && (
        <span role="status" className="sr-only">
          Path copied
        </span>
      )}
      {/* The tooltip only shows on hover; say it out loud too. */}
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
    </>
  );

  return {
    action,
    tooltip: fileLinkTooltip({ setting, path, ...(line ? { line } : {}), names, otherKeys: formatKeys(clickKeysFor('transcript.file-link-other')), fileManagerAvailable }),
    error,
    handlers: {
      onClick: (event) => {
        // The main process would refuse a file:// link anyway; the engine does the work.
        event.preventDefault();
        run(clickAction(setting, event.shiftKey, fileManagerAvailable));
      },
      // Shift-click would also stretch the text selection.
      onMouseDown: (event) => {
        if (event.shiftKey) event.preventDefault();
      },
      onContextMenu: openMenu,
      onKeyDown: (event) => {
        if (isContextMenuKey(event)) openMenu(event);
      },
    },
    extras,
  };
}
