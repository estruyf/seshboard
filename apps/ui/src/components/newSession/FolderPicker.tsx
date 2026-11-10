import { Folder, FolderDown, FolderGit2, FolderPlus, MessageCircleQuestion, Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { parseGithubRepo, repoLabel } from '@seshboard/protocol/client';
import { basename, tildify } from '../../lib/format.ts';
import { currentPlatform } from '../../lib/platform.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { ProjectIcon, useProjectColor } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { filterFolders, quickCount, quickTiles, type TileTone } from './projectTiles.ts';
import { moveInGrid, ProjectRow } from './ProjectRow.tsx';
import { projectsThatFit, type NewSessionMode } from './newSessionLayout.ts';
import { useColumns } from '../ui/useColumns.ts';
import { addOrSelect, completePath, listEnd, ghostText, isPathInput, knownFolderRows, pathRows, splitPathInput } from './pathInput.ts';
import { useFolderSuggestions } from './useFolderSuggestions.ts';
import { matches } from '../../lib/shortcuts.ts';
import { QUESTION_LABEL } from '../../lib/questions.ts';

/** A row in the open list's other modes: a typed path's folders, or folders with Claude sessions. */
const ROW = 'flex min-h-9 w-full min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-lg px-2.5 py-1.5 text-left';

/** The rows: one column in the projects' column, two when stacked, as long as they are readable (`ROW_BREAKPOINTS`). */
const ROW_GRID = 'grid grid-cols-1 gap-0.5 @min-[400px]:grid-cols-2 @min-[400px]:gap-1.5';
const ROW_BREAKPOINTS = [400] as const;
/** The space between the picker's parts (`gap-2`) and between rows in one column (`gap-0.5`), to count how many rows fit. */
const PART_GAP = 8;
const ROW_GAP = 2;
/** In the projects' column a row is a quiet line that scrolls with the list, as in the sidebar. */
const COLUMN_ROW = '@min-[860px]/new-session:border-transparent @min-[860px]/new-session:bg-transparent';

/** What a folder dragged over the project area would do: add it, or nothing (files, several items). */
type DropState = { ok: boolean } | null;

/**
 * Where a new session starts: Find a project (⌘F), your projects (most recent, or in your order) as a list of rows, and
 * with more projects, "All N projects…" under them, which opens all of them with a filter field in place of Find. In
 * New session's left column the rows are one column, as many as fit up to 9; when stacked, two columns of 8. Adding a
 * folder is one step: Add project… opens the Add project dialog (the one onboarding uses), ↩ on a typed path (`~/…`, `/…`, `C:\…`) or on a folder Claude Code already has sessions for adds it, and so
 * does dropping a folder on the area. A folder that is already a project is selected instead. ⌘1 to ⌘9 pick the rows
 * in view, and the arrow keys move through them as the grid shows them. The open list is a combobox: focus stays in the field and `aria-activedescendant` says which option the
 * arrows are on. Under the list, Quick question starts without a project (in the scratch folder the engine keeps).
 * With Clone from GitHub on, Clone from GitHub… opens its form, and a GitHub URL typed or pasted in the field offers
 * Clone owner/name (↩ clones it at once).
 */
export function FolderPicker({
  value,
  folders,
  home,
  branches,
  statusOf,
  onChange,
  onAdd,
  onAddProject,
  onChooseOther,
  shortcuts,
  openRequest = 0,
  question = null,
  onClone,
  layout,
  onPicked,
}: {
  /** New session's layout: the columns list as many rows as fit, stacked lists two columns. */
  layout: NewSessionMode;
  /** A project was picked or added from the filter field, which is gone now: focus goes back to the message box. */
  onPicked?(): void;
  value: string | null;
  /** Your projects, most recently used first or in your order (the `projectOrder` preference). */
  folders: string[];
  home: string | null;
  /** The checked-out branch per folder, where known (tooltips). */
  branches: Map<string, string | null>;
  statusOf(folder: string): { tone: TileTone; label: string };
  onChange(folder: string): void;
  /** Adds a folder as a project (unless it is one) and selects it. */
  onAdd(folder: string): void;
  /** Opens the Add project dialog (the one onboarding uses); the project added there is selected. */
  onAddProject(): void;
  /** Opens the system folder dialog; the folder chosen there is added and selected. */
  onChooseOther(): void;
  /** ⌘1 to ⌘9 pick a row, ⌘F finds a project (off while something covers the view, like Settings). */
  shortcuts: boolean;
  /** Changing it opens the full list (a link that didn't say which project, or the project in the message box). */
  openRequest?: number;
  /** The Quick question choice: picked or not, and picking it. Null until the engine has said where questions run. */
  question?: { selected: boolean; onSelect(): void } | null;
  /** Clone from GitHub, when it is on: the form, empty or with a URL typed in the field (`start`: clone it now). */
  onClone?(url: string | null, start: boolean): void;
}) {
  const projects = useProjects((s) => s.projects);
  const projectOrder = usePreferences((s) => s.prefs.projectOrder);
  const platform = currentPlatform();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [drop, setDrop] = useState<DropState>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // The CSS lays out the columns; this says how many there are, for how many rows show and for the arrow keys.
  const columns = useColumns(rootRef, ROW_BREAKPOINTS);
  const [fit, setFit] = useState(9);
  const id = useId();
  const optionId = (index: number) => `${id}-option-${index}`;
  const nameOf = (folder: string) => projects.get(folder)?.name ?? basename(folder);
  /** The picked project's colour: its row's border and shadow. */
  const valueColor = useProjectColor(value ? projects.get(value) : undefined, value);

  const quick = useMemo(() => quickTiles(folders, value, layout === 'stack' ? quickCount(columns) : fit), [folders, value, layout, columns, fit]);
  const all = useMemo(() => (value && !folders.includes(value) ? [value, ...folders] : folders), [folders, value]);
  const options = useMemo(() => filterFolders(all, filter, (folder) => projects.get(folder)?.name ?? basename(folder), home), [all, filter, home, projects]);
  const end = listEnd(folders.length, quick.length, folders.filter((folder) => !quick.includes(folder)).length);

  // Clone mode: the field holds a GitHub URL, and the one row clones it.
  const cloneRepo = open && onClone ? parseGithubRepo(filter, { shorthand: false }) : null;
  const cloneMode = cloneRepo?.ok === true;
  // Path mode: the field holds a path, and the list shows the folders in it.
  const pathMode = open && !cloneMode && isPathInput(filter, platform);
  const typed = pathMode ? splitPathInput(filter, platform) : null;
  const suggestions = useFolderSuggestions(typed?.dir ?? null, typed?.prefix ?? '');
  const fresh = !!typed && suggestions.dir === typed.dir;
  const paths = useMemo(() => (fresh && typed ? pathRows(suggestions.here, suggestions.folders, typed.prefix) : []), [fresh, suggestions, typed?.prefix]);
  // The answer for exactly this text is in and lists nothing: there is no such folder.
  const missing = fresh && typed !== null && suggestions.prefix === typed.prefix && paths.length === 0;

  // No project matches a name: the folders Claude Code has sessions for, then the system dialog.
  const fallback = open && !pathMode && !cloneMode && options.length === 0;
  const known = useMemo(() => (fallback ? knownFolderRows(projects, filter, home) : []), [fallback, projects, filter, home]);

  const mode: 'tiles' | 'paths' | 'known' | 'clone' = cloneMode ? 'clone' : pathMode ? 'paths' : fallback ? 'known' : 'tiles';
  // In the known-folder list, the last row is Choose a folder….
  const count = mode === 'clone' ? 1 : mode === 'paths' ? paths.length : mode === 'known' ? known.length + 1 : options.length;
  const shown = !open ? quick : mode === 'tiles' ? options : [];
  const activePath = mode === 'paths' ? paths[active] : undefined;
  // Tab and the faint text complete the highlighted folder, or the first one in it while the folder itself is highlighted.
  const completion = activePath && activePath !== suggestions.here ? activePath : paths.find((p) => p !== suggestions.here);
  const ghost = mode === 'paths' ? ghostText(filter, completion?.name, platform) : '';

  // How many rows fit in the column: the picker's height, less everything in it that isn't the list.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (layout === 'stack' || open || !root) return;
    const measure = () => {
      const list = groupRef.current;
      if (!list) return;
      const others = [...root.children].filter((el): el is HTMLElement => el !== list && el instanceof HTMLElement && el.dataset.folderDrop === undefined);
      const rest = others.reduce((sum, el) => sum + el.offsetHeight + PART_GAP, 0);
      const row = list.querySelector<HTMLElement>('[data-project-row]')?.offsetHeight;
      if (row) setFit(projectsThatFit(root.clientHeight - rest, row, ROW_GAP));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [layout, open, folders.length > 0]);

  useEffect(() => {
    if (!open) return;
    // Start on the current folder when opening, and on the best match while filtering.
    setActive(filter.trim() ? 0 : Math.max(0, value ? options.indexOf(value) : 0));
  }, [open, filter]);
  useEffect(() => {
    if (openRequest) setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  // A drag that ends elsewhere (Esc, a drop outside the window) sends no dragleave here, so the overlay also goes when
  // dragover stops coming for a moment, or on the window's dragend.
  const dropTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!drop) return;
    const reset = () => setDrop(null);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      clearTimeout(dropTimer.current);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, [!!drop]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setFilter('');
    // Back on the list, so typing filters again.
    if (refocus) requestAnimationFrame(() => groupRef.current?.querySelector<HTMLElement>('[tabindex="0"], [data-add-project-tile]')?.focus());
  };
  const askQuestion = () => {
    close(false);
    question?.onSelect();
  };
  const choose = (folder: string) => {
    const fromField = open;
    close(false);
    onChange(folder);
    if (fromField) onPicked?.();
  };
  const add = (folder: string) => {
    const fromField = open;
    close(false);
    onAdd(folder);
    if (fromField) onPicked?.();
  };
  const chooseOther = () => {
    close(false);
    onChooseOther();
  };
  const addProject = () => {
    close(false);
    onAddProject();
  };
  const clone = (url: string | null) => {
    close(false);
    onClone?.(url, url !== null);
  };
  const pick = (index: number) => {
    if (mode === 'clone') clone(filter.trim());
    else if (mode === 'paths') {
      if (paths[index]) add(paths[index]!.path);
    } else if (mode === 'known') {
      if (index === known.length) chooseOther();
      else if (known[index]) add(known[index]!.root);
    } else if (options[index]) choose(options[index]!);
  };

  // ⌘1 to ⌘9 pick the rows in view, wherever focus is (the prompt usually has it). ⌘F opens the full list, or goes back to its field.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (matches(event, 'new-session.find')) {
        if (event.defaultPrevented || document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')) return;
        if (event.target instanceof HTMLElement && event.target.closest('[data-terminal-panel]')) return;
        event.preventDefault();
        setOpen(true);
        fieldRef.current?.focus();
        return;
      }
      if (!matches(event, 'new-session.pick')) return;
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')) return;
      const folder = shownRef.current[Number(event.key) - 1];
      if (!folder) return;
      event.preventDefault();
      chooseRef.current(folder);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);

  // Typing a letter on a row opens the full list filtered by it: "start typing its name". The arrows move between rows.
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (moveInGrid(e, columns)) return;
    if (open || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
    e.preventDefault();
    setFilter(e.key);
    setOpen(true);
  };

  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keys that confirm an IME composition (Enter picking a candidate) belong to the input method.
    if (e.nativeEvent.isComposing) return;
    const move = (delta: number) => (e.preventDefault(), setActive((i) => Math.min(count - 1, Math.max(0, i + delta))));
    const rows = mode !== 'tiles';
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close(true));
    else if (e.key === 'ArrowDown') move(rows ? 1 : columns);
    else if (e.key === 'ArrowUp') move(rows ? -1 : -columns);
    // Left and right move the caret while there is text to edit.
    else if (e.key === 'ArrowRight' && !filter && !rows) move(1);
    else if (e.key === 'ArrowLeft' && !filter && !rows) move(-1);
    else if (e.key === 'Enter') (e.preventDefault(), pick(active));
    else if (e.key === 'Tab' && !e.shiftKey && mode === 'paths') {
      const next = completePath(filter, completion?.name, platform);
      if (next === null) return;
      e.preventDefault();
      setFilter(next);
    }
  };

  // A folder dragged from Finder or File Explorer over the area: one folder adds it, anything else is refused.
  // The handlers stop the event, so the message box's own drop target (the whole view) leaves it alone.
  const dragInfo = (e: DragEvent): DropState => {
    if (![...e.dataTransfer.types].includes('Files')) return null;
    const items = [...e.dataTransfer.items].filter((item) => item.kind === 'file');
    // Folders have no type while dragging; a file with one is never a folder.
    return { ok: items.length === 1 && items[0]!.type === '' };
  };
  const onDragOver = (e: DragEvent) => {
    const next = dragInfo(e);
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = next.ok ? 'copy' : 'none';
    if (next.ok !== drop?.ok) setDrop(next);
    clearTimeout(dropTimer.current);
    dropTimer.current = setTimeout(() => setDrop(null), 400);
  };
  const onDragLeave = (e: DragEvent) => {
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
  };
  const onDrop = (e: DragEvent) => {
    if (!dragInfo(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDrop(null);
    // Only the entries know which item is a folder, and only during the drop.
    const items = [...e.dataTransfer.items].filter((item) => item.kind === 'file');
    const files = [...e.dataTransfer.files];
    if (files.length !== 1 || !items[0]?.webkitGetAsEntry()?.isDirectory) return;
    const path = window.seshboard?.getPathForFile(files[0]!);
    if (path) add(path);
  };

  // In the short list the rows are a listbox of their own (focus moves between them); in the open one, the field's options.
  const focusable = quick.includes(value ?? '') ? value : quick[0];
  const tile = (folder: string, index: number) => {
    const status = statusOf(folder);
    const name = nameOf(folder);
    const selected = folder === value;
    const highlighted = open && index === active;
    return (
      <ProjectRow
        key={folder}
        id={open ? optionId(index) : undefined}
        role="option"
        tabIndex={open ? -1 : folder === focusable ? 0 : -1}
        aria-selected={selected}
        icon={<ProjectIcon project={projects.get(folder)} root={folder} size={30} />}
        name={name}
        tone={status.tone}
        label={status.label}
        branch={branches.get(folder)}
        shortcut={index < 9 ? index + 1 : undefined}
        selected={selected}
        highlighted={highlighted}
        color={valueColor}
        className={selected || highlighted ? '' : COLUMN_ROW}
        // A click picks without taking the focus: it stays where it was, usually in the message box.
        onMouseDown={(e) => e.preventDefault()}
        data-folder-option={folder}
        data-active={open ? highlighted : undefined}
        data-tooltip={`${name}\n${tildify(folder, home)}`}
        onMouseMove={open ? () => setActive(index) : undefined}
        onClick={() => (open ? pick(index) : choose(folder))}
      />
    );
  };

  /** A row of the path or known-folder list: the highlighted one says what ↩ does. */
  const row = (index: number, content: ReactNode, action: string, hook: Record<`data-${string}`, string | true>) => {
    const highlighted = index === active;
    return (
      <button
        key={index}
        id={optionId(index)}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={highlighted}
        data-active={highlighted}
        {...hook}
        onMouseMove={() => setActive(index)}
        onClick={() => pick(index)}
        className={`${ROW} ${highlighted ? 'bg-border/45 text-text' : 'text-muted hover:bg-border/45'}`}
      >
        <span className="flex min-w-0 flex-1 basis-0 items-center gap-2.5">{content}</span>
        {/* Beside the row where it fits; under it in a narrow column, so it is always said. */}
        {highlighted && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-meta text-muted @max-[600px]:ml-0 @max-[600px]:w-full @max-[600px]:justify-end">
            {action}
            <Kbd keys="↩" />
          </span>
        )}
      </button>
    );
  };

  // Not a project, so not a row of the list: a dashed row under it, in neutral colours (a question has no project colour).
  const questionRow = question && (
    <button
      type="button"
      aria-pressed={question.selected}
      onClick={askQuestion}
      onMouseDown={(e) => e.preventDefault()}
      data-quick-question
      data-selected={question.selected || undefined}
      className={`flex min-h-11 min-w-0 shrink-0 items-center gap-2.5 rounded-lg border px-2.5 py-1 text-left transition-colors ${
        question.selected ? 'border-edge bg-selected text-text' : 'border-dashed border-border text-muted hover:bg-border/45 hover:text-text'
      }`}
    >
      <MessageCircleQuestion size={16} className="shrink-0" aria-hidden />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-ui font-semibold">{QUESTION_LABEL}</span>
        <span className="truncate text-meta text-faint">Ask without a project</span>
      </span>
      <Kbd shortcut="session.question" tone="plain" />
    </button>
  );

  // Under the list: the way to all of them (or back), then adding one. Both ways to add keep their labels; in a narrow
  // column they wrap to a line of their own.
  const footer = (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-0.5 text-ui" data-project-footer>
      {open ? (
        <button type="button" onClick={() => close(true)} aria-expanded data-folder-select data-value={value ?? ''} className="shrink-0 rounded font-semibold text-accent-ink hover:underline" data-fewer-projects>
          Show fewer
        </button>
      ) : (
        end?.kind === 'more' && (
          <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className="shrink-0 rounded font-semibold text-accent-ink hover:underline" data-all-projects>
            All {folders.length} projects…
          </button>
        )
      )}
      <span className="ml-auto flex min-w-0 items-center gap-1.5">
        {onClone && (
          <Button size="sm" variant="quiet" icon={<FolderDown size={14} aria-hidden />} data-clone-from-github onClick={() => clone(null)} className="shrink-0">
            Clone from GitHub…
          </Button>
        )}
        {/* With no projects the row above is the way in. */}
        {(open || end?.kind !== 'choose') && (
          <Button size="sm" variant="quiet" icon={<FolderPlus size={14} aria-hidden />} data-add-folder onClick={addProject} className="shrink-0">
            Add project…
          </Button>
        )}
      </span>
    </div>
  );

  const pathHint =
    platform === 'win32'
      ? 'Paths start with ~\\ or a drive, such as C:\\. Folders only. A folder that is already a project selects it instead.'
      : 'Paths start with ~/ or /. Folders only. A folder that is already a project selects it instead.';

  const list =
    mode === 'clone' && cloneRepo?.ok ? (
      <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Clone from GitHub" className="grid gap-0.5" data-clone-suggestion>
        {row(
          0,
          <>
            <FolderDown size={15} className="shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 truncate text-ui text-text">
              Clone <span className="font-semibold">{repoLabel(cloneRepo.repo)}</span>
              {cloneRepo.repo.branch && <span className="font-mono text-meta text-muted"> · {cloneRepo.repo.branch}</span>}
            </span>
          </>,
          'Clone and start here',
          { 'data-clone-option': repoLabel(cloneRepo.repo) },
        )}
      </div>
    ) : mode === 'paths' ? (
      <>
        <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Folders" className="grid max-h-80 min-h-0 gap-0.5 overflow-y-auto @min-[860px]/new-session:max-h-none" data-path-list>
          {paths.map((folder, index) =>
            row(
              index,
              <>
                {folder.isGit ? <FolderGit2 size={15} className="shrink-0 text-muted" aria-hidden /> : <Folder size={15} className="shrink-0 text-muted" aria-hidden />}
                <span className="min-w-0 truncate font-mono text-ui text-text">{tildify(folder.path, home)}</span>
                {folder.isGit && <span className="shrink-0 font-mono text-meta text-faint">git{folder.branch ? ` · ${folder.branch}` : ''}</span>}
              </>,
              addOrSelect(folder.path, projects) === 'select' ? 'Start here' : 'Add and start here',
              { 'data-path-suggestion': folder.path },
            ),
          )}
          {missing && (
            <p className="px-2.5 py-1.5 text-ui text-muted" data-path-missing>
              No folder at <span className="font-mono">{filter}</span>
            </p>
          )}
        </div>
        <p className="px-1 text-meta text-faint">{pathHint}</p>
      </>
    ) : mode === 'known' ? (
      <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Folders with Claude sessions" className="grid max-h-80 min-h-0 gap-0.5 overflow-y-auto @min-[860px]/new-session:max-h-none" data-known-list>
        {known.map((p, index) =>
          row(
            index,
            <>
              <ProjectIcon project={p} root={p.root} size={20} />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-ui font-semibold text-text">{p.name}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-meta text-faint">
                  <span className="min-w-0 truncate font-mono">{tildify(p.root, home)}</span>
                  <span className="shrink-0">· has Claude sessions</span>
                </span>
              </span>
            </>,
            'Add and start here',
            { 'data-known-folder': p.root },
          ),
        )}
        {row(
          known.length,
          <>
            <FolderPlus size={15} className="shrink-0" aria-hidden />
            <span className="text-ui font-semibold">Choose a folder…</span>
          </>,
          'Open',
          { 'data-choose-folder': true },
        )}
      </div>
    ) : (
      <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Your projects" className={`${ROW_GRID} max-h-80 min-h-0 overflow-y-auto p-px @min-[860px]/new-session:max-h-none`} data-project-list data-project-columns={columns}>
        {options.map(tile)}
      </div>
    );

  return (
    // A container: the list shows one or two columns as the picker (not the window) narrows.
    <div ref={rootRef} className="@container relative flex min-h-0 flex-1 flex-col gap-2" data-project-header onDragEnter={onDragOver} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {open ? (
        // As tall as its rows, like the short list, so the footer stays under them; it shrinks and scrolls when they don't fit.
        <div className="flex min-h-0 flex-col gap-2" data-folder-list>
          <label className="flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 focus-within:border-accent-ink/60">
            {pathMode ? <Folder size={14} className="shrink-0 text-faint" aria-hidden /> : <Search size={14} className="shrink-0 text-faint" aria-hidden />}
            <span className="relative flex min-w-0 flex-1">
              {/* The short list is gone while the full one is open, so the field carries its smoke hooks (value, expanded). */}
              <input
                ref={fieldRef}
                autoFocus
                role="combobox"
                aria-expanded
                data-folder-select
                data-value={value ?? ''}
                aria-controls={`${id}-list`}
                aria-activedescendant={count ? optionId(Math.min(active, count - 1)) : undefined}
                aria-autocomplete="both"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={onFieldKey}
                placeholder={onClone ? 'Filter, type a path, or paste a URL' : 'Filter projects, or type a path'}
                aria-label={onClone ? 'Filter projects, type a path, or paste a GitHub URL' : 'Filter projects, or type a path'}
                spellCheck={false}
                className={`w-full min-w-0 bg-transparent text-ui text-text outline-none placeholder:text-faint ${pathMode ? 'font-mono' : ''}`}
              />
              {/* The rest of the first match, faint after the text; Tab takes it. */}
              {ghost && (
                <span aria-hidden className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden text-ui whitespace-pre ${pathMode ? 'font-mono' : ''}`} data-path-ghost>
                  <span className="invisible">{filter}</span>
                  <span className="text-faint">{ghost}</span>
                </span>
              )}
            </span>
            {mode === 'tiles' && filter.trim() !== '' && (
              <span className="shrink-0 text-meta text-faint tabular-nums" data-filter-count>
                {options.length} of {all.length}
              </span>
            )}
          </label>
          {list}
        </div>
      ) : (
        // The list carries the picker's smoke hook (the picked folder) while the full list is closed.
        <>
          {/* Opens the full list with its filter field in its place; typing on a row does the same. */}
          <button type="button" onClick={() => setOpen(true)} onMouseDown={(e) => e.preventDefault()} className="flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-lg bg-text/6 px-2.5 text-left text-ui text-muted hover:bg-border/45 hover:text-text" data-find-project>
            <Search size={14} className="shrink-0 text-faint" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Find a project</span>
            <Kbd shortcut="new-session.find" tone="plain" />
          </button>
          <div
            ref={groupRef}
            role={end?.kind === 'choose' ? undefined : 'listbox'}
            aria-label={end?.kind === 'choose' ? undefined : projectOrder === 'yours' ? 'Your projects' : 'Recent projects'}
            data-folder-select
            data-value={value ?? ''}
            data-project-list
            data-project-columns={columns}
            className={`${ROW_GRID} min-h-0 p-px @min-[860px]/new-session:overflow-y-auto`}
            onKeyDown={onListKey}
          >
            {quick.map(tile)}
            {end?.kind === 'choose' && (
              // No projects yet: the whole row is the way in. Typing here opens the field too, for a path.
              <button
                type="button"
                data-add-project-tile
                data-add-folder
                onClick={addProject}
                className="col-span-full flex min-w-0 items-center gap-2.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-left text-muted hover:bg-border/45 hover:text-text"
              >
                <span className="flex size-[30px] shrink-0 items-center justify-center">
                  <FolderPlus size={16} aria-hidden />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-ui font-semibold">Add project…</span>
                  <span className="truncate text-meta text-faint">or type a path</span>
                </span>
              </button>
            )}
          </div>
        </>
      )}
      {footer}
      {questionRow}
      {drop && (
        <div
          aria-hidden
          data-folder-drop={drop.ok ? 'ok' : 'refused'}
          className={`pointer-events-none absolute -inset-2 z-10 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed bg-bg/90 ${drop.ok ? 'border-accent-ink' : 'border-border'}`}
        >
          <FolderPlus size={22} className={drop.ok ? 'text-accent-ink' : 'text-muted'} aria-hidden />
          <span className="text-ui font-semibold text-text">{drop.ok ? 'Drop to add the folder' : 'Drop one folder'}</span>
          {drop.ok && <span className="text-meta text-muted">It becomes a project and is selected</span>}
        </div>
      )}
    </div>
  );
}
