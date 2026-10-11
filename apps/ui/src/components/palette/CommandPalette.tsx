import { GitBranchPlus, PencilLine, Search, SquarePen } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FOCUS_LIMIT_MAX, FOCUS_LIMIT_MIN } from '@switchboard/protocol/bridge';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename, guessHome, shortAge, tildify } from '../../lib/format.ts';
import { fuzzyMatch } from '../../lib/fuzzy.ts';
import { findModelOption } from '../../lib/models.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { startQueued } from '../../state/laterStore.ts';
import { useQueue } from '../../state/useQueue.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { formatKeys, keysFor, shortcutById } from '../../lib/shortcuts.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { openProject } from '../../state/projectPageStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { GROUP_LABEL, inScope } from '../../state/sidebarRows.ts';
import { toast } from '../../state/toastStore.ts';
import { rememberLimit } from '../focus/focusLimit.ts';
import { activityByProject, latestBranches, orderProjects, tileStatus } from '../newSession/projectTiles.ts';
import { EFFORT_LABEL, EFFORTS, MODE_DESCRIPTION } from '../newSession/route.ts';
import { useMemoryList } from '../memory/useMemoryList.ts';
import { useOpenIn } from '../OpenInButton.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { arrangeCommands, hintOf, recentCommands, rememberCommand, visibleCommands, type CommandSection, type PaletteCommand } from './commands.ts';
import { gotoWithDrafts, matchProjects, matchSessions } from './gotoItems.ts';
import { openDraft, useUnsent, type UnsentEntry } from '../drafts/useUnsent.ts';
import { createPaletteApi } from './paletteApi.ts';
import type { PaletteContext } from './paletteContext.ts';
import { PaletteFooter, type FooterKey } from './PaletteFooter.tsx';
import { CommandRow, DraftRow, FolderRow, HelpRow, OptionRow, ProjectRow, SessionRow } from './PaletteRows.tsx';
import { back, changeProject, currentStep, initialState, PREFIXES, pushStep, switchMode, typeQuery, type PaletteMode, type PaletteState, type PaletteStep, type PickList } from './paletteState.ts';
import { PromptStep } from './PromptStep.tsx';
import { usePaletteContext } from './usePaletteContext.ts';

/** A row in the list. Rows of a step's own list carry a ⌘1 to ⌘9 number. */
type Row =
  | { kind: 'command'; key: string; command: PaletteCommand; title: string; indices: number[] }
  | { kind: 'session'; key: string; data: SessionRowData; indices: number[]; draft: boolean }
  | { kind: 'draft'; key: string; entry: UnsentEntry }
  | { kind: 'project'; key: string; root: string; indices: number[]; number: number | null; compact: boolean }
  | { kind: 'folder'; key: string }
  | { kind: 'option'; key: string; value: string; title: string; detail?: string; dot?: string; current: boolean; indices: number[]; number: number | null }
  | { kind: 'help'; key: string; mode: PaletteMode; prefix: string; title: string; detail: string; sheet?: boolean };

interface Section {
  id: string;
  label: string;
  /** Before the label (the Unsent group's pen). */
  icon?: ReactNode;
  tone?: 'neutral' | 'needs-you' | 'working';
  rows: Row[];
}

/** An option of a pick step, before matching what is typed. */
interface Option {
  value: string;
  title: string;
  detail?: string;
  dot?: string;
  current?: boolean;
}

/** Sessions and projects shown in go-to with nothing typed. */
const GOTO_SESSIONS = 24;
const GOTO_PROJECTS = 5;
/** Matches shown at most once something is typed. */
const MATCH_LIMIT = 50;

const PLACEHOLDER: Record<PaletteMode, string> = {
  goto: 'Go to a session or project',
  commands: 'Type a command',
  new: 'Pick a project',
  actions: 'Run a project action',
  help: 'Pick what to list',
};
const PICK_PLACEHOLDER: Record<PickList, string> = {
  model: 'Pick a model',
  effort: 'Pick an effort',
  mode: 'Pick a permission mode',
  fork: 'Fork from where',
  rewind: 'Undo file changes since which message',
  'focus-limit': 'How many sessions at once',
  queue: 'Pick a queued prompt to start',
  memory: 'Pick a memory to share',
};
/** What a command that asks for more shows next, on its row while it's highlighted. */
const NEXT_HINT: Record<PaletteStep['kind'], string> = { projects: 'picks a project next', prompt: 'write the prompt next', pick: 'pick one next' };

const HELP: Array<{ mode: PaletteMode; prefix: string; title: string; detail: string }> = [
  { mode: 'goto', prefix: '', title: 'Go to a session or project', detail: `no prefix · ${formatKeys(keysFor('palette.goto'))}` },
  { mode: 'commands', prefix: PREFIXES.commands, title: 'Commands', detail: shortcutById('palette.commands').keys.map(formatKeys).join(' or ') },
  { mode: 'new', prefix: PREFIXES.new, title: 'New session in a project', detail: 'picks a project' },
  { mode: 'actions', prefix: PREFIXES.actions, title: 'Project actions of this session', detail: 'runs one' },
  { mode: 'help', prefix: PREFIXES.help, title: 'Help', detail: 'this list' },
];

/** The project whose prompt moves to the one picked next, after "change project". */
const fromOf = (state: PaletteState) => {
  const step = currentStep(state);
  return step?.kind === 'projects' ? step.from : undefined;
};

const firstLine = (text: string) => text.trim().split('\n')[0]!.slice(0, 140) || '(no text)';

/**
 * The command palette. ⌘K and ⌘⇧P open its commands (">"), ⌘P go-to (sessions, then projects).
 * Typing a prefix switches mode: ">" commands, "+" new session, "!" project actions, "?" help. A
 * command that needs more input becomes a chip in the field and shows its next step; ⌫ in an empty
 * field goes back a step, Esc closes. New session ends in a small New session form (`PromptStep`).
 */
export function CommandPalette() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const close = useOverlay((s) => s.close);
  const request = useOverlay((s) => s.palette);
  const [state, setState] = useState<PaletteState>(() => initialState(request.mode));
  const opened = useRef(request.nonce);
  // ⌘P while the commands are open (or the other way round) switches mode in place.
  useEffect(() => {
    if (opened.current === request.nonce) return;
    opened.current = request.nonce;
    setState(initialState(request.mode));
  }, [request]);

  const ctx = usePaletteContext();
  const openIn = useOpenIn();
  const api = useMemo(() => createPaletteApi(ctx, client, openIn), [ctx, client, openIn]);
  const step = currentStep(state);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  // What the rows are made of.
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const models = useHosts((s) => s.models);
  const projects = useProjects((s) => s.projects);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const projectOrder = usePreferences((s) => s.prefs.projectOrder);
  const focusLimit = usePreferences((s) => s.prefs.focusLimit);
  const queue = useQueue();
  // The current project's memories, read when the Share memory step shows.
  const memoryRoot = step?.kind === 'pick' && step.list === 'memory' ? (ctx.currentProject?.root ?? null) : null;
  const { list: memoryList } = useMemoryList(memoryRoot);
  const unsent = useUnsent();
  const digest = usePaletteBus((s) => s.digest);
  const home = useMemo(() => guessHome(projects.keys()), [projects]);
  const nameOf = (root: string) => projects.get(root)?.name ?? basename(root);
  const sessionRows = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const activity = useMemo(() => activityByProject(sessionRows), [sessionRows]);
  const branches = useMemo(() => latestBranches(sessions.values()), [sessions]);
  const projectRoots = useMemo(() => {
    const roots = addedProjects(projects)
      .filter((p) => p.exists)
      .map((p) => p.root);
    return orderProjects(roots, projectOrder, (root) => Math.max(projects.get(root)?.lastActivity ?? 0, activity.get(root)?.lastActivity ?? 0) || null);
  }, [projects, projectOrder, activity]);

  const sections = useMemo<Section[]>(() => {
    const query = state.query;
    if (step?.kind === 'prompt') return [];
    if (step?.kind === 'projects') return projectSections(step, query);
    if (step?.kind === 'pick') return pickSections(step.list, query);
    switch (state.mode) {
      case 'goto':
        return gotoSections(query);
      case 'help':
        return [
          { id: 'help', label: 'Prefixes', rows: HELP.map((h) => ({ kind: 'help', key: `help:${h.mode}`, ...h })) },
          // Every shortcut is on the sheet (⌘/), not here.
          { id: 'help-keys', label: 'Keys', rows: [{ kind: 'help', key: 'help:shortcuts', mode: 'help', prefix: '', title: 'Keyboard shortcuts', detail: formatKeys(keysFor('shortcuts')), sheet: true }] },
        ];
      case 'actions':
        return commandSections(arrangeCommands(visibleCommands(ctx).filter((c) => c.group === 'actions'), ctx, [], query));
      default:
        return commandSections(arrangeCommands(visibleCommands(ctx), ctx, recentCommands(), query));
    }

    function commandSections(arranged: CommandSection[]): Section[] {
      return arranged.map((section) => ({
        id: section.id,
        label: section.label,
        rows: section.items.map(({ command, title, indices }) => ({ kind: 'command', key: `command:${command.id}`, command, title, indices })),
      }));
    }

    function gotoSections(query: string): Section[] {
      const out: Section[] = [];
      const drafted = new Set(unsent.flatMap((e) => (e.item.kind === 'session' ? [e.item.sessionId] : [])));
      if (query.trim()) {
        const found = matchSessions(sessionRows, query, nameOf, MATCH_LIMIT);
        if (found.length) out.push({ id: 'sessions', label: 'Sessions', rows: found.map(({ item, indices }) => ({ kind: 'session', key: `session:${item.id}`, data: item, indices, draft: drafted.has(item.id) })) });
      } else {
        // Nothing typed: unsent messages first, then the sidebar's groups in its order, so ⌘P stands in for it while it's closed.
        const { unsent: unsentItems, groups } = gotoWithDrafts(sessionRows, unsent.map((e) => e.item), Date.now(), GOTO_SESSIONS);
        const entries = new Map(unsent.map((e) => [e.item.key, e]));
        if (unsentItems.length) {
          out.push({
            id: 'unsent',
            label: 'Unsent',
            icon: <PencilLine size={11} aria-hidden />,
            rows: unsentItems.map((item) => ({ kind: 'draft', key: `draft:${item.key}`, entry: entries.get(item.key)! })),
          });
        }
        for (const { group, rows: inGroup } of groups) {
          out.push({
            id: `sessions-${group}`,
            label: GROUP_LABEL[group],
            tone: group === 'needs-you' || group === 'working' ? group : 'neutral',
            rows: inGroup.map((item) => ({ kind: 'session', key: `session:${item.id}`, data: item, indices: [], draft: drafted.has(item.id) })),
          });
        }
      }
      const roots = matchProjects(projectRoots, query, nameOf).slice(0, query.trim() ? MATCH_LIMIT : GOTO_PROJECTS);
      if (roots.length) out.push({ id: 'projects', label: 'Projects', rows: roots.map(({ item, indices }) => ({ kind: 'project', key: `project:${item}`, root: item, indices, number: null, compact: true })) });
      return out;
    }

    function projectSections(projectStep: Extract<PaletteStep, { kind: 'projects' }>, query: string): Section[] {
      const roots = matchProjects(projectRoots, query, nameOf).slice(0, MATCH_LIMIT);
      const rows: Row[] = roots.map(({ item, indices }, i) => ({ kind: 'project', key: `project:${item}`, root: item, indices, number: i < 9 ? i + 1 : null, compact: false }));
      // Any folder can start a session; renaming is for projects only.
      if (projectStep.purpose === 'new-session' && (!query.trim() || fuzzyMatch(query, 'Choose another folder'))) rows.push({ kind: 'folder', key: 'folder' });
      return rows.length ? [{ id: 'projects', label: query.trim() ? 'Projects' : projectOrder === 'yours' ? 'Your projects' : 'Recent projects', rows }] : [];
    }

    function pickSections(list: PickList, query: string): Section[] {
      const options = pickOptions(list);
      const rows = options
        .flatMap((option) => {
          const match = fuzzyMatch(query, option.title);
          return match ? [{ option, score: match.score, indices: match.indices }] : [];
        })
        .sort((a, b) => (query.trim() ? b.score - a.score : 0))
        .slice(0, MATCH_LIMIT)
        .map(({ option, indices }, i): Row => ({ kind: 'option', key: `option:${option.value}`, ...option, current: option.current ?? false, indices, number: i < 9 ? i + 1 : null }));
      return rows.length ? [{ id: list, label: PICK_PLACEHOLDER[list].replace(/^Pick (a |an )?/, ''), rows }] : [];
    }
    // The pick lists and project rows read these; the functions above are only called from here.
  }, [state, step, ctx, sessionRows, projectRoots, projectOrder, projects, models, hosts, focusLimit, queue, digest, unsent, memoryList]);

  /** The choices of a pick step, the current one marked. */
  function pickOptions(list: PickList): Option[] {
    const host = ctx.session ? hosts.get(ctx.session.id) : undefined;
    switch (list) {
      case 'model': {
        const current = findModelOption(models, host?.model)?.value;
        return models.map((m) => ({ value: m.value, title: m.displayName, detail: m.description, current: m.value === current }));
      }
      case 'effort':
        return [
          { value: '', title: 'Default', detail: 'What Claude Code would pick', current: !host?.effort },
          ...EFFORTS.map((e) => ({ value: e, title: EFFORT_LABEL[e], current: host?.effort === e })),
        ];
      case 'mode': {
        const current = host?.permissionMode ?? 'default';
        return [...new Set([...MODE_CHOICES, current])].map((m) => ({ value: m, title: MODE_LABEL[m], detail: MODE_DESCRIPTION[m], dot: MODE_DOT[m] ?? 'bg-faint', current: m === current }));
      }
      case 'fork': {
        if (!digest || digest.sessionId !== ctx.session?.id) return [];
        const whole: Option[] = digest.lastUuid ? [{ value: digest.lastUuid, title: 'The whole conversation', detail: 'Up to the latest message' }] : [];
        const before = [...digest.prompts].reverse().flatMap((p) => (p.before ? [{ value: p.before, title: firstLine(p.text), detail: `Just before this message${p.at ? ` · ${shortAge(p.at)}` : ''}` }] : []));
        return [...whole, ...before];
      }
      case 'rewind':
        if (!digest || digest.sessionId !== ctx.session?.id) return [];
        return [...digest.prompts].reverse().map((p) => ({ value: p.uuid, title: firstLine(p.text), detail: p.at ? shortAge(p.at) : undefined }));
      case 'focus-limit':
        return Array.from({ length: FOCUS_LIMIT_MAX - FOCUS_LIMIT_MIN + 1 }, (_, i) => FOCUS_LIMIT_MIN + i).map((n) => ({
          value: String(n),
          title: n === 1 ? '1 session' : `${n} sessions`,
          current: focusLimit === n,
        }));
      case 'queue':
        // In queue order, each with its state: ready ones in green, waiting ones with what they wait for.
        return queue.entries.map(({ item, state, label }) => ({
          value: item.id,
          title: firstLine(item.prompt),
          detail: [nameOf(item.cwd), state === 'queued' ? `queued ${shortAge(item.createdAt)}` : state === 'ready' ? `Ready · ${label}` : label].filter(Boolean).join(' · '),
          dot: state === 'ready' ? 'bg-ok' : state === 'waiting' ? 'bg-faint' : undefined,
        }));
      case 'memory':
        return (memoryList?.memories ?? []).map((m) => ({ value: m.path, title: m.name, detail: [m.type, m.description].filter(Boolean).join(' · ') || undefined }));
    }
  }

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  useEffect(() => setActive(0), [state.query, state.mode, state.steps.length]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  // Back in the field after a step changes (the prompt step has its own).
  useEffect(() => {
    if (step?.kind !== 'prompt') inputRef.current?.focus();
  }, [state.steps.length, state.mode, step?.kind]);

  const chooseFolder = async (worktree: boolean) => {
    const picked = await window.switchboard?.pickFolder();
    if (picked) setState((s) => pushStep(s, { kind: 'prompt', root: picked, worktree, chip: s.steps[0]?.chip ?? 'New session', from: fromOf(s) }));
  };

  const pick = (list: PickList, value: string) => {
    const sessionId = ctx.session?.id;
    // The palette has closed by then, so a failure is said in a toast.
    const run = (what: string, call: () => Promise<unknown>) => void call().catch((e: Error) => toast(`Couldn't ${what}: ${e.message}`));
    close();
    switch (list) {
      case 'model':
        if (client && sessionId) run('change the model', () => client.call('session.setModel', { sessionId, model: value || null }));
        return;
      case 'effort':
        if (client && sessionId) run('change the effort', () => client.call('session.setEffort', { sessionId, effort: (value || null) as (typeof EFFORTS)[number] | null }));
        return;
      case 'mode':
        if (client && sessionId) run('change the permission mode', () => client.call('session.setPermissionMode', { sessionId, mode: value as (typeof MODE_CHOICES)[number] }));
        return;
      case 'fork':
        if (client && sessionId) run('fork the session', () => client.call('session.forkAt', { sessionId, messageUuid: value }).then((r) => useSessions.getState().select(r.sessionId)));
        return;
      case 'rewind':
        usePaletteBus.getState().requestSession('rewind', value);
        return;
      case 'focus-limit':
        rememberLimit(Number(value));
        usePreferences.getState().update({ focusLimit: Number(value) });
        return;
      case 'queue': {
        const entry = queue.entries.find((e) => e.item.id === value);
        if (entry) void startQueued(entry.item);
        return;
      }
      case 'memory': {
        const memory = memoryList?.memories.find((m) => m.path === value);
        if (memory && ctx.currentProject) usePaletteBus.getState().showDialog({ kind: 'share-memory', root: ctx.currentProject.root, memoryPath: memory.path, name: memory.name });
        return;
      }
    }
  };

  const choose = (row: Row | undefined, alt: boolean) => {
    if (!row) return;
    switch (row.kind) {
      case 'command': {
        const { command } = row;
        rememberCommand(command.id);
        if (command.mode) return setState(switchMode(command.mode));
        if (command.next) {
          const next = command.next(ctx);
          return setState((s) => pushStep(s, next));
        }
        close();
        command.run?.(api, ctx);
        return;
      }
      case 'session':
        close();
        if (alt) useSessions.getState().openBeside(row.data.id);
        else useSessions.getState().select(row.data.id);
        return;
      case 'draft':
        close();
        openDraft(row.entry.item);
        return;
      case 'project': {
        if (step?.kind === 'projects' && step.purpose === 'rename-project') {
          close();
          usePaletteBus.getState().showDialog({ kind: 'rename-project', root: row.root });
          return;
        }
        if (step?.kind === 'projects' && (step.purpose === 'worktrees' || step.purpose === 'branches')) {
          close();
          openProject(row.root, step.purpose);
          return;
        }
        const worktree = alt || (step?.kind === 'projects' && step.worktree);
        return setState((s) => pushStep(s, { kind: 'prompt', root: row.root, worktree, chip: s.steps[0]?.chip ?? 'New session', from: fromOf(s) }));
      }
      case 'folder':
        return void chooseFolder(alt || (step?.kind === 'projects' && step.worktree));
      case 'option':
        if (step?.kind === 'pick') pick(step.list, row.value);
        return;
      case 'help':
        if (row.sheet) return useOverlay.getState().show('shortcuts');
        return setState(switchMode(row.mode));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    // Keys the palette takes don't also reach the window's shortcuts (⌘O opens the editor, ⌘1 picks a folder in New session).
    const take = () => (event.preventDefault(), event.stopPropagation());
    if (event.key === 'ArrowDown') (take(), setActive((i) => (rows.length ? (i + 1) % rows.length : 0)));
    else if (event.key === 'ArrowUp') (take(), setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0)));
    else if (event.key === 'Enter') (take(), choose(rows[active], event.altKey));
    else if (event.key === 'Backspace' && state.query === '' && !event.metaKey) {
      const previous = back(state);
      if (previous) (take(), setState(previous));
    } else if (event.metaKey && /^[1-9]$/.test(event.key) && (step?.kind === 'projects' || step?.kind === 'pick')) {
      const row = rows.find((r) => (r.kind === 'project' || r.kind === 'option') && r.number === Number(event.key));
      if (row) (take(), choose(row, event.altKey));
    } else if (event.metaKey && event.key.toLowerCase() === 'o' && step?.kind === 'projects' && step.purpose === 'new-session') (take(), void chooseFolder(event.altKey || step.worktree));
  };

  const wide = step?.kind === 'prompt';
  return (
    <Dialog
      bare
      flush
      placement="top"
      width={wide ? 'palette-wide' : 'palette'}
      title="Command palette"
      onClose={close}
      data-command-palette
      data-palette-mode={state.mode}
      data-palette-step={step?.kind}
    >
      {step?.kind === 'prompt' ? (
        <PromptStep
          key={`${step.root}:${step.worktree}`}
          root={step.root}
          from={step.from}
          worktree={step.worktree}
          chip={step.chip}
          onBack={() => setState((s) => back(s) ?? s)}
          onChangeProject={() => setState(changeProject)}
          onDone={close}
        />
      ) : (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
            <FieldStart state={state} />
            {/* A combobox: focus stays in the field while ↑ ↓ move the highlighted row. */}
            <input
              ref={inputRef}
              autoFocus
              role="combobox"
              aria-expanded={rows.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={rows[active] ? optionId(active) : undefined}
              aria-label={step ? `${step.chip}: ${step.kind === 'pick' ? PICK_PLACEHOLDER[step.list] : 'Pick a project'}` : PLACEHOLDER[state.mode]}
              value={state.query}
              onChange={(e) => setState((s) => typeQuery(s, e.target.value))}
              onKeyDown={onKeyDown}
              placeholder={step?.kind === 'pick' ? PICK_PLACEHOLDER[step.list] : step ? 'Pick a project' : PLACEHOLDER[state.mode]}
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-faint"
              data-palette-input
            />
            {!step && <Kbd shortcut={state.mode === 'goto' ? 'palette.goto' : 'palette.commands'} />}
          </div>
          {rows.length === 0 && <Empty state={state} ctx={ctx} />}
          <div ref={listRef} id={listId} role="listbox" aria-label="Results" className={`min-h-0 flex-1 overflow-y-auto ${rows.length ? 'pb-1.5' : ''}`}>
            {(() => {
              let index = -1;
              return sections.map((section) => (
                <div key={section.id} role="group" aria-label={section.label} data-palette-group={section.id}>
                  <SectionHeader aria-hidden tone={section.tone} className="px-4 pt-2.5 pb-1">
                    {section.icon}
                    {section.label}
                  </SectionHeader>
                  {section.rows.map((row) => {
                    index += 1;
                    const i = index;
                    return <RowView key={row.key} row={row} id={optionId(i)} active={i === active} onHover={() => setActive(i)} onChoose={(alt) => choose(row, alt)} ctx={ctx} home={home} nameOf={nameOf} projectsMap={projects} activity={activity} branches={branches} />;
                  })}
                </div>
              ));
            })()}
          </div>
          <p className="sr-only" aria-live="polite">
            {state.query.trim() ? (rows.length === 0 ? 'No results' : `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`) : ''}
          </p>
          <PaletteFooter keys={footerKeys(state)} />
        </>
      )}
    </Dialog>
  );
}

/** Before the field: the mode's prefix (or a search glyph for go-to), or the chips of the steps taken so far. */
function FieldStart({ state }: { state: PaletteState }) {
  if (state.steps.length > 0) {
    return (
      <span className="flex shrink-0 items-center gap-1.5" data-palette-chips>
        {state.steps.map((s, i) => (
          <Pill key={i} icon={s.kind === 'projects' && s.worktree ? <GitBranchPlus size={12} aria-hidden /> : s.kind === 'projects' ? <SquarePen size={12} aria-hidden /> : undefined}>
            {s.chip}
          </Pill>
        ))}
      </span>
    );
  }
  if (state.mode === 'goto') return <Search size={15} className="shrink-0 text-muted" aria-hidden />;
  return (
    <span aria-hidden className="w-3 shrink-0 font-mono text-body font-semibold text-accent-ink" data-palette-prefix>
      {PREFIXES[state.mode]}
    </span>
  );
}

function Empty({ state, ctx }: { state: PaletteState; ctx: PaletteContext }) {
  const step = currentStep(state);
  const typed = state.query.trim();
  const [line, hint]: [string, string] =
    step?.kind === 'projects'
      ? typed
        ? [`No projects match “${typed}”.`, 'Add the folder as a project, or choose it with ⌘O.']
        : ['No projects yet.', 'Add one from Manage projects.']
      : step?.kind === 'pick'
        ? [typed ? `Nothing matches “${typed}”.` : 'Nothing to pick from here.', '⌫ goes back.']
        : state.mode === 'actions'
          ? [ctx.session ? 'This session’s project has no actions.' : 'Open a session to run its project actions.', '"!" lists them; ⌫ goes back.']
          : state.mode === 'goto'
            ? [`No sessions or projects match “${typed}”.`, `Type ">" for commands, or search inside conversations with ${formatKeys(keysFor('search'))}.`]
            : [`No commands match “${typed}”.`, 'Try fewer letters, or ⌫ to go to sessions.'];
  return (
    <div className="grid gap-1 px-4 py-6 text-center text-ui" data-palette-empty>
      <p className="text-text">{line}</p>
      <p className="text-muted">{hint}</p>
    </div>
  );
}

function footerKeys(state: PaletteState): FooterKey[] {
  const step = currentStep(state);
  const backTo = state.steps.length > 1 ? 'back' : state.mode === 'commands' ? 'back to commands' : 'back';
  if (step?.kind === 'projects') {
    const keys: FooterKey[] = [{ keys: '↩', label: 'pick' }];
    if (step.purpose === 'new-session' && !step.worktree) keys.push({ keys: '⌥↩', label: 'pick, in a worktree' });
    return [...keys, { keys: '⌫', label: backTo }, { keys: 'Esc', label: 'close' }];
  }
  if (step?.kind === 'pick') return [{ keys: '↑ ↓', label: 'move' }, { keys: '↩', label: 'choose' }, { keys: '⌫', label: backTo }, { keys: 'Esc', label: 'close' }];
  if (state.mode === 'goto') {
    return [
      { keys: PREFIXES.commands, label: 'commands', prefix: true },
      { keys: PREFIXES.new, label: 'new session', prefix: true },
      { keys: PREFIXES.actions, label: 'project actions', prefix: true },
      { keys: PREFIXES.help, label: 'help', prefix: true },
      { keys: '⌥↩', label: 'open beside' },
    ];
  }
  return [{ keys: '↑ ↓', label: 'move' }, { keys: '↩', label: 'choose' }, { keys: 'Esc', label: 'close' }];
}

/** One row, drawn by its kind. */
function RowView({
  row,
  id,
  active,
  onHover,
  onChoose,
  ctx,
  home,
  nameOf,
  projectsMap,
  activity,
  branches,
}: {
  row: Row;
  id: string;
  active: boolean;
  onHover(): void;
  onChoose(alt: boolean): void;
  ctx: PaletteContext;
  home: string | null;
  nameOf(root: string): string;
  projectsMap: ReturnType<typeof useProjects.getState>['projects'];
  activity: ReturnType<typeof activityByProject>;
  branches: Map<string, string | null>;
}): ReactNode {
  const common = { id, active, onHover, onChoose };
  switch (row.kind) {
    case 'command': {
      const { command } = row;
      const next = command.next ? command.next(ctx) : null;
      return (
        <CommandRow
          {...common}
          commandId={command.id}
          icon={command.icon}
          title={row.title}
          indices={row.indices}
          shortcut={command.shortcut}
          hint={hintOf(command, ctx) || (active && next ? NEXT_HINT[next.kind] : undefined)}
          hintTone={command.hintTone}
          next={next !== null || command.mode !== undefined}
        />
      );
    }
    case 'session':
      return <SessionRow {...common} data={row.data} project={projectsMap.get(row.data.projectRoot)} projectName={nameOf(row.data.projectRoot)} indices={row.indices} draft={row.draft} />;
    case 'draft':
      return <DraftRow {...common} entry={row.entry} />;
    case 'project':
      return (
        <ProjectRow
          {...common}
          root={row.root}
          project={projectsMap.get(row.root)}
          name={nameOf(row.root)}
          indices={row.indices}
          branch={branches.get(row.root) ?? null}
          path={tildify(row.root, home)}
          status={row.compact ? null : tileStatus(activity.get(row.root), projectsMap.get(row.root)?.lastActivity ?? null, Date.now())}
          number={row.number}
          compact={row.compact}
        />
      );
    case 'folder':
      return <FolderRow {...common} />;
    case 'option':
      return <OptionRow {...common} value={row.value} title={row.title} indices={row.indices} detail={row.detail} dot={row.dot} current={row.current} number={row.number} />;
    case 'help':
      return <HelpRow {...common} prefix={row.prefix} title={row.title} detail={row.detail} hook={row.sheet ? 'shortcuts' : undefined} />;
  }
}
