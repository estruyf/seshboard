import { fileManagerName } from '../lib/platform.ts';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, Code, Copy, ExternalLink, Folder, Globe, SquareTerminal } from 'lucide-react';
import type { EditorInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useHosts } from '../state/hostsStore.ts';
import type { MenuEntry } from './Menu.tsx';
import { Popover } from './ui/Popover.tsx';
import { ariaKeysFor, formatKeys, keysFor } from '../lib/shortcuts.ts';

/** Opens a path in the user's editor, terminal or Finder. Used by the header button, ⌘O and file links. */
export function useOpenIn() {
  const connection = useEngineConnection();
  const setEditors = useHosts((s) => s.setEditors);
  const client = connection.status === 'connected' ? connection.client : null;
  return useCallback(
    async (path: string, options: { line?: number; editorId?: string } = {}) => {
      if (!client) return;
      await client.call('editors.open', { path, ...options });
      // Picking an editor from the menu makes it the default; refresh so the button follows.
      if (options.editorId) {
        const { editors, defaultId } = await client.call('editors.list', {});
        setEditors(editors, defaultId);
      }
    },
    [client, setEditors],
  );
}

const GROUPS: Array<{ kind: EditorInfo['kind']; label: string }> = [
  { kind: 'editor', label: 'Editors' },
  { kind: 'terminal', label: 'Terminals' },
  { kind: 'finder', label: fileManagerName() },
];

/** The folder's page on GitHub, or null when it has no GitHub remote (or the engine isn't connected). */
function useGithubPage(path: string | null) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [page, setPage] = useState<{ repo: string; url: string } | null>(null);
  useEffect(() => {
    setPage(null);
    if (!client || !path) return;
    let cancelled = false;
    client
      .call('git.github', { cwd: path })
      .then((result) => !cancelled && setPage(result))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, path]);
  return page;
}

const MENU_WIDTH = 208;
const item = 'flex w-full items-center justify-between px-3 py-1 text-left text-ui hover:bg-accent/15 focus-visible:bg-accent/15';
const heading = 'px-3 pt-1.5 pb-0.5 text-meta tracking-wide text-faint uppercase';

const KIND_ICON: Record<EditorInfo['kind'], ReactNode> = {
  editor: <Code size={13} />,
  terminal: <SquareTerminal size={13} />,
  finder: <Folder size={13} />,
};

/**
 * The "Open in" part of the session header's ⋯ menu: every editor, terminal and Finder (the default
 * one first, with ⌘O), copying the path, and the folder's GitHub page. `status` is a screen-reader
 * message to render next to the menu; `error` says why the last open failed.
 */
export function useOpenInEntries(path: string | null): { entries: MenuEntry[]; error: string | null; status: ReactNode } {
  const editors = useHosts((s) => s.editors);
  const defaultId = useHosts((s) => s.defaultEditorId);
  const openIn = useOpenIn();
  const github = useGithubPage(path);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const current = editors.find((e) => e.id === defaultId) ?? editors[0];
  const status = (
    <>
      {copied && (
        <span role="status" className="sr-only">
          Path copied
        </span>
      )}
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
    </>
  );
  if (!path || !current) return { entries: [], error, status };
  const run = (editorId?: string) => {
    setError(null);
    openIn(path, editorId ? { editorId } : {}).catch((e: unknown) => setError(`Couldn't open the folder: ${e instanceof Error ? e.message : String(e)}`));
  };
  // The default app first, as the one ⌘O opens; then the others in the usual group order.
  const others = GROUPS.flatMap((group) => editors.filter((e) => e.kind === group.kind && e.id !== current.id));
  const entries: MenuEntry[] = [
    { heading: 'Open in' },
    { label: current.name, icon: KIND_ICON[current.kind], hint: formatKeys(keysFor('editor.open')), onSelect: () => run(), data: { 'data-open-in': true, 'data-open-in-editor': current.id, 'data-tooltip': `Open ${path} in ${current.name}` } },
    ...others.map((editor): MenuEntry => ({ label: editor.name, icon: KIND_ICON[editor.kind], onSelect: () => run(editor.id), data: { 'data-open-in-editor': editor.id } })),
    {
      label: 'Copy path',
      icon: <Copy size={12} />,
      onSelect: () =>
        void navigator.clipboard.writeText(path).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          },
          () => setError("Couldn't copy the path"),
        ),
      data: { 'data-copy-path': true },
    },
  ];
  if (github) {
    entries.push({
      label: 'GitHub',
      icon: <Globe size={13} />,
      hint: github.repo,
      // The main process opens http(s) links from window.open in the browser.
      onSelect: () => void window.open(github.url, '_blank'),
      data: { 'data-open-github': github.url, 'data-tooltip': github.url },
    });
  }
  return { entries, error, status };
}

/** The menu's items, in order. */
const menuItems = (menu: HTMLElement | null): HTMLElement[] => (menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) : []);

/** The same keys as `Menu`: ↑ ↓ Home End move between items, Tab closes. */
function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
  const items = menuItems(event.currentTarget);
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  let next: number | null = null;
  if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
  else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'Tab') {
    event.preventDefault();
    close();
    return;
  }
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  items[next]!.focus();
}

/**
 * Split button: open the folder in the default editor, or pick another app (or GitHub) from the menu,
 * or copy the folder's path. In a narrow pane only the icon shows.
 */
export function OpenInButton({ path, shortcut = true }: { path: string | null; /** ⌘O opens it here (the session view). */ shortcut?: boolean }) {
  const editors = useHosts((s) => s.editors);
  const defaultId = useHosts((s) => s.defaultEditorId);
  const openIn = useOpenIn();
  const github = useGithubPage(path);
  // The menu is a fixed popover, so the transcript below the header can't paint over it.
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(null), []);
  const current = editors.find((e) => e.id === defaultId) ?? editors[0];

  // Keyboard users land on the first app, and get focus back on the ▾ button when the menu closes.
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    menuItems(document.getElementById(menuId))[0]?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body) toggleRef.current?.focus({ preventScroll: true });
    };
  }, [isOpen, menuId]);

  if (!path || !current) return null;
  const run = (editorId?: string) => {
    setOpen(null);
    setError(null);
    openIn(path, editorId ? { editorId } : {}).catch((e: unknown) => setError(`Couldn't open the folder: ${e instanceof Error ? e.message : String(e)}`));
  };
  const toggle = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    setOpen(open || !rect ? null : { x: rect.right - MENU_WIDTH, y: rect.bottom + 4 });
  };

  return (
    <div ref={wrapperRef} className="no-drag relative flex shrink-0">
      <button
        type="button"
        onClick={() => run()}
        className={`flex h-7 items-center gap-1.5 rounded-l-md border border-border px-2.5 text-ui hover:bg-border/50 @max-[860px]:rounded-md @max-[860px]:px-1.5 ${error ? 'text-error' : 'text-text'}`}
        // A failed open keeps its message on the button that failed, where hovering finds it.
        data-tooltip={error ?? `Open ${path} in ${current.name}${shortcut ? ` (${formatKeys(keysFor('editor.open'))})` : ''}`}
        aria-label={`Open in ${current.name}`}
        aria-keyshortcuts={shortcut ? ariaKeysFor('editor.open') : undefined}
        data-open-in
      >
        <ExternalLink size={13} className="shrink-0 text-muted" aria-hidden />
        {/* In a narrow pane (container query on the session view) only the icon stays. */}
        <span className="@max-[860px]:hidden">{current.name}</span>
      </button>
      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        className="flex h-7 items-center rounded-r-md border border-l-0 border-border px-1.5 text-muted hover:bg-border/50 hover:text-text @max-[860px]:hidden"
        aria-label="Open in another app"
        data-tooltip="Open in another app"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        data-open-in-menu
      >
        <ChevronDown size={13} aria-hidden />
      </button>
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
      {open && (
        <Popover id={menuId} x={open.x} y={open.y} width={MENU_WIDTH} anchor={wrapperRef} onClose={close} role="menu" aria-label="Open in" data-menu="open-in" onKeyDown={(e) => onMenuKeyDown(e, close)}>
          {GROUPS.map((group) => {
            const items = editors.filter((e) => e.kind === group.kind);
            if (items.length === 0) return null;
            return (
              <div key={group.kind} role="group" aria-label={group.label}>
                <p aria-hidden className={heading}>
                  {group.label}
                </p>
                {items.map((editor) => (
                  <button key={editor.id} type="button" role="menuitem" onClick={() => run(editor.id)} className={item}>
                    {editor.name}
                    {editor.id === defaultId && <span className="text-meta text-muted">default</span>}
                  </button>
                ))}
              </div>
            );
          })}
          <div role="group" aria-label="Path">
            <div role="separator" className="my-1 border-t border-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(null);
                void navigator.clipboard.writeText(path).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1_500);
                  },
                  () => setError("Couldn't copy the path"),
                );
              }}
              className={item}
              data-copy-path
            >
              <span className="flex items-center gap-2">
                <Copy size={12} className="text-muted" aria-hidden />
                Copy path
              </span>
            </button>
          </div>
          {github && (
            <div role="group" aria-label="Web">
              <p aria-hidden className={heading}>
                Web
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(null);
                  // The main process opens http(s) links from window.open in the browser.
                  window.open(github.url, '_blank');
                }}
                className={item}
                data-tooltip={github.url}
                data-open-github={github.url}
              >
                GitHub
                <span className="min-w-0 truncate pl-2 text-meta text-muted">{github.repo}</span>
              </button>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}
