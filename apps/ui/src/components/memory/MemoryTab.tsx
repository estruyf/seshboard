import { AlertTriangle, BookCopy, ClipboardCopy, ClipboardPaste, Copy, Download, FileText, FolderInput, FolderSearch, MoreHorizontal, Pencil, Plus, Search, Share2, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { fileManagerName, trashName } from '../../lib/platform.ts';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { isSameOrInside, MEMORY_INDEX_LIMIT, type InstructionFile, type MemoryFile } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { basename, dirnameOf, shortAge, tildify } from '../../lib/format.ts';
import { LEVEL_TEXT } from '../../lib/levels.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { guardMemoryEdits, useMemoryView } from '../../state/memoryStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { Button } from '../ui/Button.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Meter } from '../ui/Meter.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { HealthPanel, useMemoryHealth } from './HealthPanel.tsx';
import { flaggedPaths, healthSummary, toLookAt } from './healthView.ts';
import { InstructionEditor } from './InstructionEditor.tsx';
import { LoadOrderCard } from './LoadOrderCard.tsx';
import { indexLevel } from './loadOrderView.ts';
import { MemoryEditor } from './MemoryEditor.tsx';
import { copyForClaudeApp, importFromClaudeExport, pasteFromClaudeApp } from './memoryDialogs.ts';
import { filterByProfile, instructionDetail, memoryProfiles, relativeTo, typeTone } from './memoryUi.ts';
import { NewMemoryDialog } from './NewMemoryDialog.tsx';
import { RenameMemoryDialog } from './RenameMemoryDialog.tsx';
import { useMemoryFile, useMemoryLinks, useMemoryList, usePersonalMemory } from './useMemoryList.ts';

type Selected = { kind: 'memory'; file: MemoryFile } | { kind: 'instruction'; file: InstructionFile } | { kind: 'file'; file: { path: string } };

/** Opens the share dialog for a memory (it outlives the tab's menus, so the palette's dialog host shows it). */
export const shareMemory = (root: string, memory: MemoryFile) => usePaletteBus.getState().showDialog({ kind: 'share-memory', root, memoryPath: memory.path, name: memory.name });
/** Opens the dialog that copies a section of an instruction file into memory. */
export const copySection = (root: string, file: InstructionFile) => usePaletteBus.getState().showDialog({ kind: 'copy-section', root, file: file.path });

const matchesFilter = (filter: string, ...texts: Array<string | null | undefined>) => {
  const needle = filter.trim().toLowerCase();
  return !needle || texts.some((t) => t?.toLowerCase().includes(needle));
};

/** A memory row in the list: name, type, age and description. Right-click and Shift+F10 open its menu. */
export function MemoryRow({ memory, selected, onSelect, onMenu, badge, flag }: { memory: MemoryFile; selected: boolean; onSelect(): void; onMenu(at: ContextMenuPoint): void; badge?: ReactNode; flag?: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`grid w-full min-w-0 gap-0.5 rounded-lg px-2.5 py-1.5 text-left ${selected ? 'bg-selected' : 'hover:bg-border/45'}`}
      data-memory-row={memory.path}
      data-memory-kind="memory"
      onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        onSelect();
        onMenu(contextMenuPoint({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), window.innerHeight));
      }}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (!isContextMenuKey(event)) return;
        event.preventDefault();
        onMenu(contextMenuPoint(null, event.currentTarget.getBoundingClientRect(), window.innerHeight));
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {badge}
        <span className="truncate text-ui font-semibold">{memory.name}</span>
        {memory.type && <Pill tone={typeTone(memory.type)}>{memory.type}</Pill>}
        {flag && (
          <span className="flex shrink-0 text-caution" data-tooltip={flag} aria-label={`To look at: ${flag}`} data-memory-flag>
            <AlertTriangle size={12} aria-hidden />
          </span>
        )}
        <span className="ml-auto shrink-0 text-meta text-faint">{shortAge(memory.modified)}</span>
      </span>
      {memory.description && <span className="truncate text-meta text-muted">{memory.description}</span>}
    </button>
  );
}

/** A sync tool's second copy of a memory: which one to keep. The one that goes moves to the Trash. */
function ConflictRow({ memory, onKeep }: { memory: MemoryFile; onKeep(keep: 'this' | 'other'): void }) {
  const file = basename(memory.path);
  const other = memory.conflictOf ? basename(memory.conflictOf) : '';
  return (
    <div className="grid gap-1.5 rounded-lg px-2.5 py-1.5" data-memory-row={memory.path} data-memory-kind="conflict">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-ui">{file}</span>
        <Pill tone="caution">conflict</Pill>
      </span>
      <span className="text-meta text-muted">A sync tool kept two versions of {other}.</span>
      <span className="flex gap-1.5">
        <Button size="sm" onClick={() => onKeep('this')} data-memory-keep="this">
          Keep this one
        </Button>
        <Button size="sm" onClick={() => onKeep('other')} data-memory-keep="other">
          Keep the other
        </Button>
      </span>
    </div>
  );
}

/** What the memory list and editor share: dialogs for New, Rename and Delete, and the leave-with-unsaved-changes question. */
export function useMemoryActions(root: string | null, where: string, onSelect: (path: string) => void) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [dialog, setDialog] = useState<
    | { kind: 'new'; taken: string[]; initial?: { name?: string } }
    | { kind: 'rename'; memory: MemoryFile; taken: string[]; linkers: string[] }
    | { kind: 'delete'; memory: MemoryFile }
    | null
  >(null);
  const leave = useMemoryView((s) => s.leave);

  const reveal = (path: string) => void client?.call('editors.open', { path, editorId: 'finder' }).catch((e: Error) => toast(`Couldn't show it in ${fileManagerName()}: ${e.message}`));
  const overlays = (
    <>
      {dialog?.kind === 'new' && <NewMemoryDialog root={root} where={where} taken={dialog.taken} initial={dialog.initial} onClose={() => setDialog(null)} onCreated={onSelect} />}
      {dialog?.kind === 'rename' && (
        <RenameMemoryDialog root={root} path={dialog.memory.path} name={dialog.memory.name} taken={dialog.taken} linkers={dialog.linkers} onClose={() => setDialog(null)} onRenamed={(path) => onSelect(path)} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${dialog.memory.name}”?`}
          danger
          confirmLabel={`Move to ${trashName()}`}
          body={`The file moves to the ${trashName()} and its line leaves MEMORY.md, so Claude stops reading it. You can undo it right after.`}
          onConfirm={async () => {
            if (!client) throw new Error('Not connected to the engine');
            const { undoToken } = await client.call('memory.remove', { root, path: dialog.memory.path });
            useMemoryView.setState({ dirty: false });
            toast(`Moved ${dialog.memory.name} to the ${trashName()}`, {
              undo: () => void client.call('memory.restore', { undoToken }).then(({ path }) => onSelect(path), (e: Error) => toast(`Couldn't undo: ${e.message}`)),
              data: { 'data-memory-deleted-toast': true },
            });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {leave && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body="The memory you are editing has changes that aren't saved."
          confirmLabel="Discard"
          danger
          onConfirm={async () => {
            useMemoryView.setState({ dirty: false, leave: null });
            leave();
          }}
          onClose={() => useMemoryView.setState({ leave: null })}
        />
      )}
    </>
  );
  return {
    overlays,
    reveal,
    newMemory: (taken: string[], initial?: { name?: string }) => setDialog({ kind: 'new', taken, initial }),
    rename: (memory: MemoryFile, taken: string[], linkers: string[] = []) => setDialog({ kind: 'rename', memory, taken, linkers }),
    remove: (memory: MemoryFile) => setDialog({ kind: 'delete', memory }),
  };
}

/**
 * A project's Memory tab: Claude Code's auto memory for the project (private, on this Mac) and the instruction files
 * the team shares. A memory opens in the editor; an instruction file shows read-only. A memory can be shared with the
 * team, and a section of the instructions copied into memory.
 */
export function MemoryTab({ root }: { root: string }) {
  const { list, error, reload } = useMemoryList(root);
  const openIn = useOpenIn();
  const projectName = useProjects((s) => s.projects.get(root)?.name ?? basename(root));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ at: ContextMenuPoint; entries: MenuEntry[] } | null>(null);
  const focus = useMemoryView((s) => s.focus);
  const handled = useRef(0);
  /** The memory last opened from elsewhere (search, a link, a toast): its editor takes the cursor. */
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  /** What Health asked to mark in it (a stale reference). */
  const [highlight, setHighlight] = useState<string[]>([]);
  const findings = useMemoryHealth(root);
  const [healthOpen, setHealthOpen] = useState(false);
  const flagged = useMemo(() => flaggedPaths(findings ?? []), [findings]);
  const actions = useMemoryActions(root, projectName, (path) => setSelectedPath(path));
  const personalActions = useMemoryActions(null, 'Personal', (path) => setSelectedPath(path));
  const { personal } = usePersonalMemory();
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const isPersonal = (path: string) => !!personal && path !== personal.dir && isSameOrInside(path, personal.dir);

  // Claude Code writes memory on its own: read the folder again whenever the window comes back into view.
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  // A file someone asked to see (a memory just saved, the palette): select it once the list has it.
  useEffect(() => {
    if (!focus || focus.root !== root || focus.nonce === handled.current || !list) return;
    if (![...list.memories, ...list.instructions, ...(personal?.memories ?? [])].some((f) => f.path === focus.path)) return;
    handled.current = focus.nonce;
    setSelectedPath(focus.path);
    setFocusedPath(focus.path);
    setHighlight(focus.highlight ?? []);
  }, [focus, root, list, personal]);

  // With memory under more than one Claude profile: a filter, and a dot on each row saying whose it is.
  const allProfiles = useProfiles((s) => s.profiles);
  const [profileFilter, setProfileFilter] = useState('all');
  const presentProfiles = useMemo(() => memoryProfiles(list?.memories ?? [], allProfiles.map((p) => p.id)), [list, allProfiles]);
  const byProfile = presentProfiles.length > 1;
  const memories = useMemo(
    () => filterByProfile(list?.memories ?? [], byProfile ? profileFilter : 'all').filter((m) => matchesFilter(filter, m.name, m.description, m.type)),
    [list, filter, profileFilter, byProfile],
  );
  const profileBadge = (memory: MemoryFile) => {
    const profile = byProfile ? allProfiles.find((p) => p.id === memory.profileId) : undefined;
    return profile ? (
      <span data-tooltip={profile.name} aria-label={profile.name}>
        <ProfileDot color={profile.color} />
      </span>
    ) : undefined;
  };
  const instructions = useMemo(() => (list?.instructions ?? []).filter((i) => matchesFilter(filter, relativeTo(root, i.path))), [list, filter, root]);
  // Links between memories: what each links to (written or not) and what links to it.
  const links = useMemoryLinks(root);
  const [unwrittenOnly, setUnwrittenOnly] = useState<'project' | 'personal' | null>(null);
  const hasUnwritten = (m: MemoryFile) => links[m.path]?.links.some((l) => l.target === null) ?? false;
  const unwrittenCount = (items: readonly MemoryFile[]) => new Set(items.flatMap((m) => (links[m.path]?.links ?? []).filter((l) => l.target === null).map((l) => l.name))).size;
  const nameOf = (path: string) => [...(list?.memories ?? []), ...(personal?.memories ?? [])].find((m) => m.path === path)?.name ?? basename(path).replace(/\.md$/, '');
  const linkersOf = (m: MemoryFile) => (links[m.path]?.backlinks ?? []).map(nameOf);
  const personalMemories = useMemo(
    () => (personal?.memories ?? []).filter((m) => matchesFilter(filter, m.name, m.description, m.type) && (unwrittenOnly !== 'personal' || hasUnwritten(m))),
    [personal, filter, unwrittenOnly, links],
  );
  /** "N links not written yet" over a list: a chip that shows only the memories with such links. */
  const unwrittenChip = (items: readonly MemoryFile[], scope: 'project' | 'personal') => {
    const count = unwrittenCount(items);
    if (count === 0) return null;
    return (
      <Pill tone="caution" onClick={() => setUnwrittenOnly((s) => (s === scope ? null : scope))} selected={unwrittenOnly === scope} aria-pressed={unwrittenOnly === scope} className="mx-2.5 mb-1 justify-self-start" data-memory-unwritten={scope}>
        {count} {count === 1 ? 'link' : 'links'} not written yet
      </Pill>
    );
  };
  const selected: Selected | null = useMemo(() => {
    const memory = list?.memories.find((m) => m.path === selectedPath) ?? personal?.memories.find((m) => m.path === selectedPath);
    if (memory) return { kind: 'memory', file: memory };
    const instruction = list?.instructions.find((i) => i.path === selectedPath);
    if (instruction) return { kind: 'instruction', file: instruction };
    // Another file What loads here lists (the profile's CLAUDE.md, a rule, an import, MEMORY.md): shown read-only.
    if (selectedPath && list) return { kind: 'file', file: { path: selectedPath } };
    // Nothing picked yet (or it went away): the newest memory, else the first instruction file.
    const first = list?.memories[0];
    if (first) return { kind: 'memory', file: first };
    return list?.instructions[0] ? { kind: 'instruction', file: list.instructions[0] } : null;
  }, [list, personal, selectedPath]);
  // Read again with every new listing: the file may have changed with it.
  const { content, modified, error: readError } = useMemoryFile(root, selected && selected.kind !== 'memory' ? selected.file.path : null, list);

  /** Names a new or renamed memory can't take: the files in the same folder. */
  const takenIn = (dir: string) =>
    [...(list?.memories ?? []), ...(personal?.memories ?? [])].filter((m) => isSameOrInside(m.path, dir) && m.path !== dir).map((m) => basename(m.path).replace(/\.md$/, ''));
  const homeDir = list?.memoryDir ?? '';
  const select = (path: string) => guardMemoryEdits(() => setSelectedPath(path));
  const names = useMemo(() => new Set([...(list?.memories ?? []), ...(personal?.memories ?? [])].map((m) => m.name)), [list, personal]);
  const home = useHomeFolder();

  /** Moves a memory to the personal folder, or from it into this project (the project's own profile). */
  const move = (memory: MemoryFile, to: 'personal' | 'project') =>
    guardMemoryEdits(
      () =>
        void client?.call('memory.move', { root, path: memory.path, to }).then(
          ({ path }) => (setSelectedPath(path), toast(to === 'personal' ? `Moved ${memory.name} to Personal` : `Moved ${memory.name} to ${projectName}`)),
          (e: Error) => toast(`Couldn't move it: ${e.message}`),
        ),
    );
  const actionsFor = (memory: MemoryFile) => (isPersonal(memory.path) ? personalActions : actions);
  const memoryEntries = (memory: MemoryFile): MenuEntry[] => {
    const mine = isPersonal(memory.path);
    const act = actionsFor(memory);
    const share: MenuEntry[] = mine ? [] : [{ label: 'Share with the team…', icon: <Share2 size={13} aria-hidden />, onSelect: () => shareMemory(root, memory), data: { 'data-memory-menu-share': true } }];
    return [
      ...share,
      { label: 'Rename…', icon: <Pencil size={13} aria-hidden />, onSelect: () => act.rename(memory, takenIn(dirnameOf(memory.path)), linkersOf(memory)), data: { 'data-memory-menu-rename': true } },
      mine
        ? { label: `Move to ${projectName}`, icon: <FolderInput size={13} aria-hidden />, onSelect: () => move(memory, 'project'), data: { 'data-memory-menu-move': 'project' } }
        : { label: 'Move to Personal', icon: <FolderInput size={13} aria-hidden />, onSelect: () => move(memory, 'personal'), data: { 'data-memory-menu-move': 'personal' } },
      ...(mine
        ? []
        : allProfiles
            .filter((p) => p.id !== memory.profileId)
            .map(
              (p): MenuEntry => ({
                label: `Copy to ${p.name}`,
                icon: <Copy size={13} aria-hidden />,
                onSelect: () =>
                  void client?.call('memory.copyToProfile', { root, path: memory.path, profileId: p.id }).then(
                    ({ path }) => (setSelectedPath(path), toast(`Copied ${memory.name} to ${p.name}`)),
                    (e: Error) => toast(`Couldn't copy it: ${e.message}`),
                  ),
                data: { 'data-memory-menu-copy-profile': p.id },
              }),
            )),
      { label: `Reveal in ${fileManagerName()}`, icon: <FolderSearch size={13} aria-hidden />, onSelect: () => act.reveal(memory.path) },
      'separator',
      { label: 'Delete…', icon: <Trash2 size={13} aria-hidden />, danger: true, onSelect: () => act.remove(memory), data: { 'data-memory-menu-delete': true } },
    ];
  };
  const memoryRows = (items: MemoryFile[], scope: string | null) =>
    items.map((memory) =>
      memory.conflictOf ? (
        <ConflictRow
          key={memory.path}
          memory={memory}
          onKeep={(keep) =>
            void client?.call('memory.resolveConflict', { root: scope, path: memory.path, keep }).then(
              ({ path }) => (setSelectedPath(path), toast(keep === 'this' ? `Kept this version; the other went to the ${trashName()}` : `Kept the other version; this copy went to the ${trashName()}`)),
              (e: Error) => toast(`Couldn't resolve it: ${e.message}`),
            )
          }
        />
      ) : (
        <MemoryRow
          key={memory.path}
          memory={memory}
          badge={profileBadge(memory)}
          flag={flagged.get(memory.path)}
          selected={selected?.file.path === memory.path}
          onSelect={() => select(memory.path)}
          onMenu={(at) => setMenu({ at, entries: memoryEntries(memory) })}
        />
      ),
    );
  const instructionEntries = (file: InstructionFile): MenuEntry[] => [
    { label: 'Copy a section to my memory…', icon: <BookCopy size={13} aria-hidden />, onSelect: () => copySection(root, file), data: { 'data-memory-menu-copy': true } },
    { label: 'Open in editor', icon: <SquareArrowOutUpRight size={13} aria-hidden />, onSelect: () => void openIn(file.path).catch(() => {}) },
    { label: `Reveal in ${fileManagerName()}`, icon: <FolderSearch size={13} aria-hidden />, onSelect: () => actions.reveal(file.path) },
  ];

  const importEntries: MenuEntry[] = [
    { label: 'Import from Claude export…', icon: <Download size={13} aria-hidden />, onSelect: () => void importFromClaudeExport(), data: { 'data-memory-menu-import-export': true } },
    { label: 'Paste from Claude app…', icon: <ClipboardPaste size={13} aria-hidden />, onSelect: pasteFromClaudeApp, data: { 'data-memory-menu-paste-app': true } },
    'separator',
    { label: 'Copy for Claude app…', icon: <ClipboardCopy size={13} aria-hidden />, onSelect: copyForClaudeApp, data: { 'data-memory-menu-copy-for-app': true } },
  ];

  if (error) return <Notice tone="error">{`Couldn't read this project's memory: ${error}`}</Notice>;
  if (!list) return <p className="text-ui text-muted">Reading memory…</p>;

  const instructionRow = (file: InstructionFile) => (
    <button
      key={file.path}
      type="button"
      onClick={() => select(file.path)}
      aria-current={selected?.file.path === file.path ? 'true' : undefined}
      className={`grid w-full min-w-0 gap-0.5 rounded-lg px-2.5 py-1.5 text-left ${selected?.file.path === file.path ? 'bg-selected' : 'hover:bg-border/45'}`}
      data-memory-row={file.path}
      data-memory-kind="instruction"
      onContextMenu={(event) => {
        event.preventDefault();
        select(file.path);
        setMenu({ at: contextMenuPoint({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), window.innerHeight), entries: instructionEntries(file) });
      }}
      onKeyDown={(event) => {
        if (!isContextMenuKey(event)) return;
        event.preventDefault();
        setMenu({ at: contextMenuPoint(null, event.currentTarget.getBoundingClientRect(), window.innerHeight), entries: instructionEntries(file) });
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <FileText size={13} className="shrink-0 text-faint" aria-hidden />
        <span className="truncate font-mono text-ui">{relativeTo(root, file.path)}</span>
        <Pill tone={file.shared ? 'muted' : 'default'} className="ml-auto">
          {file.shared ? 'shared' : 'local only'}
        </Pill>
      </span>
      <span className="truncate pl-5 text-meta text-muted">{instructionDetail(file)}</span>
    </button>
  );

  return (
    <div className="grid gap-3" data-memory-view>
      <LoadOrderCard
        root={root}
        home={home}
        onSelect={select}
        extra={
          findings && (
            <span className="flex shrink-0 items-center gap-1 text-meta text-muted" data-memory-health-line>
              Health: <span className={toLookAt(findings).length ? 'text-caution' : ''}>{healthSummary(findings)}</span>
              {findings.length > 0 && (
                <>
                  <span className="text-faint">·</span>
                  <Button size="sm" variant="quiet" onClick={() => setHealthOpen((o) => !o)} aria-expanded={healthOpen} data-memory-health-show>
                    {healthOpen ? 'Hide' : 'Show'}
                  </Button>
                </>
              )}
            </span>
          )
        }
      />
      {healthOpen && findings && <HealthPanel root={root} findings={findings} onClose={() => setHealthOpen(false)} />}
      <div className="grid min-h-[520px] grid-cols-[minmax(240px,320px)_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card @max-[860px]:grid-cols-1" data-project-memory-tab data-memory-dir={list.memoryDir ?? ''}>
        <div className="flex min-w-0 flex-col gap-3 border-r border-border p-2.5 @max-[860px]:border-r-0 @max-[860px]:border-b">
          <div className="flex min-w-0 items-center gap-1.5">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">Filter memory</span>
              <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" aria-hidden />
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter memory"
                className="h-7 w-full rounded-md border border-edge bg-bg pr-2.5 pl-7 text-ui text-text outline-none focus:border-accent-ink"
                data-memory-filter
              />
            </label>
            <Button
              variant="quiet"
              icon={<Download size={13} aria-hidden />}
              aria-haspopup="menu"
              data-tooltip="Bring memories in from the Claude app, or copy them there"
              onClick={(e) => setMenu({ at: contextMenuPoint(null, e.currentTarget.getBoundingClientRect(), window.innerHeight), entries: importEntries })}
              data-memory-import-menu
            >
              Import
            </Button>
          </div>
          <section aria-labelledby="memory-project-heading" className="grid gap-0.5">
            <SectionHeader
              as="h3"
              headingId="memory-project-heading"
              count={list.memories.length}
              className="px-2.5 pb-1"
              action={
                <Button size="sm" variant="quiet" icon={<Plus size={12} aria-hidden />} onClick={() => guardMemoryEdits(() => actions.newMemory(takenIn(homeDir)))} className="ml-auto" data-memory-new>
                  New
                </Button>
              }
            >
              Project memory
            </SectionHeader>
            {/* On its own line: next to the heading it doesn't fit the narrow list column. */}
            {list.indexLines > 0 && (
              <Meter percent={(list.indexLines / MEMORY_INDEX_LIMIT) * 100} level={indexLevel(list.indexLines)} label={`MEMORY.md: ${list.indexLines} of ${MEMORY_INDEX_LIMIT} lines load`} className="mx-2.5 mb-1 justify-self-start" data-memory-index-meter>
                <span className={`font-mono text-meta tabular-nums ${LEVEL_TEXT[indexLevel(list.indexLines)] || 'text-muted'}`}>
                  MEMORY.md {list.indexLines} / {MEMORY_INDEX_LIMIT}
                </span>
              </Meter>
            )}
            {memories.length === 0 && (
              <p className="px-2.5 text-meta text-muted">{list.memories.length ? 'Nothing matches.' : 'No memory for this project yet. Claude Code writes it as you work.'}</p>
            )}
            {byProfile && (
              <SegmentedControl
                mode="radio"
                size="sm"
                label="Claude profile"
                value={profileFilter}
                onChange={setProfileFilter}
                className="mx-2.5 mb-1 justify-self-start"
                data-memory-profile-filter
                segments={[{ value: 'all', label: 'All' }, ...presentProfiles.map((id) => ({ value: id, label: allProfiles.find((p) => p.id === id)?.name ?? id }))]}
              />
            )}
            {unwrittenChip(list.memories, 'project')}
            {memoryRows(unwrittenOnly === 'project' ? memories.filter(hasUnwritten) : memories, root)}
          </section>
          <section aria-labelledby="memory-instructions-heading" className="grid gap-0.5">
            <SectionHeader as="h3" headingId="memory-instructions-heading" className="px-2.5 pb-1">
              Instructions
            </SectionHeader>
            {instructions.length === 0 && <p className="px-2.5 text-meta text-muted">{list.instructions.length ? 'Nothing matches.' : 'No CLAUDE.md or rules in this project yet.'}</p>}
            {instructions.map(instructionRow)}
          </section>
          {personal && (
            <section aria-labelledby="memory-personal-heading" className="grid gap-0.5" data-memory-personal-section>
              <SectionHeader
                as="h3"
                headingId="memory-personal-heading"
                count={personal.memories.length}
                className="px-2.5 pb-1"
                action={
                  <Button size="sm" variant="quiet" icon={<Plus size={12} aria-hidden />} onClick={() => guardMemoryEdits(() => personalActions.newMemory(takenIn(personal.dir)))} className="ml-auto" data-memory-new-personal>
                    New
                  </Button>
                }
              >
                Personal (all projects)
              </SectionHeader>
              {personalMemories.length === 0 && (
                <p className="px-2.5 text-meta text-muted">{personal.memories.length ? 'Nothing matches.' : 'Nothing yet. Memory about you (how you like to work) goes here and loads in every project.'}</p>
              )}
              {unwrittenChip(personal.memories, 'personal')}
              {memoryRows(personalMemories, null)}
            </section>
          )}
        </div>
        <div className="flex min-w-0 flex-col" data-memory-viewer={selected?.file.path ?? ''}>
          {selected?.kind === 'memory' ? (
            <MemoryEditor
              key={selected.file.path}
              root={isPersonal(selected.file.path) ? null : root}
              memory={selected.file}
              autoFocus={selected.file.path === focusedPath}
              highlight={selected.file.path === focusedPath ? highlight : undefined}
              linkInfo={links[selected.file.path]}
              labelOf={nameOf}
              onOpenPath={select}
              names={names}
              menuEntries={memoryEntries(selected.file).filter((e) => typeof e !== 'object' || !('label' in e) || e.label !== 'Rename…')}
              onShare={isPersonal(selected.file.path) ? undefined : () => shareMemory(root, selected.file)}
              onRename={() => actionsFor(selected.file).rename(selected.file, takenIn(dirnameOf(selected.file.path)), linkersOf(selected.file))}
              onDelete={() => actionsFor(selected.file).remove(selected.file)}
              onReveal={() => actions.reveal(selected.file.path)}
              footerActions={
                <Button size="sm" variant="quiet" icon={<FolderInput size={12} aria-hidden />} onClick={() => move(selected.file, isPersonal(selected.file.path) ? 'project' : 'personal')} data-memory-move>
                  {isPersonal(selected.file.path) ? `Move to ${projectName}` : 'Move to Personal'}
                </Button>
              }
              onOpenLink={(name) => {
                // The same folder first, then the personal one.
                const folder = dirnameOf(selected.file.path);
                const all = [...list.memories, ...(personal?.memories ?? [])];
                const target = all.find((m) => m.name === name && isSameOrInside(m.path, folder)) ?? personal?.memories.find((m) => m.name === name) ?? all.find((m) => m.name === name);
                if (target) select(target.path);
                else guardMemoryEdits(() => actionsFor(selected.file).newMemory(takenIn(folder), { name }));
              }}
            />
          ) : selected ? (
            <>
              <div className="flex min-w-0 items-start gap-3 border-b border-border px-4 py-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <h3 className="flex min-w-0 items-center gap-2 text-title font-semibold">
                    <span className="truncate">{selected.kind === 'instruction' ? relativeTo(root, selected.file.path) : tildify(selected.file.path, home)}</span>
                    {selected.kind === 'instruction' && <Pill tone={selected.file.shared ? 'muted' : 'default'}>{selected.file.shared ? 'shared' : 'local only'}</Pill>}
                  </h3>
                  <p className="truncate text-meta text-muted">
                    {selected.kind === 'file'
                      ? 'Loaded in every session here. Edit it in your editor.'
                      : selected.file.shared
                        ? 'Committed with the project: everyone working on it gets these instructions.'
                        : 'Only on this Mac: Claude Code loads it for you, next to the project’s instructions.'}
                  </p>
                </div>
                {selected.kind === 'instruction' ? (
                  <>
                    <Button icon={<BookCopy size={13} aria-hidden />} onClick={() => copySection(root, selected.file)} data-memory-copy>
                      Copy to my memory…
                    </Button>
                    <Button
                      variant="quiet"
                      iconOnly
                      icon={<MoreHorizontal size={14} aria-hidden />}
                      aria-label="More"
                      aria-haspopup="menu"
                      onClick={(e) => setMenu({ at: contextMenuPoint(null, e.currentTarget.getBoundingClientRect(), window.innerHeight), entries: instructionEntries(selected.file) })}
                    />
                  </>
                ) : (
                  <Button icon={<SquareArrowOutUpRight size={13} aria-hidden />} onClick={() => void openIn(selected.file.path).catch(() => {})}>
                    Open in editor
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 p-4">
                {readError ? (
                  <Notice tone="error">{`Couldn't read this file: ${readError}`}</Notice>
                ) : selected.kind === 'instruction' ? (
                  <InstructionEditor key={selected.file.path} root={root} path={selected.file.path} content={content} modified={modified} shared={selected.file.shared} />
                ) : (
                  <pre className="overflow-x-auto rounded-lg border border-border bg-code p-4 font-mono text-ui break-words whitespace-pre-wrap select-text" data-memory-content>
                    {content ?? 'Reading…'}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <p className="m-auto max-w-sm p-6 text-center text-ui text-muted">Nothing here yet. Claude Code saves what it learns about this project as memory, and CLAUDE.md holds what the team shares.</p>
          )}
        </div>
        {menu && <Menu x={menu.at.x} y={menu.at.y} above={menu.at.above} entries={menu.entries} label="Memory file" onClose={() => setMenu(null)} />}
      </div>
      {actions.overlays}
      {personalActions.overlays}
    </div>
  );
}
