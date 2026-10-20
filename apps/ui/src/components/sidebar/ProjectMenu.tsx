import { currentPlatform } from '../../lib/platform.ts';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Check, ChevronDown, Ellipsis, FolderCog, FolderDown, FolderGit2, FolderOpen, FolderPlus, GitBranch, Image, Layers, Monitor, Pencil, RotateCcw, SlidersHorizontal, Smile, Type, X, Zap } from 'lucide-react';
import { isAbsolutePath, type ProjectIconChoice } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { openProject } from '../../state/projectPageStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useClone, useCloneEnabled } from '../../state/cloneStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { RenameProjectDialog } from '../projects/RenameProjectDialog.tsx';
import { isQuestionsFolder } from '../../lib/questions.ts';
import { Button } from '../ui/Button.tsx';
import { Popover } from '../ui/Popover.tsx';
import { ComputerChip } from '../computers/ComputerChip.tsx';
import { useComputers } from '../../state/computersStore.ts';
import { toggleSource } from '../../state/remoteRows.ts';

const SUGGESTED = ['🚀', '🧪', '📦', '🛠️', '🌐', '📱', '🎨', '📝', '🤖', '⚡️', '🔥', '🧩', '📊', '🎬', '🚲', '☁️'];

/** Project actions shared by the filter dropdown and session context menus. */
export function useProjectActions() {
  const connection = useEngineConnection();
  const reload = useProjects((s) => s.reload);
  const client = connection.status === 'connected' ? connection.client : null;
  const setIcon = async (root: string, icon: ProjectIconChoice) => {
    if (!client) return;
    await client.call('projects.setIcon', { root, icon });
    reload();
  };
  return {
    setIcon,
    chooseImage: async (root: string) => {
      const path = await window.switchboard?.pickImage(root);
      if (path) await setIcon(root, { kind: 'file', path });
    },
    add: async (path: string) => {
      if (!client) throw new Error('Not connected to the engine');
      await client.call('projects.add', { path });
      reload();
    },
    /** The system folder dialog, then adds what was picked. Resolves to the folder, or null when cancelled. */
    chooseAndAdd: async () => {
      const path = await window.switchboard?.pickFolder();
      if (!path || !client) return null;
      await client.call('projects.add', { path });
      reload();
      return path;
    },
    /** Links a project to a Claude profile (null: the default). */
    setProfile: async (root: string, profileId: string | null) => {
      if (!client) return;
      await client.call('projects.setProfile', { root, profileId });
      reload();
    },
    remove: async (root: string) => {
      if (!client) return;
      await client.call('projects.remove', { root });
      reload();
    },
  };
}

/** Picks an emoji for a project. A popover: kept on screen, closed by an outside click or Escape. */
function EmojiPicker({ x, y, root, onClose }: { x: number; y: number; root: string; onClose(): void }) {
  const { setIcon } = useProjectActions();
  const [value, setValue] = useState('');
  const apply = (emoji: string) => {
    if (emoji.trim()) void setIcon(root, { kind: 'emoji', value: emoji.trim() });
    onClose();
  };
  return (
    <Popover x={x} y={y} width={224} onClose={onClose} role="dialog" aria-label="Choose an emoji" data-emoji-picker>
      <div className="px-2 py-1">
        <div className="grid grid-cols-8 gap-0.5">
          {SUGGESTED.map((emoji) => (
            <button key={emoji} type="button" onClick={() => apply(emoji)} className="rounded py-0.5 text-title hover:bg-accent/15 focus-visible:bg-accent/15">
              {emoji}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            apply(value);
          }}
        >
          <input
            autoFocus
            value={value}
            maxLength={16}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Or type any emoji (${currentPlatform() === 'win32' ? 'Win+.' : '⌃⌘Space'})`}
            aria-label="Emoji"
            className="h-7 min-w-0 flex-1 rounded-md border border-edge bg-bg px-2 text-ui outline-none focus:border-accent-ink/60"
          />
          <Button variant="quiet" iconOnly icon={<X size={13} aria-hidden />} onClick={onClose} aria-label="Cancel" />
        </form>
      </div>
    </Popover>
  );
}

/**
 * "Remove from Switchboard?" for a project, from the Projects view or a sidebar menu. Removing the
 * project the sidebar is filtered to shows all projects again.
 */
export function RemoveProjectDialog({ root, name, onClose }: { root: string; name: string; onClose(): void }) {
  const { remove } = useProjectActions();
  return (
    <ConfirmDialog
      title={`Remove ${name} from Switchboard?`}
      confirmLabel="Remove"
      body={<>It disappears from the sidebar and the New session view. The folder, its files and its sessions are not touched, and you can add it again later.</>}
      onConfirm={async () => {
        await remove(root);
        if (useProjects.getState().filter === root) useProjects.getState().setFilter(null);
      }}
      onClose={onClose}
    />
  );
}

/** Opens the Projects view, or one project's page on its Settings tab when given. */
export function manage(root: string | null = null): void {
  if (root) openProject(root, 'settings');
  else useSessions.getState().setView('projects');
}

/**
 * Menu entries to rename a project, change its icon or remove it, and the emoji picker, rename dialog and remove confirmation they open (`overlays`).
 * `remove: false` leaves out "Remove from Switchboard…", for menus about something else (a session); `identity: true`
 * keeps only what the project is (profile, icon, name, folder), for the icon button on a project's row and page;
 * `nested: true` puts the profile and icon choices in submenus, for a menu where the project is one of several things.
 */
export function useProjectIconEntries() {
  const actions = useProjectActions();
  const projects = useProjects((s) => s.projects);
  const questionsDir = useProjects((s) => s.questionsDir);
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = profiles.find((p) => p.isDefault);
  const openIn = useOpenIn();
  const [emojiFor, setEmojiFor] = useState<{ root: string; x: number; y: number } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const entries = (
    root: string,
    at: { x: number; y: number },
    { remove = true, identity = false, nested = false }: { remove?: boolean; identity?: boolean; nested?: boolean } = {},
  ): MenuEntry[] => {
    // Quick questions are not a project: no icon, name, profile or "Add to projects".
    if (isQuestionsFolder(root, questionsDir)) return [];
    const project = projects.get(root);
    const linked = project?.profileId ?? null;
    // The account new sessions here use.
    const profileChoices: MenuEntry[] = [
      {
        label: `Default${defaultProfile ? ` (${defaultProfile.name})` : ''}`,
        hint: linked === null ? '✓' : undefined,
        onSelect: () => void actions.setProfile(root, null),
      },
      ...profiles.map(
        (p): MenuEntry => ({ label: p.name, icon: <ProfileDot color={p.color} />, hint: linked === p.id ? '✓' : undefined, onSelect: () => void actions.setProfile(root, p.id) }),
      ),
    ];
    const iconChoices: MenuEntry[] = [
      { label: 'Choose image…', icon: <Image size={13} />, onSelect: () => void actions.chooseImage(root) },
      { label: 'Use emoji…', icon: <Smile size={13} />, onSelect: () => setEmojiFor({ root, ...at }) },
      { label: 'Use letter', icon: <Type size={13} />, onSelect: () => void actions.setIcon(root, { kind: 'none' }) },
      {
        label: 'Detect automatically',
        icon: <RotateCcw size={13} />,
        hint: project?.iconSource === 'detected' ? 'current' : undefined,
        onSelect: () => void actions.setIcon(root, { kind: 'auto' }),
      },
    ];
    // Only worth asking once there is more than one profile.
    const withProfile = profiles.length > 1 && isAbsolutePath(root);
    const linkedProfile = profiles.find((p) => p.id === linked) ?? defaultProfile;
    const choices: MenuEntry[] = nested
      ? [
          ...(withProfile
            ? [
                {
                  label: 'Claude profile',
                  icon: linkedProfile && <ProfileDot color={linkedProfile.color} />,
                  hint: linkedProfile?.name,
                  submenu: profileChoices,
                  data: { 'data-project-profile-menu': true },
                } satisfies MenuEntry,
              ]
            : []),
          { label: 'Project icon', icon: <Image size={13} />, submenu: iconChoices, data: { 'data-project-icon-menu': true } },
        ]
      : [...(withProfile ? [{ heading: 'Claude profile' }, ...profileChoices, 'separator' as const] : []), { heading: 'Project icon' }, ...iconChoices];
    return [
      ...choices,
      'separator',
      ...(isAbsolutePath(root) ? [{ label: 'Rename project…', icon: <Pencil size={13} />, onSelect: () => setRenaming(root), data: { 'data-rename-project': true } } satisfies MenuEntry] : []),
      { label: 'Open folder in editor', icon: <FolderOpen size={13} />, disabled: !project?.exists, onSelect: () => void openIn(root).catch(() => {}) },
      ...(identity
        ? []
        : project?.added
          ? ([
              { label: 'Open project', icon: <FolderCog size={13} />, onSelect: () => openProject(root), data: { 'data-open-project': true } },
              { label: 'Triggers…', icon: <Zap size={13} />, onSelect: () => openProject(root, 'triggers'), data: { 'data-open-triggers': true } },
              { label: 'Worktrees…', icon: <FolderGit2 size={13} />, disabled: !project.exists, onSelect: () => openProject(root, 'worktrees'), data: { 'data-open-worktrees': true } },
              { label: 'Branches…', icon: <GitBranch size={13} />, disabled: !project.exists, onSelect: () => openProject(root, 'branches'), data: { 'data-open-branches': true } },
              { label: 'Project settings…', icon: <SlidersHorizontal size={13} />, onSelect: () => manage(root) },
              ...(remove ? [{ label: 'Remove from Switchboard…', icon: <X size={13} />, danger: true, onSelect: () => setRemoving(root), data: { 'data-remove-project': true } }] : []),
            ] satisfies MenuEntry[])
          : isAbsolutePath(root)
            ? [{ label: 'Add to projects', icon: <FolderPlus size={13} />, disabled: !project?.exists, onSelect: () => void actions.add(root) } satisfies MenuEntry]
            : []),
    ];
  };

  // The emoji picker, the rename dialog and the remove confirmation; the caller renders them.
  const overlays = (
    <>
      {emojiFor && <EmojiPicker {...emojiFor} onClose={() => setEmojiFor(null)} />}
      {renaming && <RenameProjectDialog root={renaming} onClose={() => setRenaming(null)} />}
      {removing && <RemoveProjectDialog root={removing} name={projects.get(removing)?.name ?? removing} onClose={() => setRemoving(null)} />}
    </>
  );
  return { entries, overlays };
}

/** Filter-menu items in order, for ↑ ↓ Home End (the per-project ⋯ buttons are for the mouse; → opens the same menu). */
function filterItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[data-filter-item]')) : [];
}

/** "All projects ⌄": filter the list to one of your projects, add one, or manage them. */
/** A computer in "Show sessions from": this one or a paired one, with how many sessions it has and how many need you. */
export interface SourceSummary {
  source: string;
  label: string;
  total: number;
  waiting: number;
  /** A paired computer that isn't connected: its sessions are its last list. */
  offline: boolean;
  remote: boolean;
}

/** A project on another computer, as the filter lists it (its key stands in for a folder). */
export interface RemoteProjectSummary {
  key: string;
  name: string;
  computerName: string;
  offline: boolean;
}

export function ProjectFilter({ counts, sources = [], remoteProjects = [] }: { counts: Map<string, { total: number; active: number }>; sources?: readonly SourceSummary[]; remoteProjects?: readonly RemoteProjectSummary[] }) {
  const hidden = useComputers((s) => s.hidden);
  const projects = useProjects((s) => s.projects);
  const filter = useProjects((s) => s.filter);
  const setFilter = useProjects((s) => s.setFilter);
  const icons = useProjectIconEntries();
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [submenu, setSubmenu] = useState<{ root: string; x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const showAdd = useProjects((s) => s.showAdd);
  const cloneEnabled = useCloneEnabled();
  const sorted = addedProjects(projects);
  const current = filter ? projects.get(filter) : undefined;
  const remoteCurrent = filter ? remoteProjects.find((p) => p.key === filter) : undefined;
  const currentName = filter ? (remoteCurrent?.name ?? current?.name ?? filter) : 'All projects';
  const close = useCallback(() => setOpen(null), []);
  const choose = (action: () => void) => {
    setOpen(null);
    buttonRef.current?.focus();
    action();
  };
  /** Opens a project's icon and options menu beside its row. */
  const more = (root: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setSubmenu({ root, x: rect.right - 8, y: rect.top });
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = filterItems(event.currentTarget);
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') {
      event.preventDefault();
      choose(() => {});
      return;
    } else if (event.key === 'ArrowRight' || event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const root = (document.activeElement as HTMLElement | null)?.dataset.projectRoot;
      if (root) {
        event.preventDefault();
        more(root, document.activeElement as HTMLElement);
      }
      return;
    }
    if (next === null || items.length === 0) return;
    event.preventDefault();
    items[next]!.focus();
  };

  return (
    <div className="flex items-center gap-1 px-3 pb-2">
      <button
        ref={buttonRef}
        type="button"
        data-project-filter
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        aria-label={`Show sessions from: ${currentName}`}
        data-tooltip="Show one project’s sessions"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setOpen((current) => (current ? null : { x: rect.left, y: rect.bottom + 4 }));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            e.currentTarget.click();
          }
        }}
        className="no-drag flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-ui text-muted hover:bg-border/50 hover:text-text"
      >
        {filter ? <ProjectIcon project={current} root={filter} name={remoteCurrent?.name} remote={!!remoteCurrent} /> : <Layers size={14} className="shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{currentName}</span>
        {remoteCurrent && <ComputerChip name={remoteCurrent.computerName} offline={remoteCurrent.offline} />}
        <ChevronDown size={13} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <Button variant="quiet" iconOnly icon={<FolderPlus size={15} aria-hidden />} aria-label="Add a project" data-add-project onClick={() => showAdd(true)} className="no-drag" />

      {open && (
        <FilterPopover id={menuId} x={open.x} y={open.y} anchor={buttonRef} onClose={close} closeOnEscape={!submenu} onKeyDown={onMenuKeyDown}>
          {/* With a paired computer: which computers' sessions the list shows (the Computers strip's filter too). */}
          {sources.length > 1 && (
            <>
              <p role="none" className="px-3 pt-1.5 pb-1 text-meta font-semibold tracking-wide text-faint uppercase">
                Show sessions from
              </p>
              {sources.map((source) => (
                <SourceRow
                  key={source.source}
                  source={source}
                  checked={!hidden.has(source.source)}
                  onToggle={() => useComputers.getState().setHidden(toggleSource(hidden, source.source))}
                />
              ))}
              <div role="separator" className="mx-2 my-1 border-t border-edge" />
              <p role="none" className="px-3 pt-1 pb-1 text-meta font-semibold tracking-wide text-faint uppercase">
                Projects
              </p>
            </>
          )}
          <FilterRow selected={!filter} onSelect={() => choose(() => setFilter(null))} icon={<Layers size={14} aria-hidden />} label="All projects" />
          <div role="separator" className="mx-2 my-1 border-t border-edge" />
          {sorted.map((project) => (
            <FilterRow
              key={project.root}
              root={project.root}
              selected={filter === project.root}
              onSelect={() => choose(() => setFilter(project.root))}
              onMore={(el) => more(project.root, el)}
              icon={<ProjectIcon project={project} root={project.root} />}
              label={project.name}
              title={project.root}
              count={counts.get(project.root)?.total ?? 0}
            />
          ))}
          {remoteProjects.map((project) => (
            <FilterRow
              key={project.key}
              selected={filter === project.key}
              onSelect={() => choose(() => setFilter(project.key))}
              icon={<ProjectIcon project={undefined} root={project.key} name={project.name} remote />}
              label={project.name}
              chip={<ComputerChip name={project.computerName} offline={project.offline} />}
              count={counts.get(project.key)?.total ?? 0}
            />
          ))}
          {sorted.length === 0 && remoteProjects.length === 0 && (
            <p role="none" className="px-3 py-1.5 text-ui text-muted">
              No projects yet. Add the folders you work in.
            </p>
          )}
          <div role="separator" className="mx-2 my-1 border-t border-edge" />
          <FilterRow onSelect={() => choose(() => showAdd(true))} icon={<FolderPlus size={14} aria-hidden />} label="Add project…" />
          {cloneEnabled && <FilterRow onSelect={() => choose(() => useClone.getState().showDialog(true))} icon={<FolderDown size={14} aria-hidden />} label="Clone from GitHub…" />}
          <FilterRow onSelect={() => choose(() => manage())} icon={<FolderCog size={14} aria-hidden />} label="Manage projects…" />
        </FilterPopover>
      )}
      {submenu && (
        <Menu
          x={submenu.x}
          y={submenu.y}
          label={`${projects.get(submenu.root)?.name ?? submenu.root} options`}
          entries={icons.entries(submenu.root, submenu)}
          onClose={() => setSubmenu(null)}
        />
      )}
      {icons.overlays}
    </div>
  );
}

/**
 * The filter dropdown: a menu that focuses the current choice when it opens and hands focus back to
 * the filter button when it closes, like `Menu`, but with checked rows, counts and per-project options.
 */
function FilterPopover({
  id,
  x,
  y,
  anchor,
  onClose,
  closeOnEscape,
  onKeyDown,
  children,
}: {
  id: string;
  x: number;
  y: number;
  anchor: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  closeOnEscape: boolean;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  children: ReactNode;
}) {
  useEffect(() => {
    const menu = document.getElementById(id);
    const items = filterItems(menu);
    (items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body) anchor.current?.focus({ preventScroll: true });
    };
  }, [id, anchor]);

  return (
    <Popover id={id} x={x} y={y} width={256} anchor={anchor} onClose={onClose} closeOnEscape={closeOnEscape} role="menu" aria-label="Show sessions from" onKeyDown={onKeyDown} data-project-filter-menu>
      {children}
    </Popover>
  );
}

/** A checkbox row in "Show sessions from": a computer, ticked while its sessions are listed. */
function SourceRow({ source, checked, onToggle }: { source: SourceSummary; checked: boolean; onToggle(): void }) {
  const detail = source.offline ? `offline · ${source.total}` : source.waiting > 0 ? `${source.total} · ${source.waiting} ${source.waiting === 1 ? 'needs' : 'need'} you` : `${source.total} ${source.total === 1 ? 'session' : 'sessions'}`;
  return (
    <div role="none" className="flex items-center pr-1 hover:bg-accent/10 focus-within:bg-accent/10">
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={checked}
        tabIndex={-1}
        data-filter-item
        data-computer-source={source.source}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-ui outline-none"
      >
        <span className="w-3 shrink-0" aria-hidden>
          {checked && <Check size={12} className="text-accent-ink" />}
        </span>
        <Monitor size={13} aria-hidden className={`shrink-0 ${source.remote && !source.offline ? 'text-remote' : 'text-muted'}`} />
        <span className={`min-w-0 flex-1 truncate ${source.offline ? 'text-muted' : ''}`}>{source.label}</span>
        <span className="shrink-0 text-meta text-muted tabular-nums">{detail}</span>
      </button>
    </div>
  );
}

function FilterRow(props: { selected?: boolean; root?: string; onSelect(): void; onMore?(el: HTMLElement): void; icon: ReactNode; label: string; title?: string; count?: number; chip?: ReactNode }) {
  const radio = props.selected !== undefined;
  return (
    <div role="none" className="group flex items-center pr-1 hover:bg-accent/10 focus-within:bg-accent/10" data-tooltip={props.title}>
      <button
        type="button"
        role={radio ? 'menuitemradio' : 'menuitem'}
        aria-checked={radio ? props.selected : undefined}
        tabIndex={-1}
        data-filter-item
        data-project-root={props.onMore ? props.root : undefined}
        onClick={props.onSelect}
        onContextMenu={
          props.onMore
            ? (e) => {
                e.preventDefault();
                props.onMore!(e.currentTarget);
              }
            : undefined
        }
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-ui outline-none"
      >
        {props.icon}
        <span className={`min-w-0 truncate ${props.chip ? '' : 'flex-1'}`}>{props.label}</span>
        {props.chip && <span className="flex min-w-0 flex-1">{props.chip}</span>}
        {props.count !== undefined && (
          <span className="text-meta text-muted tabular-nums">
            {props.count}
            <span className="sr-only">{props.count === 1 ? ' session' : ' sessions'}</span>
          </span>
        )}
        <span className="w-3" aria-hidden>
          {props.selected && <Check size={12} className="text-accent-ink" />}
        </span>
      </button>
      {props.onMore && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => props.onMore!(e.currentTarget)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-text"
          aria-label={`Options for ${props.label}`}
          data-tooltip="Name, icon and options (→)"
          data-project-more={props.root}
        >
          <Ellipsis size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
