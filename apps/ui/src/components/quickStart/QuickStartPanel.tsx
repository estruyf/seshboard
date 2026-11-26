import { AppWindow, ArrowLeft, Camera, GitBranch, History, Inbox, LoaderCircle, Search, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { PROVIDER_NAMES } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { effectiveModel, modelChoices, modelLabel } from '../../lib/autoModel.ts';
import { fuzzyScore } from '../../lib/fuzzy.ts';
import { nextMode } from '../../lib/modes.ts';
import { currentPlatform } from '../../lib/platform.ts';
import { QUESTION_LABEL } from '../../lib/questions.ts';
import { matches, type ShortcutId } from '../../lib/shortcuts.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { addToQueue } from '../../state/laterStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useStartableProfiles } from '../../state/providersStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSignIn } from '../../state/signInStore.ts';
import { useListedRows, useProjectName } from '../../state/useQueue.ts';
import { AttachmentThumbs } from '../composer/Attachments.tsx';
import { AutoWand, ComposerChipRow } from '../composer/ComposerChips.tsx';
import { mergeAttachments } from '../composer/images.ts';
import { screenshotOutcome } from '../composer/screenshot.ts';
import { useAttachments } from '../composer/useAttachments.ts';
import { useMinute } from '../focus/useMinute.ts';
import { menuBarRows } from '../menuBar/menuBarModel.ts';
import { ChoiceMenu } from '../newSession/ChoiceMenu.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { tileOf } from '../theme/AppIconSettings.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { WorkingPanel } from '../ui/WorkingPanel.tsx';
import {
  backspaceAtStart,
  escapeStep,
  changedOptions,
  EMPTY_FIELD,
  firstActive,
  lastSession,
  LIST_TITLES,
  quickListSection,
  firstLine,
  moveActive,
  optionsSource,
  pickProject,
  QUESTION_ROW,
  quickActions,
  quickStartSections,
  startProblem,
  tokenLabel,
  whereLabel,
  type QuickAction,
  type QuickField,
  type QuickList,
  type QuickOptions,
  type QuickRow,
  type StartProblem,
} from './quickStartModel.ts';
import { projectProfile, quickSetup, startQuickSession, type QuickSetup } from './quickStartSession.ts';
import { useQuickProjects } from './useQuickProjects.ts';

const bridge = () => window.seshboard;
/** How long the confirmation stays before the panel closes by itself. */
const CONFIRM_MS = 2_000;
const CHIP_NAMES = { profile: 'quick-start-profile', model: 'quick-start-model', effort: 'quick-start-effort', mode: 'quick-start-mode' };
/** What counts as the panel for clicks: the panel and anything it opens (chip menus, ⌘K, dialogs, tooltips). */
const SURFACE = '[data-quick-start-surface], [data-menu], [role=menu], [role=listbox], [role=dialog], [role=alertdialog], [data-toast]';

/** A key as `matches` reads it, from the page or handed over by main (a key the app menu would have taken). */
interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target?: EventTarget | null;
  preventDefault(): void;
}

type Done = { kind: 'started' | 'later'; sessionId: string | null; name: string; task: string };

/** The ⌘K menu's actions, in the order the design lists them. */
const ACTIONS: { id: string; label: string; shortcut: ShortcutId }[] = [
  { id: 'start-open', label: 'Start and open', shortcut: 'quickstart.start-open' },
  { id: 'worktree', label: 'Start in a new worktree', shortcut: 'quickstart.worktree' },
  { id: 'model', label: 'Change model…', shortcut: 'quickstart.model' },
  { id: 'mode', label: 'Change mode…', shortcut: 'quickstart.mode' },
  { id: 'profile', label: 'Change profile…', shortcut: 'quickstart.profile' },
  { id: 'paste', label: 'Attach the clipboard', shortcut: 'quickstart.paste' },
  { id: 'screenshot', label: 'Take a screenshot', shortcut: 'quickstart.screenshot' },
  { id: 'clear-images', label: 'Remove all images', shortcut: 'quickstart.clear-images' },
  { id: 'later', label: 'Add to Later instead', shortcut: 'quickstart.later' },
];

/**
 * The quick start panel (its own see-through window, `QuickStartApp`), which the global shortcut opens over any app:
 * what needs you, then your projects (⌘1–⌘9). Picking one makes it a token in the field, which then takes the task,
 * with the project's options under it. ↩ starts the session in the background, ⌘↩ starts it and opens Seshboard, and
 * ⌘K has the rest. Esc goes back one step at a time (`escapeStep`): the task, out of the project or a list, then the typed
 * text, then the panel. Each time it opens, it starts empty.
 */
export function QuickStartPanel() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const prefs = usePreferences((s) => s.prefs);
  const projects = useProjects((s) => s.projects);
  const questionsDir = useProjects((s) => s.questionsDir);
  const profiles = useProfiles((s) => s.profiles);
  // The profile chip only when there is another profile to start with (a read-only provider's can't).
  const startableCount = useStartableProfiles().length;
  const defaultProfile = useProfiles((s) => s.defaultId);
  const models = useHosts((s) => s.models);
  const permissions = useHosts((s) => s.permissions);
  const signedOut = useSignIn((s) => s.state.profiles);
  const listed = useListedRows();
  const projectName = useProjectName();
  const now = useMinute();

  const [field, setField] = useState<QuickField>(EMPTY_FIELD);
  const [active, setActive] = useState(0);
  const [setup, setSetup] = useState<{ root: string; data: QuickSetup; defaults: QuickOptions } | null>(null);
  const [options, setOptions] = useState<QuickOptions | null>(null);
  const [busy, setBusy] = useState<'start' | 'later' | null>(null);
  const [problem, setProblem] = useState<StartProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [shooting, setShooting] = useState(false);
  /** A list an action opened (Working, To review), in place of the first screen; Esc goes back. */
  const [list, setList] = useState<QuickList | null>(null);
  /** macOS hasn't given Seshboard Screen Recording: what the panel says about it, with Open Settings. */
  const [noScreenAccess, setNoScreenAccess] = useState<string | null>(null);
  /** What was typed on the first screen when a project or a list took its place: Esc brings it back. */
  const rootQuery = useRef('');
  // Every system has an area picker (on Linux, a screenshot tool); main says when none is installed.
  const canShoot = typeof bridge()?.quickStartScreenshot === 'function';

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const attach = useAttachments({
    rootRef: panelRef,
    textareaRef: taskRef,
    cwd: field.project,
    setText: (task) => setField((f) => ({ ...f, task })),
    onNotice: setNotice,
  });

  const question = !!field.project && field.project === questionsDir;
  const picked = field.project ? projects.get(field.project) : undefined;
  const pickedName = question ? QUESTION_LABEL : (picked?.name ?? (field.project ? projectName(field.project) : ''));

  // The lists.
  const quickProjects = useQuickProjects(field.query);
  const waiting = useMemo(() => menuBarRows({ rows: listed, permissions: permissions.values(), catchUps: new Map(), projectName, now, finishedLimit: Infinity }), [listed, permissions, projectName, now]);
  const working = useMemo(() => waiting.filter((row) => row.section === 'working'), [waiting]);
  const review = useMemo(() => waiting.filter((row) => row.section === 'finished'), [waiting]);
  const last = useMemo(() => lastSession(listed), [listed]);
  // Once images are attached, Actions offers another screenshot and Remove all images; the list starts on a project.
  const attachedCount = attach.attachments.length;
  const attached = attachedCount > 0;
  const actions = useMemo(
    () => quickActions({ canShoot, attached: attachedCount, last: last && { id: last.id, title: last.title, project: projectName(last.projectRoot) }, working: working.length, review: review.length }),
    [canShoot, attachedCount, last, projectName, working.length, review.length],
  );
  const sections = useMemo(
    () =>
      list
        ? quickListSection(list, list === 'working' ? working : review, field.query)
        : quickStartSections({ actions, needsYou: waiting, showNeedsYou: prefs.quickStartNeedsYou, projects: quickProjects, filter: field.query, questions: !!questionsDir }),
    [list, working, review, actions, waiting, prefs.quickStartNeedsYou, quickProjects, field.query, questionsDir],
  );
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const activeIndex = Math.min(active, Math.max(0, rows.length - 1));
  // Typing a name puts the best match first: it is the one ↩ picks. After a screenshot, a project is what comes next.
  useEffect(() => {
    setActive(firstActive(rows, { typed: !!field.query.trim(), attached }));
    // Each new screenshot goes back to the first project.
  }, [field.query, attachedCount, list]);

  /** Back to an empty panel: after a start, or when it was closed long enough ago. */
  const reset = () => {
    setField(EMPTY_FIELD);
    setActive(0);
    setSetup(null);
    setOptions(null);
    setProblem(null);
    setNotice(null);
    setDone(null);
    setActionsOpen(false);
    setNoScreenAccess(null);
    setList(null);
    rootQuery.current = '';
    attach.setAttachments([]);
  };
  const focusField = () => requestAnimationFrame(() => (field.project ? taskRef.current : inputRef.current)?.focus());

  useEffect(() => {
    focusField();
    const off = bridge()?.onQuickStartShown((keepDraft) => {
      // Projects added or changed in the main window since the panel last showed.
      useProjects.getState().reload();
      if (!keepDraft) reset();
      requestAnimationFrame(() => (document.querySelector<HTMLElement>('[data-quick-start-task]') ?? inputRef.current)?.focus());
    });
    // The field is there and the listener is set: a press that made this panel can show the window now. The engine's own
    // ready report (the lists, the pings) takes longer and the panel doesn't need it to be typed in.
    requestAnimationFrame(() => bridge()?.quickStartReady());
    return off;
  }, []);
  useEffect(() => {
    if (field.project) taskRef.current?.focus();
    else inputRef.current?.focus();
  }, [field.project]);

  // The see-through part of the window passes clicks to the app under it; the panel and its menus take them.
  useEffect(() => {
    const platform = currentPlatform();
    // Linux can't report the pointer while clicks pass through, so the window keeps them there.
    if (platform !== 'darwin' && platform !== 'win32') return;
    let passing = false;
    const onMove = (event: MouseEvent) => {
      const over = event.target instanceof Element && !!event.target.closest(SURFACE);
      if (over === !passing) return;
      passing = !over;
      bridge()?.quickStartPassClicks(passing);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // The project's options: what it starts with, read again whenever another project is picked.
  useEffect(() => {
    const root = field.project;
    setProblem(null);
    if (!client || !root) return;
    if (setup?.root === root) return;
    let cancelled = false;
    const project = projects.get(root);
    const profileId = question ? defaultProfile : projectProfile(project, profiles, defaultProfile);
    quickSetup(client, { root, project, profile: profiles.find((p) => p.id === profileId), prefs, question: root === questionsDir })
      .then((data) => {
        if (cancelled) return;
        const defaults: QuickOptions = { profileId, model: effectiveModel(data.choices.model, prefs.autoModel.enabled), effort: data.choices.effort, permissionMode: data.choices.permissionMode, workspace: data.isGitRepo ? data.choices.workspace : 'current' };
        setSetup({ root, data, defaults });
        setOptions(defaults);
      })
      .catch((error: Error) => !cancelled && setProblem({ message: `Couldn’t read ${projectName(root)}: ${error.message}`, fix: 'pick-project' }));
    return () => {
      cancelled = true;
    };
  }, [client, field.project]);

  const ready = !!setup && setup.root === field.project && !!options;
  const changed = ready ? changedOptions(setup.defaults, options).length > 0 : false;
  const profile = profiles.find((p) => p.id === options?.profileId);
  const provider = profile && profile.provider !== 'claude' ? profile.provider : null;

  const close = () => bridge()?.quickStartClose();
  const openSession = (id: string) => {
    bridge()?.showSession(id);
    close();
  };

  const choose = (row: QuickRow | undefined) => {
    if (!row) return;
    if (row.kind === 'action') return runQuickAction(row.action);
    if (row.kind === 'needs-you' || row.kind === 'session') return openSession(row.session.id);
    const root = row.kind === 'project' ? row.project.root : questionsDir;
    if (!root) return;
    if (setup?.root !== root) {
      setSetup(null);
      setOptions(null);
    }
    rootQuery.current = field.query;
    setField((f) => pickProject(f, root));
  };

  /** An action on the first screen. */
  const runQuickAction = (action: QuickAction) => {
    if (action.id === 'screenshot') return void shoot();
    if (action.id === 'clear-images') return clearImages();
    if (action.id === 'last-session' && action.sessionId) return openSession(action.sessionId);
    if (action.id === 'working' || action.id === 'review') {
      rootQuery.current = field.query;
      setList(action.id);
      setField((f) => ({ ...f, query: '' }));
      return;
    }
    if (action.id === 'open-app') {
      bridge()?.menuBarCommand('open');
      close();
    }
  };

  /** From a list back to the first screen, with what was typed there. */
  const leaveList = () => {
    setList(null);
    setField((f) => ({ ...f, query: rootQuery.current }));
  };
  /** Esc with a project picked and no task: back to the list that found it. */
  const unpick = () => setField((f) => ({ ...f, project: null, query: rootQuery.current }));

  /** Esc: one step back. */
  const escape = () => {
    const step = escapeStep({ done: !!done, list: !!list, field });
    if (step === 'clear-task') setField((f) => ({ ...f, task: '' }));
    else if (step === 'unpick') unpick();
    else if (step === 'leave-list') leaveList();
    else if (step === 'clear-query') setField((f) => ({ ...f, query: '' }));
    else {
      // Closed with Esc: cleared now, so the next open shows nothing of it. Other hides are cleared when it shows again.
      close();
      reset();
    }
  };

  /** The draft as the queue keeps it. */
  const addLater = async () => {
    if (!field.project || !options || !setup) return;
    await addToQueue({
      cwd: field.project,
      prompt: field.task.trim(),
      attachments: attach.attachments,
      model: options.model || null,
      effort: options.effort || null,
      permissionMode: options.permissionMode,
      workspace: options.workspace,
      baseRef: setup.data.choices.baseRef,
      branch: null,
      profileId: options.profileId !== setup.defaults.profileId ? options.profileId : null,
    });
  };

  const finish = (next: Done) => {
    setDone(next);
    setField(EMPTY_FIELD);
    attach.setAttachments([]);
  };

  const canSend = ready && !!field.task.trim() && !busy;

  const start = async ({ open = false, worktree = false }: { open?: boolean; worktree?: boolean } = {}) => {
    if (!client || !field.project || !ready || !field.task.trim() || busy) return;
    const root = field.project;
    const task = field.task.trim();
    const failed = startProblem({
      folderExists: setup.data.exists,
      projectName: pickedName,
      signedIn: provider !== null || !signedOut.some((p) => p.profileId === options.profileId),
      profileName: profile?.name ?? 'This profile',
    });
    if (failed) return setProblem(failed);
    setBusy('start');
    setProblem(null);
    try {
      const workspace = worktree && setup.data.isGitRepo ? 'worktree' : options.workspace;
      const outcome = await startQuickSession(client, {
        root,
        prompt: task,
        attachments: attach.attachments,
        choices: { ...setup.data.choices, model: options.model, effort: options.effort, permissionMode: options.permissionMode, workspace },
        worktree: workspace === 'worktree' && setup.data.isGitRepo,
        profileId: options.profileId,
        setup: setup.data,
        autoEnabled: prefs.autoModel.enabled,
        provider: provider !== null,
        saveForLater: addLater,
      });
      if (outcome.kind === 'started') {
        if (open || !prefs.quickStartBackground) {
          reset();
          openSession(outcome.sessionId);
        } else finish({ kind: 'started', sessionId: outcome.sessionId, name: pickedName, task });
      } else if (outcome.kind === 'saved') finish({ kind: 'later', sessionId: null, name: pickedName, task });
    } catch (error) {
      setProblem(startProblem({ folderExists: true, projectName: pickedName, signedIn: true, profileName: '', error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(null);
    }
  };

  const later = async () => {
    if (!canSend) return;
    setBusy('later');
    setProblem(null);
    try {
      await addLater();
      finish({ kind: 'later', sessionId: null, name: pickedName, task: field.task.trim() });
    } catch (error) {
      setProblem({ message: `Couldn’t add it to Later: ${error instanceof Error ? error.message : String(error)}`, fix: null });
    } finally {
      setBusy(null);
    }
  };

  // The confirmation closes the panel by itself.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      close();
      reset();
    }, CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [done]);

  /** Take a screenshot: main hides the panel, the picker opens, and the panel comes back with the picture attached. */
  const shoot = async () => {
    if (!canShoot || shooting) return;
    setShooting(true);
    setNotice(null);
    try {
      const outcome = screenshotOutcome(await bridge()?.quickStartScreenshot());
      // Missing Screen Recording shows with Open Settings; anything else under the field.
      setNoScreenAccess(outcome.noScreenAccess ? outcome.notice : null);
      if (!outcome.noScreenAccess) setNotice(outcome.notice);
      if (!outcome.image) return;
      const { next, notice: left } = mergeAttachments(attach.attachments, [outcome.image], 1);
      attach.setAttachments(next);
      if (left) setNotice(left);
    } finally {
      setShooting(false);
    }
  };

  /** Remove all images: the bucket is empty again, and the list goes back to Take a screenshot. */
  const clearImages = () => {
    attach.setAttachments([]);
    setNoScreenAccess(null);
    setNotice(null);
  };

  const clickChip = (name: string) => document.querySelector<HTMLElement>(`[data-${name}-select]`)?.click();
  const runAction = (id: string) => {
    setActionsOpen(false);
    if (id === 'start-open') void start({ open: true });
    else if (id === 'worktree') void start({ worktree: true });
    else if (id === 'model') clickChip(CHIP_NAMES.model);
    else if (id === 'mode') clickChip(CHIP_NAMES.mode);
    else if (id === 'profile') clickChip(CHIP_NAMES.profile);
    else if (id === 'later') void later();
    else if (id === 'screenshot') void shoot();
    else if (id === 'clear-images') clearImages();
    else if (id === 'paste') {
      taskRef.current?.focus();
      void bridge()?.pasteClipboard();
    }
  };

  /** Every key the panel answers, from the page or handed over by main. */
  const onKey = (event: KeyLike): boolean => {
    const handled = (run: () => void) => {
      event.preventDefault();
      run();
      return true;
    };
    if (matches(event, 'quickstart.actions')) return handled(() => field.project && !done && setActionsOpen((open) => !open));
    if (done) {
      if (matches(event, 'quickstart.open-started') && done.sessionId) return handled(() => openSession(done.sessionId!));
      if (event.key === 'Escape') return handled(escape);
      return false;
    }
    if (event.key === 'Escape') return handled(escape);
    if (list && event.key === 'Backspace' && !field.query) return handled(leaveList);
    if (canShoot && matches(event, 'quickstart.screenshot')) return handled(() => void shoot());
    if (attached && matches(event, 'quickstart.clear-images')) return handled(clearImages);
    if (!field.project) {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !(event.key === 'Home' || event.key === 'End' ? field.query : '')) return handled(() => setActive(moveActive(rows.length, activeIndex, event.key)));
      if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) return handled(() => choose(rows[activeIndex]));
      if (matches(event, 'quickstart.pick')) {
        const n = Number(event.key);
        const row = rows.find((r) => r.kind === 'project' && r.number === n);
        if (row) return handled(() => choose(row));
      }
      return false;
    }
    if (matches(event, 'quickstart.start-open')) return handled(() => void start({ open: true }));
    if (matches(event, 'quickstart.start')) return handled(() => void start());
    if (matches(event, 'quickstart.worktree')) return handled(() => void start({ worktree: true }));
    if (matches(event, 'quickstart.later')) return handled(() => void later());
    if (matches(event, 'quickstart.model')) return handled(() => clickChip(CHIP_NAMES.model));
    if (matches(event, 'quickstart.profile')) return handled(() => clickChip(CHIP_NAMES.profile));
    if (matches(event, 'quickstart.mode') && event.target === taskRef.current && options && !provider) return handled(() => setOptions({ ...options, permissionMode: nextMode(options.permissionMode) }));
    if (event.key === 'Backspace' && event.target === taskRef.current && taskRef.current) {
      const next = backspaceAtStart(field, { start: taskRef.current.selectionStart, end: taskRef.current.selectionEnd });
      if (next) return handled(() => setField(next));
    }
    return false;
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const mac = currentPlatform() === 'darwin';
    return bridge()?.onQuickStartKey(({ key, shift }) =>
      onKeyRef.current({ key: key === 'enter' ? 'Enter' : key, metaKey: mac, ctrlKey: !mac, altKey: false, shiftKey: shift, target: document.activeElement, preventDefault: () => {} }),
    );
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing || actionsOpen) return;
    onKey(event);
  };

  // The task field grows with its text, up to six lines (`max-h`), then scrolls.
  useLayoutEffect(() => {
    const box = taskRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  }, [field.task, field.project]);

  const appIcon = usePreferences((s) => s.prefs.appIcon);
  const mark = <img src={tileOf(appIcon)} alt="" width={18} height={18} draggable={false} className="size-4.5 shrink-0" />;
  const divider = <span aria-hidden className="h-4.5 w-px bg-edge" />;
  const activeRow = rows[activeIndex];
  const thumbs = attach.attachments.length > 0 && <AttachmentThumbs attachments={attach.attachments} onRemove={(i) => attach.setAttachments((all) => all.filter((_, j) => j !== i))} className="px-4.5 pt-3" />;
  const screenAccess = noScreenAccess && (
    <div className="flex items-center gap-2 px-4.5 pt-2.5" role="alert" data-quick-start-screen-access>
      <span className="min-w-0 flex-1 text-ui text-warn">{noScreenAccess}</span>
      <Button size="sm" onClick={() => bridge()?.openScreenRecordingSettings()}>
        Open Settings
      </Button>
    </div>
  );

  return (
    <div className="h-full p-6" data-quick-start-root>
      <div className="relative" data-quick-start-surface>
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Quick start"
          className="overlay flex max-h-[592px] flex-col overflow-hidden rounded-2xl border text-text"
          onKeyDown={onKeyDown}
          data-quick-start
        >
          {done ? (
            <div className="flex items-center gap-3.5 px-5 py-5.5" data-quick-start-started={done.sessionId ?? 'later'}>
              <WorkingPanel size={34} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <b className="truncate text-title font-semibold">{done.kind === 'started' ? `Started in ${done.name}` : `Added to Later in ${done.name}`}</b>
                <span className="truncate text-ui text-muted">
                  “{firstLine(done.task)}” {done.kind === 'started' ? 'runs in the background.' : 'waits in the queue.'}
                </span>
              </span>
            </div>
          ) : (
            <>
              <div className={`flex min-h-15 gap-3 border-b border-edge px-4.5 ${field.project ? 'flex-wrap items-start py-3.5' : 'items-center'}`}>
                {field.project ? (
                  <>
                    <span className="flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg bg-border/60 px-2.5 text-body font-semibold" aria-hidden data-quick-start-token={field.project}>
                      <ProjectIcon project={picked} root={field.project} size={20} />
                      {pickedName}
                    </span>
                    <span id="quick-start-token" className="sr-only">
                      {tokenLabel(pickedName)}
                    </span>
                    <textarea
                      ref={taskRef}
                      value={field.task}
                      onChange={(event) => setField((f) => ({ ...f, task: event.target.value }))}
                      onPaste={attach.onPaste}
                      rows={1}
                      placeholder={question ? 'Ask anything…' : 'What should Claude do?'}
                      aria-label={question ? 'Quick question' : `Task for ${pickedName}`}
                      aria-describedby="quick-start-token"
                      className="max-h-[6lh] min-w-60 flex-1 resize-none bg-transparent py-1 text-title leading-normal outline-none placeholder:text-faint"
                      data-quick-start-task
                    />
                  </>
                ) : (
                  <>
                    {list ? (
                      <button type="button" onClick={leaveList} aria-label="Back" data-tooltip="Back (Esc)" className="shrink-0 rounded-md p-0.5 text-muted hover:bg-border/50 hover:text-text" data-quick-start-back>
                        <ArrowLeft size={18} aria-hidden />
                      </button>
                    ) : (
                      <Search size={18} aria-hidden className="shrink-0 text-muted" />
                    )}
                    <input
                      ref={inputRef}
                      value={field.query}
                      onChange={(event) => setField((f) => ({ ...f, query: event.target.value }))}
                      placeholder={list ? LIST_TITLES[list].placeholder : 'Start a session in…'}
                      aria-label={list ? LIST_TITLES[list].placeholder : 'Start a session in…'}
                      role="combobox"
                      aria-expanded
                      aria-controls="quick-start-list"
                      aria-activedescendant={activeRow ? `quick-start-row-${activeIndex}` : undefined}
                      className="min-w-0 flex-1 bg-transparent text-title outline-none placeholder:text-faint"
                      data-quick-start-field
                    />
                  </>
                )}
              </div>
              {field.project ? (
                <div className="grid">
                  {thumbs}
                  {screenAccess}
                  {ready ? (
                    <div className="flex min-w-0 items-center gap-1.5 px-3.5 pt-2.5" data-quick-start-options={changed ? 'changed' : 'defaults'}>
                      <div className="min-w-0 flex-1">
                        <ComposerChipRow
                          names={CHIP_NAMES}
                          profile={{ value: options.profileId, onChange: (profileId) => setOptions({ ...options, profileId }) }}
                          model={
                            provider
                              ? { value: '', label: 'Default model', choices: [{ value: '', label: 'Default model', description: `What ${PROVIDER_NAMES[provider]} picks` }], onChange: () => {} }
                              : { value: options.model, label: modelLabel(models, options.model), choices: modelChoices(models, prefs.autoModel, <AutoWand />), onChange: (model) => setOptions({ ...options, model }) }
                          }
                          effort={provider ? null : { value: options.effort, onChange: (effort) => setOptions({ ...options, effort }) }}
                          mode={provider ? null : { value: options.permissionMode, onChange: (permissionMode) => setOptions({ ...options, permissionMode }) }}
                        />
                      </div>
                      {setup.data.isGitRepo && (
                        <ChoiceMenu
                          name="quick-start-where"
                          heading="Where"
                          value={options.workspace}
                          choices={[
                            { value: 'current', label: whereLabel('current', setup.data.currentBranch), description: 'Works in the folder as it is' },
                            { value: 'worktree', label: 'New worktree', description: 'Works on its own copy, on a new branch' },
                          ]}
                          onChange={(workspace) => setOptions({ ...options, workspace })}
                        >
                          <span className="flex items-center gap-1.5">
                            <GitBranch size={12} aria-hidden className="shrink-0" />
                            {whereLabel(options.workspace, setup.data.currentBranch)}
                          </span>
                        </ChoiceMenu>
                      )}
                      <span className="shrink-0 pl-2 text-meta text-faint" data-quick-start-source>
                        {optionsSource(changed, pickedName)}
                      </span>
                    </div>
                  ) : (
                    <p className="px-4.5 pt-3 text-ui text-faint">{problem ? '' : 'Reading the project’s defaults…'}</p>
                  )}
                  {(problem || notice) && (
                    <div className="flex items-center gap-2 px-4.5 pt-2.5" role="alert" data-quick-start-problem>
                      <span className="min-w-0 flex-1 text-ui text-error">{problem?.message ?? notice}</span>
                      {problem?.fix === 'sign-in' && (
                        <Button
                          size="sm"
                          onClick={() => {
                            bridge()?.showInMain({ kind: 'settings', section: 'profiles' });
                            close();
                          }}
                          data-quick-start-fix="sign-in"
                        >
                          Sign in
                        </Button>
                      )}
                      {problem?.fix === 'pick-project' && (
                        <Button size="sm" onClick={() => setField((f) => ({ ...f, project: null }))} data-quick-start-fix="pick-project">
                          Pick another project
                        </Button>
                      )}
                    </div>
                  )}
                  <p className="px-4.5 pt-2.5 pb-3.5 text-meta text-faint">⌫ at the start goes back to the project list. Tab moves to the options.</p>
                </div>
              ) : (
                <>
                {thumbs}
                {screenAccess}
                {notice && (
                  <p className="px-4.5 pt-2.5 text-ui text-error" role="alert" data-quick-start-problem>
                    {notice}
                  </p>
                )}
                <div id="quick-start-list" role="listbox" aria-label="Start a session in" className="min-h-0 overflow-y-auto pb-2" data-quick-start-list>
                  {sections.length === 0 && <p className="px-4.5 py-3 text-ui text-faint">{list ? 'No session matches.' : 'Nothing matches.'}</p>}
                  {sections.map((section) => (
                    <div key={section.id} role="group" aria-label={section.title} data-quick-start-section={section.id}>
                      <div aria-hidden className="px-4.5 pt-2.5 pb-1 text-meta font-semibold text-faint">
                        {section.title}
                      </div>
                      {section.rows.map((row) => {
                        const index = rows.indexOf(row);
                        return <Row key={row.id} row={row} index={index} active={index === activeIndex} onHover={() => setActive(index)} onPick={() => choose(row)} questionsDir={questionsDir} />;
                      })}
                    </div>
                  ))}
                </div>
                </>
              )}
            </>
          )}
          <div className="flex h-11.5 shrink-0 items-center gap-2.5 border-t border-edge bg-text/3 pr-2.5 pl-3.5 text-ui text-muted">
            {mark}
            {done ? (
              <>
                <span className="flex-1 text-faint">Closes by itself in 2s</span>
                {done.sessionId && (
                  <Button variant="quiet" size="sm" shortcut="quickstart.open-started" onClick={() => openSession(done.sessionId!)} data-quick-start-open-started>
                    Open it
                  </Button>
                )}
              </>
            ) : field.project ? (
              <>
                <span className="flex-1 text-faint">{prefs.quickStartBackground ? 'Runs in the background' : ''}</span>
                {prefs.quickStartBackground && (
                  <Button variant="quiet" size="sm" shortcut="quickstart.start-open" onClick={() => void start({ open: true })} disabled={!canSend}>
                    Start and open
                  </Button>
                )}
                <Button variant="primary" size="sm" shortcut="quickstart.start" onClick={() => void start({ open: !prefs.quickStartBackground })} disabled={!canSend} aria-busy={busy === 'start'} data-quick-start-start>
                  {busy === 'start' ? 'Starting…' : 'Start'}
                </Button>
                {divider}
                <Button variant="quiet" size="sm" shortcut="quickstart.actions" onClick={() => setActionsOpen((open) => !open)} aria-expanded={actionsOpen} data-quick-start-actions-button>
                  Actions
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1" />
                <Button variant="quiet" size="sm" shortcut="quickstart.start" onClick={() => choose(activeRow)} disabled={!activeRow || (activeRow.kind === 'action' && shooting)} aria-busy={activeRow?.kind === 'action' && shooting}>
                  {activeRow?.kind === 'action' ? actionVerb(activeRow.action, shooting) : activeRow?.kind === 'needs-you' || activeRow?.kind === 'session' ? 'Open' : 'Pick project'}
                </Button>
              </>
            )}
          </div>
        </div>
        {/* There from the start, so the confirmation is announced when it arrives. */}
        <div role="status" aria-live="polite" className="sr-only" data-quick-start-announce>
          {done ? `${done.kind === 'started' ? `Started in ${done.name}` : `Added to Later in ${done.name}`}. ${firstLine(done.task)}` : ''}
        </div>
        {actionsOpen && field.project && !done && (
          <ActionsMenu
            busy={busy}
            canSend={canSend}
            worktree={!!setup?.data.isGitRepo}
            hidden={[...(startableCount > 1 ? [] : ['profile']), ...(provider ? ['model', 'mode'] : []), ...(canShoot ? [] : ['screenshot']), ...(attached ? [] : ['clear-images'])]}
            onRun={runAction}
            onClose={() => {
              setActionsOpen(false);
              taskRef.current?.focus();
            }}
          />
        )}
      </div>
    </div>
  );
}

const ACTION_ICONS: Record<QuickAction['id'], LucideIcon> = { screenshot: Camera, 'clear-images': Trash2, 'open-app': AppWindow, 'last-session': History, working: LoaderCircle, review: Inbox };

/** What the footer's button says for an action. */
function actionVerb(action: QuickAction, shooting: boolean): string {
  if (action.id === 'screenshot') return shooting ? 'Taking screenshot…' : 'Take screenshot';
  if (action.id === 'clear-images') return 'Remove all';
  if (action.id === 'working' || action.id === 'review') return 'Show';
  return 'Open';
}

/** One row of the first screen (an action, a session waiting on you, a project, or Quick question), or of a list. */
function Row({ row, index, active, onHover, onPick, questionsDir }: { row: QuickRow; index: number; active: boolean; onHover(): void; onPick(): void; questionsDir: string | null }) {
  const projects = useProjects((s) => s.projects);
  const base = `mx-2 flex h-10 cursor-default items-center gap-3 rounded-lg px-2.5 text-body ${active ? 'bg-selected' : ''}`;
  const common = { id: `quick-start-row-${index}`, role: 'option', 'aria-selected': active, onMouseMove: onHover, onMouseDown: (e: ReactMouseEvent) => e.preventDefault(), onClick: onPick, className: base };
  if (row.kind === 'action') {
    const Icon = ACTION_ICONS[row.action.id];
    const shortcut = row.action.id === 'clear-images' ? 'quickstart.clear-images' : row.action.id === 'screenshot' ? 'quickstart.screenshot' : null;
    return (
      <div {...common} data-quick-start-action-row={row.action.id}>
        <span className={`flex size-5.5 shrink-0 items-center justify-center ${row.action.id === 'working' ? 'text-accent-ink' : 'text-muted'}`}>
          {/* Working sessions spins in the working colour, as working does everywhere. */}
          <Icon size={16} className={row.action.id === 'working' ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0">{row.action.label}</span>
          <span className="truncate text-ui text-faint">{row.action.detail}</span>
        </span>
        {shortcut && <Kbd shortcut={shortcut} tone="cap" />}
      </div>
    );
  }
  if (row.kind === 'session') {
    const { session } = row;
    return (
      <div {...common} data-quick-start-session={session.id}>
        <ProjectIcon project={projects.get(session.projectRoot)} root={session.projectRoot} size={22} />
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
        <span className={`shrink-0 truncate text-ui ${session.section === 'working' ? 'text-accent-ink' : 'text-faint'}`}>{session.detail}</span>
      </div>
    );
  }
  if (row.kind === 'needs-you') {
    const { session } = row;
    return (
      <div {...common} data-quick-start-session={session.id}>
        <ProjectIcon project={projects.get(session.projectRoot)} root={session.projectRoot} size={22} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate">{session.title}</span>
          <span className="shrink-0 truncate text-ui text-faint">{projects.get(session.projectRoot)?.name ?? ''}</span>
        </span>
        <span className="shrink-0 truncate text-ui text-warn">{session.detail}</span>
      </div>
    );
  }
  if (row.kind === 'project') {
    const { project } = row;
    return (
      <div {...common} data-quick-start-project={project.root}>
        <ProjectIcon project={projects.get(project.root)} root={project.root} size={22} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate">{project.name}</span>
          <span className={`truncate text-ui ${project.tone === 'needs-you' ? 'text-warn' : project.tone === 'working' ? 'text-accent-ink' : 'text-faint'}`}>{project.meta}</span>
        </span>
        {row.number && <Kbd keys={`mod+${row.number}`} tone="cap" />}
      </div>
    );
  }
  return (
    <div {...common} data-quick-start-question>
      {questionsDir ? <ProjectIcon project={undefined} root={questionsDir} size={22} /> : null}
      <span className="flex-1">{QUESTION_ROW.label}</span>
      <span className="text-ui text-faint">{QUESTION_ROW.detail}</span>
    </div>
  );
}

/** ⌘K: a small menu under the bar's right end, with search. ↑ ↓ and ↩ run one; Esc closes it. */
function ActionsMenu({ busy, canSend, worktree, hidden, onRun, onClose }: { busy: string | null; canSend: boolean; worktree: boolean; hidden: readonly string[]; onRun(id: string): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const needsTask = new Set(['start-open', 'worktree', 'later']);
  // Only what can be done here: no worktree outside a git repository, no profile to pick with one profile.
  const shown = ACTIONS.filter((a) => (worktree || a.id !== 'worktree') && !hidden.includes(a.id) && (!query.trim() || fuzzyScore(query, a.label) !== null));
  const enabled = (id: string) => !busy && (!needsTask.has(id) || canSend);
  const run = (id: string) => enabled(id) && onRun(id);
  return (
    <div className="overlay absolute top-full right-3 z-10 mt-2 w-80 rounded-xl border p-1.5" data-quick-start-actions>
      <ul id="quick-start-actions" role="listbox" aria-label="Actions" className="grid">
        {shown.map((action, i) => (
          <li
            key={action.id}
            id={`quick-start-action-${i}`}
            role="option"
            aria-selected={i === active}
            aria-disabled={!enabled(action.id)}
            onMouseMove={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(action.id)}
            className={`flex h-8.5 cursor-default items-center gap-3 rounded-lg px-2.5 text-ui ${i === active ? 'bg-selected' : ''} ${enabled(action.id) ? '' : 'text-faint'}`}
            data-quick-start-action={action.id}
          >
            <span className="flex-1">{action.label}</span>
            <Kbd shortcut={action.shortcut} tone="cap" />
          </li>
        ))}
        {shown.length === 0 && <li className="px-2.5 py-1.5 text-ui text-faint">No action matches</li>}
      </ul>
      <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-0.5 text-faint">
        <Search size={13} aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || matches(event, 'quickstart.actions')) {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => moveActive(shown.length, i, event.key));
            } else if (event.key === 'Enter' && shown[active]) {
              event.preventDefault();
              run(shown[active].id);
            }
          }}
          placeholder="Search actions…"
          aria-label="Search actions"
          role="combobox"
          aria-expanded
          aria-controls="quick-start-actions"
          aria-activedescendant={shown[active] ? `quick-start-action-${active}` : undefined}
          className="h-7.5 min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-faint"
          data-quick-start-actions-search
        />
      </div>
    </div>
  );
}
