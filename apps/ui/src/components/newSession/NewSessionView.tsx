import { ChevronDown, Clock, Folder, FolderGit2, GitBranch, Link2, ListEnd, MessageCircleQuestion, Play, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTO_MODEL, bringsAnything, projectOf, type ContextItem, type GithubIssueDetail, type GithubPrDetail, type ImageAttachment, type LaterDraft, type LaterItem, type ProjectInspection, type Schedule, type QueueWaitFor, type SlashCommand, type WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ChoiceMenu } from './ChoiceMenu.tsx';
import { FolderPicker } from './FolderPicker.tsx';
import { AddProjectDialog } from '../projects/AddProjectDialog.tsx';
import { routeHint } from './route.ts';
import { filterBranches } from '../worktree/branchMenu.ts';
import { basename, shortAge } from '../../lib/format.ts';
import { nextMode, randomWorktreeName } from '../../lib/modes.ts';
import { passFocusGate, useFocus } from '../../state/focusGate.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { addToQueue, removeFromQueue, setAutoStart, setWaitFor, updateQueued, useLater } from '../../state/laterStore.ts';
import { useSchedules } from '../../state/schedulesStore.ts';
import { ScheduleDialog } from '../schedules/ScheduleDialog.tsx';
import { openTriggerEditor } from '../../state/triggersStore.ts';
import { startRun, usePipelines } from '../../state/pipelinesStore.ts';
import { boxChoiceUse, keptRunAs, modelWord, pipelinesFor, runAsSteps } from '../../state/pipelines.ts';
import { rememberPipeline } from '../../state/lastPipeline.ts';
import { RunAsChip } from './RunAsChip.tsx';
import { RunAsSteps } from './RunAsSteps.tsx';
import { useStartAfter } from '../../state/startAfterStore.ts';
import { autoStartBlock, busyInProject, promptLabel, queueSession, sameDraft } from '../../state/queue.ts';
import { useLinks } from '../../state/linksStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { inScope, rowStatus } from '../../state/sidebarRows.ts';
import { PromptChips } from '../savedPrompts/PromptChips.tsx';
import { useSavedPrompts } from '../savedPrompts/savedPromptsStore.ts';
import { Composer, type SentParts } from '../composer/Composer.tsx';
import { promptWithContext } from '../composer/contextItems.ts';
import { StartButton } from './StartButton.tsx';
import { RunOnSwitch } from './RunOnSwitch.tsx';
import { RemoteNewSession } from '../computers/RemoteNewSession.tsx';
import { ClonePanel } from '../clone/ClonePanel.tsx';
import { useTrustQuestion } from '../clone/CloneTrustDialog.tsx';
import { CloneCancelled, useCloneJob, type CloneResult } from '../clone/useCloneJob.ts';
import { canClone, planLine } from '../clone/cloneModel.ts';
import { useClone, useCloneEnabled } from '../../state/cloneStore.ts';
import { useComputers } from '../../state/computersStore.ts';
import { THIS_COMPUTER } from '../../state/remoteRows.ts';
import { useRunOn } from '../../state/runOnStore.ts';
import { AutoWand } from '../composer/ComposerChips.tsx';
import { AUTO_OFF_NOTE, effectiveModel, modelChoices, modelLabel } from '../../lib/autoModel.ts';
import { focusStartBlock, startButtonState } from './startMenu.ts';
import { newDraftKey, newSessionDraftBanner, draftMessage } from '../../state/drafts.ts';
import { useDrafts, type ComposerDraft } from '../../state/draftsStore.ts';
import { DraftBanner } from '../drafts/DraftBanner.tsx';
import { FocusNote } from '../focus/FocusNote.tsx';
import { QueuedInProject } from '../queue/QueuedInProject.tsx';
import { waitForEntries } from '../queue/queueMenu.tsx';
import { Menu, useMenu } from '../Menu.tsx';
import { useMinute } from '../focus/useMinute.ts';
import { ComposerChipRow } from '../composer/ComposerChips.tsx';
import { projectHistory } from '../composer/promptHistory.ts';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { ProjectIcon, useProjectColor } from '../ProjectIcon.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { OpenInButton } from '../OpenInButton.tsx';
import { CatchUpButton } from '../git/CatchUpButton.tsx';
import { UsageBand } from '../UsageBand.tsx';
import { linkNoticeText } from './linkNotice.ts';
import { startFromGithub, useGithubStart, type GithubStartRequest } from '../../state/githubStartStore.ts';
import { currentCheckoutBlocked, forkCaution, linkBanner, NO_AUTOSTART, otherRepository, prBranch, readOnlyFork, startNote, startPrompt, takenWorktreeNames, uniqueWorktreeName, worktreeNameFor } from '../github/githubStart.ts';
import { chipItem, reasonLine } from '../github/githubText.ts';
import { activityByProject, latestBranches, orderProjects, pickUpRows, tileStatus } from './projectTiles.ts';
import { addOrSelect } from './pathInput.ts';
import { branchLabel, branchNote, freshBase } from './trayLabels.ts';
import { branchBlocked, checkoutBranchFor, ELSEWHERE_NOTE, shouldPrewarm, startNewSession } from './startSession.ts';
import { DEFAULTS_KEY, globalPatch, INITIAL_CHOICES, layeredDefaults, linkStartingChoices, readGlobals, sameDefaults, startingChoices, toProjectDefaults, withNewSessionMode, type Choices, type GlobalChoices } from './choices.ts';
import { comboPresses, shortcutById } from '../../lib/shortcuts.ts';
import { INITIAL_QUESTION_CHOICES, isQuestionsFolder, QUESTION_DEFAULTS_KEY, QUESTION_LABEL, questionPatch, questionStartingChoices, readQuestionChoices, sessionOptions, type QuestionChoices } from '../../lib/questions.ts';

const keysOf = (id: 'new-session.pick') => shortcutById(id).keys[0]!;

/**
 * Starts a new Claude Code session. The prompt is the main thing; around it sit the project, the
 * profile, model, effort and permission mode, and the route the session takes (this checkout, another
 * branch or a worktree). Options start from the project's defaults; fields it leaves unset use the
 * choices last made here.
 */
/**
 * New session: on this computer (`LocalNewSession`), or, with another computer picked in Run on, on that one
 * (`RemoteNewSession`, docs/remote-access.md). A computer that goes away falls back to this one.
 */
export function NewSessionView() {
  const target = useRunOn((s) => s.target);
  const computer = useComputers((s) => (target === THIS_COMPUTER ? null : (s.status?.computers.find((c) => c.id === target && c.state === 'connected') ?? null)));
  const connection = useEngineConnection();
  if (computer) return <RemoteNewSession client={connection.status === 'connected' ? connection.client : null} computer={computer} />;
  return <LocalNewSession />;
}

function LocalNewSession() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const sessions = useSessions((s) => s.sessions);
  const select = useSessions((s) => s.select);
  const models = useHosts((s) => s.models);
  const commandsVersion = useHosts((s) => s.commandsVersion);
  const focusRequest = useSessions((s) => s.newSessionRequest);
  const hosts = useHosts((s) => s.hosts);
  const live = useSessions((s) => s.live);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const archiveAfterDays = usePreferences((s) => s.prefs.archiveAfterDays);
  const autoModel = usePreferences((s) => s.prefs.autoModel);
  const projectOrder = usePreferences((s) => s.prefs.projectOrder);
  const newSessionMode = usePreferences((s) => s.prefs.newSessionMode);
  const view = useSessions((s) => s.view);
  const [cwd, setCwd] = useState<string | null>(null);
  const [globals, setGlobals] = useState<GlobalChoices>(INITIAL_CHOICES);
  /** The choices last made for a quick question, kept apart from those for projects. */
  const [questionChoices, setQuestionChoices] = useState<QuestionChoices>(INITIAL_QUESTION_CHOICES);
  // Before a folder is picked, the mode is already the one Settings sets.
  const [d, setD] = useState<Choices>(() => ({ ...withNewSessionMode(INITIAL_CHOICES, newSessionMode), branch: '' }));
  const [loaded, setLoaded] = useState(false);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [gitBranches, setGitBranches] = useState<{ current: string | null; branches: string[]; checkedOutElsewhere?: string[] }>({ current: null, branches: [] });
  /** Where the checkout stands: the remote a fresh worktree branches from, its default branch, and how far the upstream is ahead. */
  const [gitStatus, setGitStatus] = useState<WorktreeStatus | null>(null);
  const [worktreeName, setWorktreeName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  // Made up once and kept, so the name in the field is the one the worktree gets; a new one after each start.
  const [suggestedName, setSuggestedName] = useState(randomWorktreeName);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [draftPrompt, setDraftPrompt] = useState('');
  /** The images in the message box, which go to the queue with the prompt. */
  const [draftAttachments, setDraftAttachments] = useState<ImageAttachment[]>([]);
  /** The context chips in the message box (files, folders, pasted text), which go to the queue as chips. */
  const [draftContext, setDraftContext] = useState<ContextItem[]>([]);
  /** The prompt was left here earlier (in the drafts store, per project): say so above the box, with Discard. */
  const [restored, setRestored] = useState<ComposerDraft | null>(null);
  const [addAsProject, setAddAsProject] = useState(true);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** A profile chosen for this session only (null: the project's, else the default). */
  const [profileOverride, setProfileOverride] = useState<string | null>(null);
  /** Run as (#179): the pipeline Start runs with the prompt as its task, or null for one session. Kept with the draft. */
  const [runAsId, setRunAsId] = useState<string | null>(null);
  /** The steps line's Change: opens the Run as menu. */
  const [runAsMenu, setRunAsMenu] = useState(0);
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = useProfiles((s) => s.defaultId);
  /** The folder the user changed options for: until the folder changes, late-arriving defaults never override their choices. */
  const touchedFor = useRef<string | null>(null);
  /** A `switchboard://` link chose the folder (or chose to leave it empty): the remembered or preferred folder must not fill it. */
  const folderFromLink = useRef(useClone.getState().form !== null);
  const linkRequest = useLinks((s) => s.newSession);
  /** Replaces the prompt: a link's prompt, or clearing it. */
  const [preset, setPreset] = useState<{ text: string; attachments?: ImageAttachment[]; context?: ContextItem[]; seq: number } | undefined>(undefined);
  const presets = useRef(0);
  /** The prompt came from a link and hasn't been sent or cleared: its length, to say so under the message box. */
  const [linkPrompt, setLinkPrompt] = useState<number | null>(null);
  /** A link's `repo`: being looked up, or not found among your checkouts. */
  const [linkRepo, setLinkRepo] = useState<{ repo: string; state: 'looking' | 'missing' } | null>(null);
  /** The link named no folder: rather than guess, the folder is left empty and the picker opens. */
  const [linkNoFolder, setLinkNoFolder] = useState(false);
  const [pickerRequest, setPickerRequest] = useState(0);
  /** Add project…: the dialog onboarding uses, here picking what it adds. */
  const [addingProject, setAddingProject] = useState(false);
  /** An `autostart` link's prompt, sent as soon as its folder and the project's defaults are in place. */
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  /** An `autostart` link is waiting: its choices never take the permission mode you last picked (see `linkStartingChoices`). */
  const autostarting = pendingStart !== null;
  const choicesFor = autostarting ? linkStartingChoices : startingChoices;
  /** Why the folder couldn't be checked (the engine call failed). */
  const [inspectError, setInspectError] = useState<string | null>(null);
  /**
   * A queued item is open (Edit in New session): the box is the item's, not New session's prompt for the project,
   * which is left as it was. Edits are kept on the item; it stays queued until it starts (which takes it off).
   */
  const [fromLater, setFromLater] = useState<LaterItem | null>(null);
  /**
   * A schedule is open (Edit…): the box holds its prompt and choices, apart from New session's own prompt. Nothing is
   * kept until Save schedule; Start ▾ offers it instead of Schedule….
   */
  const [fromSchedule, setFromSchedule] = useState<Schedule | null>(null);
  /** The schedule dialog is open, with the draft it will run. */
  const [scheduling, setScheduling] = useState<LaterDraft | null>(null);
  const scheduleRequest = useSchedules((s) => s.request);
  /** Opened with Schedule a session (Upcoming): Start ▾ is on Schedule…, and Enter opens the schedule dialog. */
  const [scheduleFirst, setScheduleFirst] = useState(false);
  const scheduleFirstRequest = useSchedules((s) => s.scheduleFirst);
  /** Edits to the open queued item not saved yet: they go to the item a moment after you stop, or when you leave it. */
  const unsavedQueued = useRef<{ id: string; draft: LaterDraft; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** What the prompt would wait for once queued, when changed with "Wait for…"; null: the item's own, else its project. */
  const [queueWait, setQueueWait] = useState<QueueWaitFor | null>(null);
  /** Start by itself, when changed here; null: the item's own, else off. Never remembered for the next item. */
  const [queueAuto, setQueueAuto] = useState<boolean | null>(null);
  /** Opened with Start after this one…: the session it follows. Add to queue leads while Wait for still says it. */
  const [startAfterId, setStartAfterId] = useState<string | null>(null);
  const startAfterRequest = useStartAfter((s) => s.request);
  const waitMenu = useMenu();
  /** Start anyway in the focus note sends what is in the box, without asking again. */
  const [submitRequest, setSubmitRequest] = useState(0);
  /**
   * Filled in from an issue or pull request (⌥↩ in the # list, the palette, a link): the request, the item once gh has
   * read it, or why it can't be used. Cleared when the prompt is, the project changes or the session starts.
   */
  const [fromGithub, setFromGithub] = useState<{ request: GithubStartRequest; issue: GithubIssueDetail | null; pr: GithubPrDetail | null; error: string | null; loading: boolean } | null>(null);
  const githubRequest = useGithubStart((s) => s.request);
  /** A link's issue or pull request, waiting for the link's folder (a `repo` is looked up first). */
  const [linkGithub, setLinkGithub] = useState<{ type: 'issue' | 'pr'; ref: string; prompt: string | null; autostart: boolean } | null>(null);
  // Clone from GitHub: the form (kept in the store, so Run on can move it to another computer) and its clone here.
  const cloneEnabled = useCloneEnabled();
  const cloneForm = useClone((s) => s.form);
  const cloneRequest = useClone((s) => s.request);
  const cloneJob = useCloneJob(client, cloneForm?.url ?? '', cloneForm?.name ?? '');
  /** A request that said which repository (the palette, a link, the folder field): clone as soon as the plan is in. */
  const [cloneSoon, setCloneSoon] = useState(false);
  /** The folder picked before the clone form opened, to go back to when it closes without a clone. */
  const beforeClone = useRef<string | null>(null);
  const trust = useTrustQuestion();
  const focus = useFocus();
  const atLimit = focus.limit !== null && focus.count >= focus.limit;
  /** Strict at the limit: Start waits (⌘↵ still asks, with the queue offered), Add to queue stays in Start's menu. */
  const startBlocked = focusStartBlock(focus);
  const now = useMinute();
  const laterRequest = useLater((s) => s.request);

  const projects = useProjects((s) => s.projects);
  const projectFilter = useProjects((s) => s.filter);
  const newSessionIn = useProjects((s) => s.newSessionIn);
  const reloadProjects = useProjects((s) => s.reload);
  const yours = useMemo(() => addedProjects(projects), [projects]);
  const folders = useMemo(() => yours.filter((p) => p.exists).map((p) => p.root), [yours]);
  const home = useHomeFolder();
  const project = cwd ? projects.get(cwd) : undefined;
  const questionsDir = useProjects((s) => s.questionsDir);
  /** Quick question picked: the scratch folder, with no git and no project to add or keep defaults for. */
  const question = isQuestionsFolder(cwd, questionsDir);
  const options = sessionOptions(question);
  const isProject = project?.added ?? false;
  const projectProfile = project?.profileId && profiles.some((p) => p.id === project.profileId) ? project.profileId : null;
  const profileId = (profileOverride && profiles.some((p) => p.id === profileOverride) ? profileOverride : null) ?? projectProfile ?? defaultProfile;
  /** The project's defaults, then the profile's: picking another profile brings its defaults, until the user changes something. */
  const sessionDefaults = layeredDefaults(isProject ? project!.defaults : null, profiles.find((p) => p.id === profileId)?.defaults);
  const defaultsKey = JSON.stringify(sessionDefaults);
  /** What a session here starts from: a quick question's own choices, else the project's and profile's defaults over the ones last used (and the mode Settings sets). */
  const firstChoices = (): Choices => (question ? questionStartingChoices(questionChoices) : choicesFor(withNewSessionMode(globals, newSessionMode), sessionDefaults));
  /** The picked folder's colour: the message box's frame, matching its tile. */
  const projectColor = useProjectColor(project, cwd);
  const lastBranches = useMemo(() => latestBranches(sessions.values()), [sessions]);
  // The sessions the sidebar lists (sessions from other apps only when the scope shows them): the
  // tiles' status lines and "Pick up in" come from these.
  const rows = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const activity = useMemo(() => activityByProject(rows), [rows]);
  const ordered = useMemo(
    () => orderProjects(folders, projectOrder, (root) => Math.max(projects.get(root)?.lastActivity ?? 0, activity.get(root)?.lastActivity ?? 0) || null),
    [folders, projectOrder, projects, activity],
  );
  const statusOf = (root: string) => tileStatus(activity.get(root), projects.get(root)?.lastActivity ?? null, Date.now());

  // Restore the last folder and global choices.
  useEffect(() => {
    if (!client || loaded) return;
    let cancelled = false;
    // Quick question choices are optional: without them, a question starts from the initial ones.
    const questionStored = client.call('appState.get', { key: QUESTION_DEFAULTS_KEY }).then(({ value }) => value, () => null);
    Promise.all([client.call('appState.get', { key: DEFAULTS_KEY }), questionStored]).then(
      ([{ value }, questionValue]) => {
        if (cancelled) return;
        const stored = readGlobals(value);
        setGlobals(stored.globals);
        setQuestionChoices(readQuestionChoices(questionValue));
        if (!folderFromLink.current) setCwd((current) => current ?? stored.cwd);
        setLoaded(true);
      },
      // Without the remembered choices, start from the initial ones rather than never getting going.
      () => !cancelled && setLoaded(true),
    );
    return () => {
      cancelled = true;
    };
  }, [client, loaded]);
  const forgetUnsavedQueued = () => {
    if (unsavedQueued.current) clearTimeout(unsavedQueued.current.timer);
    unsavedQueued.current = null;
  };
  const saveQueued = () => {
    const pending = unsavedQueued.current;
    forgetUnsavedQueued();
    if (pending) void updateQueued(pending.id, pending.draft).catch(() => {});
  };
  useEffect(() => saveQueued, []);
  /**
   * Back from a queued item to New session: the item keeps its edits, and the box shows the project's own prompt
   * again (remounting the composer reads it from the drafts store), with its choices or the project's defaults.
   */
  const leaveQueued = () => {
    saveQueued();
    setFromLater(null);
    setFromSchedule(null);
    setQueueWait(null);
    setQueueAuto(null);
    setStartAfterId(null);
    setPreset(undefined);
    setDraftPrompt('');
    touchedFor.current = null;
    setProfileOverride(null);
    setD(firstChoices());
  };
  // New session asked for again while a queued item is open (the + button, ⌘N, a project's unsent prompt): back
  // to New session's own prompt. Opening a queued item asks for it too, and is handled below.
  const seenFocusRequest = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === seenFocusRequest.current) return;
    seenFocusRequest.current = focusRequest;
    // New session asked for plainly (not through Schedule a session, taken below): Start is Start again.
    if (!useSchedules.getState().scheduleFirst) setScheduleFirst(false);
    if ((fromLater && !useLater.getState().request) || (fromSchedule && !useSchedules.getState().request)) leaveQueued();
  }, [focusRequest]);
  // Schedule a session: taken once, after the request above, which comes with it.
  useEffect(() => {
    if (!scheduleFirstRequest) return;
    useSchedules.setState({ scheduleFirst: false });
    setScheduleFirst(true);
  }, [scheduleFirstRequest]);

  // The palette or Projects view asked for a folder (a session's git menu: in a new worktree).
  /** The folder that should start on "New worktree", until its defaults are in or the user changes something. */
  const worktreeFor = useRef<string | null>(null);
  useEffect(() => {
    if (!newSessionIn) return;
    if (fromLater || fromSchedule) leaveQueued();
    worktreeFor.current = useProjects.getState().newSessionWorktree ? newSessionIn : null;
    setCwd(newSessionIn);
    useProjects.getState().startIn(null);
  }, [newSessionIn]);
  useEffect(() => {
    // Only fills an empty field. A project filtered in the sidebar is the natural default.
    const preferred = projectFilter && folders.includes(projectFilter) ? projectFilter : folders[0];
    if (loaded && !cwd && preferred && !folderFromLink.current) setCwd((c) => c ?? preferred);
  }, [loaded, folders, cwd, projectFilter]);
  // A `switchboard://new-session` link: fill in its folder and prompt. Unless it says `autostart`, nothing
  // is sent; the user reads it and presses Enter.
  useEffect(() => {
    if (!linkRequest) return;
    const link = useLinks.getState().take();
    if (!link) return;
    if (fromLater || fromSchedule) leaveQueued();
    // The store has already turned a project name into its folder.
    folderFromLink.current = true;
    touchedFor.current = null;
    setProfileOverride(null);
    setAddAsProject(true);
    setCwd(link.cwd);
    setLinkRepo(link.repo ? { repo: link.repo, state: 'looking' } : null);
    setLinkNoFolder(!link.cwd && !link.repo);
    if (!link.cwd && !link.repo) setPickerRequest((n) => n + 1);
    // An issue or pull request: filled in once its folder is known (below), and never started on its own.
    const githubType = link.issue ? 'issue' : link.pr ? 'pr' : null;
    setLinkGithub(githubType ? { type: githubType, ref: (link.issue ?? link.pr)!, prompt: link.prompt, autostart: link.autostart } : null);
    setFromGithub(null);
    if (githubType) {
      setPendingStart(null);
      return;
    }
    // Starting needs a folder the link chose; a link without one waits for the user like any other.
    setPendingStart(link.autostart && link.prompt && (link.cwd || link.repo) ? link.prompt : null);
    if (link.prompt) {
      setRestored(null);
      setPreset({ text: link.prompt, seq: ++presets.current });
      setDraftPrompt(link.prompt);
      setLinkPrompt(link.prompt.length);
    }
  }, [linkRequest]);
  // Start after this one…: the session's project (through `startIn`, above), Wait for that session, Start by itself on.
  useEffect(() => {
    if (!startAfterRequest) return;
    const request = useStartAfter.getState().take();
    if (!request) return;
    if (fromLater || fromSchedule) leaveQueued();
    setCwd(request.root);
    setQueueWait({ kind: 'session', sessionId: request.sessionId });
    setQueueAuto(true);
    setStartAfterId(request.sessionId);
  }, [startAfterRequest]);
  // New session from an issue or pull request: its project, then (once gh has read it) the worktree, chip and prompt.
  // Like a link's, it never starts on its own.
  useEffect(() => {
    if (!githubRequest) return;
    const request = useGithubStart.getState().take();
    if (!request) return;
    if (fromLater || fromSchedule) leaveQueued();
    folderFromLink.current = true;
    touchedFor.current = null;
    setProfileOverride(null);
    setPendingStart(null);
    setLinkRepo(null);
    setLinkNoFolder(false);
    setLinkPrompt(null);
    setCwd(request.root);
    setFromGithub({ request, issue: null, pr: null, error: null, loading: true });
  }, [githubRequest]);
  const githubLoading = fromGithub?.loading ? fromGithub.request : null;
  useEffect(() => {
    if (!client || !githubLoading) return;
    const request = githubLoading;
    const { root, type, ref } = request;
    let cancelled = false;
    const fail = (error: string) => !cancelled && setFromGithub((current) => (current?.request === request ? { ...current, error, loading: false } : current));
    void (async () => {
      const [status, found] = await Promise.all([
        client.call('github.status', { root }).catch(() => null),
        type === 'pr'
          ? client.call('github.pr', { root, ref }).then(({ pr, reason, message }) => ({ item: pr, reason, message }))
          : client.call('github.issue', { root, ref }).then(({ issue, reason, message }) => ({ item: issue, reason, message })),
      ]).catch(() => [null, null] as const);
      if (cancelled) return;
      const item = found?.item ?? null;
      const name = projects.get(root)?.name ?? basename(root);
      if (!item) return fail(found ? (reasonLine(found.reason, found.message) ?? `Couldn't read ${ref}.`) : `Couldn't read ${ref}.`);
      if (status?.repo && item.repo.toLowerCase() !== status.repo.toLowerCase()) return fail(otherRepository(type, name));
      // A worktree named after it, made unique against the worktrees and branches there already.
      const [listed, branches] = await Promise.all([client.call('worktrees.list', { root }).catch(() => null), client.call('git.branches', { cwd: root }).catch(() => null)]);
      if (cancelled) return;
      const worktreeName = uniqueWorktreeName(worktreeNameFor(type, item.number, item.title), takenWorktreeNames(listed?.worktrees ?? [], branches?.branches ?? []));
      touchedFor.current = root;
      setD((current) => ({ ...current, workspace: 'worktree', branch: '' }));
      setWorktreeName(worktreeName);
      setNameTouched(true);
      // The chip replaces whatever the box held for this project; the prompt is the link's, else "Fix #32: …".
      const key = newDraftKey(root);
      const drafts = useDrafts.getState();
      drafts.removeContext(key, (drafts.drafts[key]?.context ?? []).map((chip) => chip.id));
      drafts.addContext(key, [chipItem(item)]);
      const prompt = request.link?.prompt ?? startPrompt(type, item.number, item.title);
      setRestored(null);
      setPreset({ text: prompt, seq: ++presets.current });
      setDraftPrompt(prompt);
      setFromGithub((current) => (current?.request === request ? { ...current, issue: type === 'issue' ? item : null, pr: type === 'pr' ? (item as GithubPrDetail) : null, loading: false } : current));
    })();
    return () => {
      cancelled = true;
    };
  }, [client, githubLoading]);
  // A prompt from the queue: its folder, choices and prompt, to check before starting. It opens in a box of its own;
  // one that left the queue (Undo of Add to queue) comes back as New session's prompt instead.
  useEffect(() => {
    if (!laterRequest) return;
    const request = useLater.getState().take();
    if (!request) return;
    const { item, asNew } = request;
    // Already open: the box may hold edits the queue doesn't have yet.
    if (!asNew && item.id === fromLater?.id) return;
    if (asNew && fromLater) leaveQueued();
    else saveQueued();
    // Like a link, it chose the folder; its own choices must not be replaced by the project's defaults.
    folderFromLink.current = true;
    touchedFor.current = item.cwd;
    worktreeFor.current = null;
    setLinkRepo(null);
    setLinkNoFolder(false);
    setPendingStart(null);
    setLinkPrompt(null);
    setAddAsProject(true);
    setProfileOverride(item.profileId);
    setCwd(item.cwd);
    setD({ model: item.model ?? '', permissionMode: item.permissionMode, effort: item.effort ?? '', workspace: item.workspace, baseRef: item.baseRef, branch: item.branch ?? '' });
    setRestored(null);
    setPreset({ text: item.typed ?? item.prompt, attachments: item.attachments, context: item.context, seq: ++presets.current });
    setDraftPrompt(item.typed ?? item.prompt);
    setFromLater(asNew ? null : item);
    setQueueWait(null);
    setQueueAuto(null);
    setStartAfterId(null);
  }, [laterRequest]);
  // Edit… on a schedule: its folder, choices and prompt, in a box of its own, until Save schedule (or leaving it).
  useEffect(() => {
    if (!scheduleRequest) return;
    const schedule = useSchedules.getState().take();
    if (!schedule) return;
    if (fromLater) leaveQueued();
    const { draft } = schedule;
    folderFromLink.current = true;
    touchedFor.current = draft.cwd;
    worktreeFor.current = null;
    setLinkRepo(null);
    setLinkNoFolder(false);
    setPendingStart(null);
    setLinkPrompt(null);
    setAddAsProject(true);
    setProfileOverride(draft.profileId);
    setCwd(draft.cwd);
    setD({ model: draft.model ?? '', permissionMode: draft.permissionMode, effort: draft.effort ?? '', workspace: draft.workspace, baseRef: draft.baseRef, branch: draft.branch ?? '' });
    setRestored(null);
    setPreset({ text: draft.typed ?? draft.prompt, attachments: draft.attachments, context: draft.context, seq: ++presets.current });
    setDraftPrompt(draft.typed ?? draft.prompt);
    setFromSchedule(schedule);
    setQueueWait(null);
    setQueueAuto(null);
    setStartAfterId(null);
  }, [scheduleRequest]);
  // The command palette's prompt step, moved here with ⌘E: its folder, choices, profile and prompt.
  const handoff = usePaletteBus((s) => s.handoff);
  useEffect(() => {
    if (!handoff) return;
    const item = usePaletteBus.getState().takeHandoff();
    if (!item) return;
    if (fromLater || fromSchedule) leaveQueued();
    // Like a link, it chose the folder; the choices made in the palette must not be replaced by the project's defaults.
    folderFromLink.current = true;
    touchedFor.current = item.root;
    worktreeFor.current = null;
    setLinkRepo(null);
    setLinkNoFolder(false);
    setPendingStart(null);
    setLinkPrompt(null);
    setAddAsProject(true);
    setProfileOverride(item.profileId);
    setCwd(item.root);
    setD({ ...item.choices, workspace: item.worktree ? 'worktree' : 'current' });
    setRestored(null);
    setPreset({ text: item.prompt, attachments: item.attachments, seq: ++presets.current });
    setDraftPrompt(item.prompt);
  }, [handoff]);
  // Clone from GitHub asked for here (the palette's step, a link's Clone, a URL in the folder field).
  useEffect(() => {
    if (!cloneRequest) return;
    const request = useClone.getState().take();
    if (!request) return;
    if (fromLater || fromSchedule) leaveQueued();
    setLinkRepo(null);
    setLinkNoFolder(false);
    // A clone never starts a session on its own: Start does, after asking about what the repository brings.
    setPendingStart(null);
    setCloneSoon(request.start);
    // Until the clone is there, no folder is picked: the strip and the lists under the box are about the clone.
    if (cwd) beforeClone.current = cwd;
    folderFromLink.current = true;
    setCwd(null);
  }, [cloneRequest]);
  /** The clone finished: its folder (a project now) is the one New session starts in. */
  const onCloned = (result: CloneResult) => {
    if (!result.root || result.root === cwd) return;
    reloadProjects();
    changeFolder(result.root);
  };
  const startClone = () => void cloneJob.wait().then(onCloned, () => {});
  useEffect(() => {
    if (!cloneSoon || !cloneForm || cloneJob.stage !== 'idle' || (!cloneJob.plan && !cloneJob.problem)) return;
    setCloneSoon(false);
    if (canClone(cloneJob.plan) && !cloneJob.problem) startClone();
  }, [cloneSoon, cloneForm, cloneJob.plan, cloneJob.problem, cloneJob.stage]);
  const closeClone = () => {
    setCloneSoon(false);
    useClone.getState().closeForm();
    // Closed without a clone: back to the project picked before.
    if (!cwd && beforeClone.current) setCwd(beforeClone.current);
    beforeClone.current = null;
  };
  /** The clone's folder, once it is there: a fresh one is worked in as it is (no worktree). */
  const clonedRoot = cloneForm && cloneJob.stage === 'done' ? cloneJob.result?.root ?? null : null;
  const freshClone = clonedRoot !== null && clonedRoot === cwd && !cloneJob.result?.reused;
  /** The form is open and Start would clone first: the box works without a folder. */
  const cloning = !!cloneForm && clonedRoot === null;

  // The link's folder is known: fill New session in from its issue or pull request, as ⌥↩ in the # list does.
  useEffect(() => {
    if (!linkGithub || !cwd || linkRepo) return;
    setLinkGithub(null);
    startFromGithub({ root: cwd, type: linkGithub.type, ref: linkGithub.ref, item: null, link: { prompt: linkGithub.prompt, autostart: linkGithub.autostart } });
  }, [linkGithub, cwd, linkRepo]);
  // Find a checkout of the link's repository among your projects and folders with sessions.
  const lookingFor = linkRepo?.state === 'looking' ? linkRepo.repo : null;
  useEffect(() => {
    if (!client || !lookingFor) return;
    let cancelled = false;
    client.call('projects.findByRepo', { repo: lookingFor }).then(
      ({ root }) => {
        if (cancelled) return;
        if (root) {
          setCwd(root);
          setLinkRepo(null);
        } else {
          setLinkRepo({ repo: lookingFor, state: 'missing' });
          setPendingStart(null);
        }
      },
      () => {
        if (cancelled) return;
        setLinkRepo({ repo: lookingFor, state: 'missing' });
        setPendingStart(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, lookingFor]);
  // Clearing the prompt ends the notices: whatever is typed next is the user's own. A queued item stays open
  // (its box emptied to type it again); Close leaves it.
  useEffect(() => {
    if (draftPrompt) return;
    if (linkPrompt !== null) setLinkPrompt(null);
    setRestored(null);
    // An issue or pull request filled in ends too; one still being read, or refused (its reason stays), doesn't.
    setFromGithub((current) => (current && !current.loading && !current.error ? null : current));
  }, [draftPrompt, linkPrompt]);
  // Another project (from any path: the picker, the palette, a project's page) leaves the issue behind.
  useEffect(() => {
    if (fromGithub && cwd !== fromGithub.request.root) setFromGithub(null);
  }, [cwd]);
  const clearPrompt = () => {
    setPendingStart(null);
    setFromGithub(null);
    setPreset({ text: '', attachments: [], context: [], seq: ++presets.current });
    setDraftPrompt('');
    setLinkPrompt(null);
    setRestored(null);
  };

  // The prompt is kept per project, with the choices made for it: picking a project with a prompt of its own brings
  // that back (and its choices); one without takes the prompt in the box along.
  // A queued item open here is kept on the queue, not as New session's prompt: no draft key while it is (nor while a
  // schedule is open).
  const draftKey = fromLater || fromSchedule ? undefined : newDraftKey(cwd);
  const hasDraft = useDrafts((s) => draftKey !== undefined && draftKey in s.drafts);
  const onDraftLoaded = (draft: ComposerDraft) => {
    setRestored(draft.seeded ? null : draft);
    if (!draft.form) return;
    touchedFor.current = cwd;
    setD(draft.form.choices);
    setProfileOverride(draft.form.profileId);
    setRunAsId(draft.form.runAs ?? null);
  };
  const onPromptChange = useCallback((text: string) => {
    setDraftPrompt(text);
    setRestored((current) => (current && draftMessage(current) !== text ? null : current));
  }, []);
  useEffect(() => {
    if (hasDraft && draftKey !== undefined) useDrafts.getState().setForm(draftKey, { choices: d, profileId: profileOverride, ...(runAsId ? { runAs: runAsId } : {}) });
  }, [draftKey, hasDraft, d, profileOverride, runAsId]);

  // A new folder starts from its project's defaults (again when they arrive or change, until the user changes something).
  useEffect(() => {
    if (!loaded || touchedFor.current === cwd) return;
    const choices = firstChoices();
    setD(worktreeFor.current === cwd && !question ? { ...choices, workspace: 'worktree' } : choices);
  }, [loaded, cwd, defaultsKey, globals, newSessionMode, autostarting, question, questionChoices]);

  // Inspect the folder (git? branch?), load its branches, and pre-warm Claude Code there.
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    setInspection(null);
    setInspectError(null);
    setGitBranches({ current: null, branches: [] });
    setGitStatus(null);
    setSavedNote(null);
    client.call('projects.inspect', { path: cwd }).then(
      (r) => !cancelled && setInspection(r),
      (error: Error) => {
        if (cancelled) return;
        setInspectError(error.message);
        // A link doesn't start in a folder that couldn't be checked; the prompt stays filled in.
        setPendingStart(null);
      },
    );
    // A quick question has no checkout: no branches to offer, no remote to catch up with.
    if (options.git) {
      client.call('git.branches', { cwd }).then(
        (r) => !cancelled && setGitBranches(r),
        () => {},
      );
      client.call('worktree.status', { cwd }).then(
        (r) => !cancelled && setGitStatus(r),
        () => {},
      );
    }
    return () => {
      cancelled = true;
    };
  }, [client, cwd, profileId, options.git]);
  // Its commands, again after skills were reloaded.
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    client.call('session.commands', { cwd, profileId }).then(
      (r) => !cancelled && setCommands(r.commands),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, profileId, commandsVersion]);
  useEffect(() => {
    if (client && cwd && shouldPrewarm(d)) void client.call('session.prewarm', { cwd, profileId });
  }, [client, cwd, d.workspace, d.branch, profileId]);

  const persist = (next: GlobalChoices, folder: string | null) => void client?.call('appState.set', { key: DEFAULTS_KEY, value: { ...next, cwd: folder } });

  // Always build on the latest state: two quick changes (folder, then model) must not undo each other.
  const update = (patch: Partial<Choices>) => {
    touchedFor.current = cwd;
    setSavedNote(null);
    setD((current) => ({ ...current, ...patch }));
    if (question) {
      // A quick question's choices are its own: they never change what a project starts with.
      const remembered = questionPatch(patch);
      if (Object.keys(remembered).length) {
        setQuestionChoices((current) => {
          const next = { ...current, ...remembered };
          void client?.call('appState.set', { key: QUESTION_DEFAULTS_KEY, value: { ...next } });
          return next;
        });
      }
      return;
    }
    const remembered = globalPatch(patch, sessionDefaults);
    if (Object.keys(remembered).length) {
      setGlobals((current) => {
        const next = { ...current, ...remembered };
        persist(next, cwd);
        return next;
      });
    }
  };
  const changeFolder = (folder: string) => {
    touchedFor.current = null;
    if (folder !== fromGithub?.request.root) setFromGithub(null);
    setLinkRepo(null);
    setLinkNoFolder(false);
    setPendingStart(null);
    setProfileOverride(null);
    setQueueWait(null);
    setQueueAuto(null);
    setStartAfterId(null);
    setCwd(folder);
    setAddAsProject(true);
    // Quick question is never the folder New session opens on next time: ⌘N stays on your last project.
    if (!isQuestionsFolder(folder, questionsDir)) persist(globals, folder);
  };

  /** Adds a folder as a project and selects it; a folder that is already a project is only selected. */
  const addFolder = async (folder: string) => {
    if (client && addOrSelect(folder, projects) === 'add' && !isQuestionsFolder(folder, questionsDir)) {
      // A folder that can't be added (gone since) is still selected: New session says what is wrong with it.
      await client.call('projects.add', { path: folder }).then(reloadProjects, () => {});
    }
    changeFolder(folder);
  };
  /** The system folder dialog, and the folder chosen there is added and selected. Cancelling changes nothing. */
  const chooseFolder = async () => {
    const picked = await window.switchboard?.pickFolder(cwd ?? undefined);
    if (picked) await addFolder(picked);
  };

  const canWorktree = options.git && (inspection?.isGitRepo ?? false) && !freshClone;
  const useWorktree = d.workspace === 'worktree' && canWorktree;
  const effectiveName = nameTouched ? worktreeName : suggestedName;
  const branch = inspection?.branch ?? (cwd ? (lastBranches.get(cwd) ?? null) : null);
  const folderBranches = useMemo(() => (cwd && inspection?.branch ? new Map(lastBranches).set(cwd, inspection.branch) : lastBranches), [lastBranches, cwd, inspection]);
  const checkoutBranch = checkoutBranchFor(d, useWorktree, gitBranches.current);
  /** A branch kept from before (a draft, the project's default) can since be checked out in another worktree. */
  const branchTaken = branchBlocked(checkoutBranch, gitBranches.checkedOutElsewhere);
  const branchOptions = d.branch && !gitBranches.branches.includes(d.branch) ? [d.branch, ...gitBranches.branches] : gitBranches.branches;
  const asDefaults = toProjectDefaults({ ...d, workspace: useWorktree ? 'worktree' : d.workspace });
  const unsaved = isProject && !sameDefaults(asDefaults, project!.defaults);
  const trayBranch = branchLabel({
    worktree: useWorktree,
    baseRef: d.baseRef,
    remote: gitStatus?.pushRemote ?? null,
    baseBranch: gitStatus?.baseBranch ?? null,
    current: gitBranches.current ?? branch,
    checkoutBranch,
    isGitRepo: inspection?.isGitRepo ?? null,
  });

  // Filled in from an issue or pull request. A pull request is worked on in a new worktree or here (after
  // `gh pr checkout`, only without changes); a fork's that Switchboard can't push back turns push and Create PR off.
  const githubPr = fromGithub?.pr ?? null;
  const githubItem = fromGithub?.issue ?? githubPr;
  const prCurrentBlocked = githubPr ? currentCheckoutBlocked(gitStatus) : null;
  const prReadOnly = githubPr ? readOnlyFork(githubPr, useWorktree ? 'worktree' : 'current') : false;
  const githubNumber = githubItem?.number ?? (fromGithub ? Number(/(\d+)\D*$/.exec(fromGithub.request.ref)?.[1] ?? 0) : 0);
  /** What `session.create` gets for it: where it came from, and a pull request's worktree or checkout. */
  const githubStart = (worktree: boolean) =>
    githubItem
      ? {
          origin: { type: githubItem.type, repo: githubItem.repo, number: githubItem.number, readOnly: githubPr ? readOnlyFork(githubPr, worktree ? 'worktree' : 'current') : false },
          ...(githubPr
            ? worktree
              ? { worktreeFrom: { branch: prBranch(githubPr), pullRequest: githubPr.number, fork: githubPr.isCrossRepository } }
              : { checkoutPullRequest: { number: githubPr.number, repo: githubPr.repo } }
            : {}),
        }
      : undefined;

  const saveAsProjectDefault = async () => {
    if (!client || !cwd) return;
    await client.call('projects.setDefaults', { root: cwd, defaults: asDefaults });
    reloadProjects();
    setSavedNote(`Saved as ${project?.name ?? basename(cwd)}'s defaults`);
  };

  // The command palette's commands for this view: what they can do here, and their requests.
  const canQueue = !!cwd && (draftPrompt.trim() !== '' || draftContext.length > 0) && !!client;
  const canCatchUp = !!cwd && inspection?.path === cwd && inspection.exists && !!gitStatus?.hasRemote && !!client;
  /** The palette's Update from remote: the git button runs its step. */
  const [catchUpRequest, setCatchUpRequest] = useState(0);
  useEffect(() => {
    usePaletteBus.setState({ newSessionInfo: { canWorktree, canSaveDefaults: unsaved, canQueue, canCatchUp, root: cwd && !question ? cwd : null } });
  }, [canWorktree, unsaved, canQueue, canCatchUp, cwd, question]);
  useEffect(() => () => usePaletteBus.setState({ newSessionInfo: null }), []);
  const paletteRequest = usePaletteBus((s) => s.newSessionRequest);
  const seenRequest = useRef(usePaletteBus.getState().newSessionRequest?.nonce ?? 0);
  useEffect(() => {
    if (!paletteRequest || paletteRequest.nonce === seenRequest.current) return;
    seenRequest.current = paletteRequest.nonce;
    if (paletteRequest.kind === 'toggle-worktree' && canWorktree) update({ workspace: useWorktree ? 'current' : 'worktree' });
    else if (paletteRequest.kind === 'save-defaults' && unsaved) void saveAsProjectDefault();
    else if (paletteRequest.kind === 'add-to-queue' && canQueue) void parkInQueue(promptWithContext(draftPrompt, draftContext, cwd), draftAttachments, { typed: draftPrompt, context: draftContext }).catch(() => {});
    else if (paletteRequest.kind === 'schedule' && canQueue && !question) openSchedule();
    else if (paletteRequest.kind === 'catch-up' && canCatchUp) setCatchUpRequest((n) => n + 1);
    else if (paletteRequest.kind === 'add-project') setAddingProject(true);
  }, [paletteRequest]);

  const pickUp = useMemo(() => (cwd ? pickUpRows(rows, cwd, Date.now(), archiveAfterDays) : []), [rows, cwd, archiveAfterDays]);
  /** The first prompts of your sessions in this project, for ↑ in the message box. */
  const promptHistory = useMemo(() => (cwd ? projectHistory(sessions.values(), cwd) : []), [sessions, cwd]);

  /** The prompt and its images with this folder and these choices, for the queue. */
  const laterDraft = (text: string, attachments: ImageAttachment[], parts?: SentParts): LaterDraft | null =>
    cwd
      ? {
          cwd,
          prompt: text,
          attachments,
          typed: parts?.typed ?? null,
          context: parts?.context ?? [],
          model: d.model || null,
          effort: d.effort || null,
          permissionMode: d.permissionMode,
          workspace: useWorktree ? 'worktree' : 'current',
          baseRef: d.baseRef,
          branch: !useWorktree && d.branch ? d.branch : null,
          profileId: profileOverride,
        }
      : null;
  // A queued item open here keeps its edits, as a session keeps its unsent message: its prompt and choices are saved
  // to the item a moment after they change. Not before its folder is checked (until then a worktree reads as the
  // current checkout), and not while the box is empty.
  const queuedNow = useLater((s) => (fromLater ? (s.items.find((i) => i.id === fromLater.id) ?? null) : null));
  const queueLoaded = useLater((s) => s.loaded);
  useEffect(() => {
    if (!fromLater || !queuedNow || inspection?.path !== cwd) return;
    const draft = laterDraft(promptWithContext(draftPrompt, draftContext, cwd), draftAttachments, { typed: draftPrompt, context: draftContext });
    forgetUnsavedQueued();
    if (!draft || draft.prompt === '' || sameDraft(queuedNow, draft)) return;
    unsavedQueued.current = { id: fromLater.id, draft, timer: setTimeout(saveQueued, 600) };
  }, [fromLater, queuedNow, inspection, cwd, draftPrompt, draftAttachments, draftContext, d, useWorktree, profileOverride]);
  // Started or removed somewhere else while open here: back to New session.
  useEffect(() => {
    if (fromLater && queueLoaded && !queuedNow) leaveQueued();
  }, [fromLater, queueLoaded, queuedNow]);

  /**
   * Adds the prompt to the queue (with what "Wait for…" says), and you stay in New session. One taken from the queue
   * goes back in its place, and the box goes back to New session's own prompt. Otherwise the caller empties the box
   * (the message box does it itself after its own button).
   */
  const queuePrompt = async (text: string, attachments: ImageAttachment[], parts?: SentParts) => {
    const draft = laterDraft(text, attachments, parts);
    if (!draft) throw new Error('Choose a folder first');
    const queuedFrom = fromLater && useLater.getState().items.some((i) => i.id === fromLater.id) ? fromLater : null;
    forgetUnsavedQueued();
    await addToQueue({ ...draft, autoStart: queueAutoOn && !queueAutoBlocked }, { waitFor: queueWait ?? undefined, replacing: queuedFrom });
    if (fromLater || fromSchedule) leaveQueued();
    else useDrafts.getState().removeDraft(newDraftKey(cwd));
    setQueueWait(null);
    setQueueAuto(null);
    setStartAfterId(null);
  };
  /** Schedule… (or Save schedule): the prompt in the box with this folder and these choices, in the schedule dialog. */
  const openSchedule = () => {
    const draft = laterDraft(promptWithContext(draftPrompt, draftContext, cwd), draftAttachments, { typed: draftPrompt, context: draftContext });
    if (draft && draft.prompt.trim()) setScheduling(draft);
  };
  /**
   * Start when…: the prompt in the box with these choices, in a new trigger for this project (#180). Saved, the box is
   * emptied, as after Schedule….
   */
  const openTrigger = () => {
    const draft = laterDraft(promptWithContext(draftPrompt, draftContext, cwd), draftAttachments, { typed: draftPrompt, context: draftContext });
    if (!draft || !draft.prompt.trim()) return;
    openTriggerEditor({
      root: projectOf(draft.cwd),
      trigger: null,
      from: { prompt: draft.prompt, model: draft.model ?? null, effort: draft.effort ?? null, permissionMode: draft.permissionMode, workspace: draft.workspace, baseRef: draft.baseRef, profileId: draft.profileId ?? null },
      onSaved: () => {
        useDrafts.getState().removeDraft(newDraftKey(cwd));
        clearPrompt();
      },
    });
  };
  /**
   * Run pipeline › (#179): the prompt is the run's task, in this project. Started, the box is emptied, as after Start
   * session, and the run's row opens. The Start button says Starting… meanwhile (making the worktree takes a moment).
   */
  const pipelineRoot = cwd ? projectOf(cwd) : null;
  const allPipelines = usePipelines((s) => s.pipelines);
  const projectPipelines = useMemo(() => pipelinesFor(allPipelines, pipelineRoot), [allPipelines, pipelineRoot]);
  // Another project without the picked pipeline, or the pipeline deleted: back to one session. Before the pipelines
  // arrive there is nothing to check against.
  useEffect(() => {
    if (allPipelines.length) setRunAsId((id) => keptRunAs(id, projectPipelines));
  }, [allPipelines, projectPipelines]);
  /** The pipeline Start runs: only where one can run (a git repository, not a question, a queued item or a schedule). */
  const canPipeline = canWorktree && !fromLater;
  const runAs = canPipeline && !question && !fromSchedule ? (projectPipelines.find((p) => p.id === runAsId) ?? null) : null;
  /** What the message box's choices are for the run: the steps that don't set their own take them. */
  const runChoices = () => ({ model: d.model && d.model !== AUTO_MODEL ? d.model : null, effort: d.effort || null, permissionMode: d.permissionMode });
  /** Starts the run; a failure is thrown, so the message box keeps the text and says why. */
  const runPipelineWith = async (pipelineId: string, text: string, attachments: ImageAttachment[]): Promise<void | false> => {
    if (!pipelineRoot || !text.trim()) return false;
    const state = await startRun({ pipelineId, task: text, attachments, project: pipelineRoot, profileId, choices: runChoices() });
    rememberPipeline(pipelineRoot, pipelineId);
    setRunAsId(null);
    useDrafts.getState().removeDraft(newDraftKey(cwd));
    useSessions.getState().select(state.run.id);
  };
  /** Saved: the box is emptied (or, for a schedule that was open, back to New session's own prompt). */
  const onScheduled = () => {
    setScheduling(null);
    setScheduleFirst(false);
    if (fromSchedule) leaveQueued();
    else {
      useDrafts.getState().removeDraft(newDraftKey(cwd));
      clearPrompt();
    }
  };
  /** The focus note's, the gate's and the palette's Add to queue: queue it and empty the box. */
  const parkInQueue = async (text: string, attachments: ImageAttachment[], parts?: SentParts) => {
    const queued = fromLater;
    await queuePrompt(text, attachments, parts);
    if (!queued) clearPrompt();
  };

  /**
   * Starts the session, after the focus limit's gate (which may ask, or save the prompt for later instead).
   * `fromLink`: started by an `autostart` link, which never adds the folder to your projects.
   * `skipGate`: Start anyway in the focus note, which already is the answer to the question.
   * `worktree`: Start's menu can start in a new worktree for once, leaving the route (and the project's default) as it is.
   * Returns false when nothing started and the prompt should stay.
   */
  const create = async (text: string, attachments: ImageAttachment[], parts: SentParts | undefined, { fromLink = false, skipGate = false, worktree = useWorktree } = {}): Promise<void | false> => {
    // With the clone form open, Start waits for the clone, then asks once about what the repository brings.
    let cloned: CloneResult | null = null;
    if (cloneForm && !fromLink) {
      try {
        cloned = await cloneJob.wait();
      } catch (error) {
        if (error instanceof CloneCancelled) return false;
        throw error;
      }
      if (!cloned.root) throw new Error('The clone has no folder here');
      onCloned(cloned);
      if (bringsAnything(cloned.brings) && !(await trust.ask(cloned.root, cloned.brings))) return false;
    }
    const folder = cloned?.root ?? cwd;
    if (!client || !folder) throw new Error('Choose a folder first');
    // A fresh clone runs in the clone, on the branch it checked out; a clone that was there already as it is.
    const fresh = cloned !== null && (folder !== cwd || !cloned.reused);
    // The same path as the palette's New session: the focus limit's gate, worktree naming, then the session.
    const outcome = await startNewSession(
      {
        cwd: folder,
        prompt: text,
        attachments,
        choices: fresh ? { ...d, branch: '', workspace: 'current' } : d,
        worktree: fresh ? false : worktree,
        worktreeName: effectiveName,
        currentBranch: gitBranches.current,
        checkedOutElsewhere: gitBranches.checkedOutElsewhere,
        profileId,
        fromLink,
        skipGate,
        addProject: !cloned && options.addAsProject && !isProject && addAsProject && !!inspection?.exists,
        saveForLater: () => parkInQueue(text, attachments, parts),
        autoEnabled: autoModel.enabled,
        github: fresh ? undefined : githubStart(worktree),
      },
      {
        createSession: (params) => client.call('session.create', params),
        gate: passFocusGate,
        addProject: (path) => client.call('projects.add', { path }).then(reloadProjects),
        keep: useDrafts.getState().keepFirstPrompt,
        open: (sessionId) => {
          // Edited from the queue and started here: it leaves the queue, and items waiting on it follow this session.
          // New session's own prompt for the project stays.
          if (cloned) closeClone();
          if (fromLater) {
            forgetUnsavedQueued();
            void removeFromQueue(fromLater, true, sessionId).catch(() => {});
            leaveQueued();
          }
          // Started once from a schedule's box: the schedule stays as it was saved.
          else if (fromSchedule) leaveQueued();
          // The view goes away before the composer empties itself, so forget the prompt and its images here (and where
          // it moved to when the clone was picked while Start waited).
          else {
            useDrafts.getState().removeDraft(newDraftKey(cwd));
            if (cloned?.root) useDrafts.getState().removeDraft(newDraftKey(cloned.root));
          }
          if (!fresh && worktree && !nameTouched) setSuggestedName(randomWorktreeName());
          if (fromGithub) {
            setFromGithub(null);
            setNameTouched(false);
            setWorktreeName('');
          }
          select(sessionId);
        },
      },
    );
    if (outcome.kind === 'stopped') return false;
  };

  // An `autostart` link: start once the folder is checked and the options are the project's defaults
  // (they settle a render after the folder changes), exactly as if the user had pressed Enter. Its
  // permission mode is the project's own default, or the default mode: never the one you last picked.
  const projectsLoaded = useProjects((s) => s.loaded);
  const settled = JSON.stringify(d) === JSON.stringify(firstChoices());
  useEffect(() => {
    if (pendingStart === null || !client || !cwd || !loaded || !projectsLoaded || !settled || lookingFor || inspection?.path !== cwd) return;
    const text = pendingStart;
    setPendingStart(null);
    // A folder that is gone can't start; the prompt stays filled in to start elsewhere.
    if (!inspection.exists) return;
    create(text, [], undefined, { fromLink: true }).catch((error: Error) => useLinks.getState().fail(`Couldn't start the session: ${error.message}`));
  }, [pendingStart, client, cwd, loaded, projectsLoaded, settled, lookingFor, inspection]);

  // Saved as Auto while Auto is off: the default model, and the note under the box says so.
  const shownModel = effectiveModel(d.model, autoModel.enabled);
  const autoOff = d.model === AUTO_MODEL && !autoModel.enabled;
  // The same chip row as in a session.
  const controls = (
    <ComposerChipRow
      profile={{
        value: profileId,
        onChange: (id) => setProfileOverride(id),
        labelFor: (p) => `${p.name}${p.id === (projectProfile ?? defaultProfile) ? (projectProfile ? ' (project)' : ' (default)') : ''}`,
      }}
      model={{
        value: shownModel,
        label: modelLabel(models, shownModel),
        onChange: (model) => update({ model }),
        choices: modelChoices(models, autoModel, <AutoWand />),
      }}
      effort={{ value: d.effort, onChange: (effort) => update({ effort }) }}
      mode={{ value: d.permissionMode, onChange: (permissionMode) => update({ permissionMode }) }}
      pipeline={runAs ? boxChoiceUse(runAs) : null}
    />
  );

  const folderProblem = !cwd
    ? cloning
      ? cloneJob.plan
        ? `Claude works in the clone of ${cloneJob.plan.repo.owner}/${cloneJob.plan.repo.name}.`
        : 'Paste a GitHub repository to clone.'
      : linkNoFolder
      ? "The link doesn't say which project. Pick where Claude should work."
      : linkRepo
      ? linkRepo.state === 'looking'
        ? `Looking for a checkout of ${linkRepo.repo}…`
        : `None of your folders is a checkout of ${linkRepo.repo}. Pick where Claude should work.`
      : folders.length
      ? 'Pick where Claude should work.'
      : 'Pick where Claude should work. Folders you add as projects are listed here.'
    : !inspection
      ? inspectError
        ? `Couldn't check this folder: ${inspectError}`
        : 'Checking folder…'
      : !inspection.exists
        ? inspection.isFile ? 'That is a file, not a folder.' : 'This folder no longer exists.'
        : null;

  const projectName = cwd ? (project?.name ?? basename(cwd)) : null;
  const savedPromptCount = useSavedPrompts(cwd && !question ? cwd : null).prompts.length;
  const clearButton = (attr: 'data-clear-link-prompt' | 'data-clear-draft') => (
    <Button variant="quiet" size="sm" onClick={clearPrompt} className="-my-1 shrink-0" {...{ [attr]: true }}>
      Clear
    </Button>
  );
  // One notice at a time, the most pressing first: a missing folder, a prompt from a link, a saved default.
  const notice =
    cwd && ((inspection && !inspection.exists) || (!inspection && inspectError)) ? (
      <span className="min-w-0 truncate text-error" data-route-hint>
        {folderProblem}
      </span>
    ) : linkPrompt !== null ? (
      <Notice inline icon={<Link2 size={13} className="text-accent-ink" aria-hidden />} actions={clearButton('data-clear-link-prompt')} data-link-notice>
        {pendingStart !== null ? 'Starting a session with the prompt from an external link…' : linkNoticeText(linkPrompt)}
      </Notice>
    ) : fromLater ? (
      <Notice
        inline
        icon={<ListEnd size={13} className="text-accent-ink" aria-hidden />}
        actions={
          <Button variant="quiet" size="sm" onClick={leaveQueued} className="-my-1 shrink-0" data-close-queued>
            Close
          </Button>
        }
        data-later-notice
      >
        Queued prompt. Changes stay in the queue; starting it takes it off.
      </Notice>
    ) : autoOff ? (
      <Notice inline icon={<AutoWand />} data-auto-off-note>
        {AUTO_OFF_NOTE}
      </Notice>
    ) : savedNote ? (
      <span role="status" className="min-w-0 truncate text-accent-ink" data-saved-note>
        {savedNote}
      </span>
    ) : null;

  // The picked project has a session going: say what a queued prompt would wait for, and let "Wait for…" change it.
  const busyHere = useMemo(() => (cwd ? busyInProject(rows, cwd) : []), [rows, cwd]);
  const queueItems = useLater((s) => s.items);
  const lastQueued = queueItems.filter((i) => i.id !== fromLater?.id).at(-1) ?? null;
  const wait: QueueWaitFor = queueWait ?? (fromLater ? (queuedNow ?? fromLater).waitFor : { kind: 'project' });
  const waitTitle = (id: string) => `“${promptLabel(rows.find((r) => r.id === id)?.title || 'Untitled session', 60)}”`;
  const queueStarted = useLater((s) => s.started);
  /** Start by itself: what was picked here, else the open item's, else off. */
  const queueAutoOn = queueAuto ?? (fromLater ? (queuedNow ?? fromLater).autoStart : false);
  const queueAutoBlocked = useMemo(() => (cwd ? autoStartBlock(wait, { cwd, sessions: rows.map(queueSession), started: queueStarted }) : null), [wait, cwd, rows, queueStarted]);
  const startsByItself = queueAutoOn && !queueAutoBlocked;
  const waitText =
    wait.kind === 'none'
      ? 'Queued, you start this one yourself.'
      : wait.kind === 'session'
        ? `Queued, this waits for ${waitTitle(wait.sessionId)} to finish.`
        : wait.kind === 'item'
          ? 'Queued, this waits for the item above it.'
          : busyHere.length === 1
            ? `Queued, this waits for ${waitTitle(busyHere[0]!.id)} to finish.`
            : 'Queued, this waits for them to finish.';
  // Shown while the project has a session working, or once Wait for names a session or the item above.
  const queueLine = cwd && projectName && (busyHere.length > 0 || wait.kind === 'session' || wait.kind === 'item') && (
    <div className="-mt-3 flex min-w-0 items-center gap-1.5 px-2 text-meta text-muted" data-queue-busy-line>
      {startsByItself ? <Play size={11} fill="currentColor" className="shrink-0 text-link" aria-hidden /> : <Clock size={12} className="shrink-0 text-faint" aria-hidden />}
      <span className="min-w-0 truncate">
        {busyHere.length > 0 && `${projectName} has ${busyHere.length === 1 ? 'a session' : `${busyHere.length} sessions`} working. `}
        {waitText}
      </span>
      <button
        type="button"
        onClick={(e) => waitMenu.openBelow(e.currentTarget)}
        aria-haspopup="menu"
        className="flex shrink-0 items-center gap-0.5 rounded px-1 font-medium text-link hover:underline"
        data-queue-wait-for
      >
        Wait for…
        <ChevronDown size={11} aria-hidden />
      </button>
      <Checkbox
        checked={startsByItself}
        disabledReason={queueAutoBlocked}
        onChange={(next) => {
          setQueueAuto(next);
          // A queued item open here takes the change at once, like Wait for.
          if (queuedNow) void setAutoStart(queuedNow, next).catch(() => {});
        }}
        className="ml-1 shrink-0 items-center text-meta text-text"
        dataAttrs={{ 'data-queue-autostart-box': true }}
      >
        Start by itself
      </Checkbox>
      {waitMenu.at && (
        <Menu
          x={waitMenu.at.x}
          y={waitMenu.at.y}
          width={260}
          label="Wait for"
          entries={waitForEntries({
            current: wait,
            busy: busyHere,
            above: lastQueued,
            // A queued item open here takes the change at once, like its other edits.
            onPick: (next) => {
              setQueueWait(next);
              if (queuedNow) void setWaitFor(queuedNow, next).catch(() => {});
            },
          })}
          onClose={waitMenu.close}
        />
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-drop-zone>
      {/* No title bar: the heading names the view. The strip keeps the window draggable. */}
      <div className="drag flex h-13 shrink-0 items-center justify-between px-4">
        <SidebarToggle />
        {cwd && !question && inspection?.path === cwd && inspection.exists && (
          <div className="flex items-center gap-2">
            {/* Your copy may be behind the remote: catch up before Claude starts from it. */}
            {gitStatus && <CatchUpButton cwd={cwd} status={gitStatus} onStatus={setGitStatus} request={catchUpRequest} />}
            {/* To look around the whole project before (or instead of) asking Claude. */}
            <OpenInButton path={cwd} shortcut={false} />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-2 pb-12" data-new-session-view>
          <div className="text-center">
            {/* The one hero heading in the app, a little larger than text-title. */}
            <h1 className="text-hero leading-tight font-semibold">Where do we start?</h1>
            <p className="mt-1 text-ui text-muted">
              <Kbd keys={comboPresses(keysOf('new-session.pick'))[0]!} /> to <Kbd keys={comboPresses(keysOf('new-session.pick')).at(-1)!} /> picks a project, or start typing its name
            </p>
            {/* With a paired computer: where Claude runs. */}
            <div className="mt-3">
              <RunOnSwitch />
            </div>
          </div>

          {cloneForm ? (
            <ClonePanel
              url={cloneForm.url}
              name={cloneForm.name}
              job={cloneJob}
              onUrl={(url) => useClone.getState().editForm({ url })}
              onName={(name) => useClone.getState().editForm({ name })}
              onStart={startClone}
              onClose={closeClone}
              closeLabel={clonedRoot ? 'Done' : 'Pick a project instead'}
            />
          ) : (
          <FolderPicker
            value={question ? null : cwd}
            question={questionsDir ? { selected: question, onSelect: () => changeFolder(questionsDir) } : null}
            folders={ordered}
            home={home}
            branches={folderBranches}
            statusOf={statusOf}
            onChange={changeFolder}
            onAdd={(folder) => void addFolder(folder)}
            onAddProject={() => setAddingProject(true)}
            onChooseOther={() => void chooseFolder()}
            shortcuts={view === 'new'}
            openRequest={pickerRequest}
            onClone={cloneEnabled ? (url, start) => useClone.getState().cloneInNewSession(url ?? '', { start }) : undefined}
          />
          )}
          {trust.dialog}

          {addingProject && <AddProjectDialog onClose={() => setAddingProject(false)} onDone={(root) => root && changeFolder(root)} />}

          {/* At the focus limit: what is going, with Open, and a way to park this idea. Start asks first (Nudge) or waits (Strict). */}
          {atLimit && (
            <FocusNote
              focus={focus}
              now={now}
              canSave={canQueue}
              onSaveForLater={() => void parkInQueue(promptWithContext(draftPrompt, draftContext, cwd), draftAttachments, { typed: draftPrompt, context: draftContext }).catch(() => {})}
              onStartAnyway={() => setSubmitRequest((n) => n + 1)}
            />
          )}

          {restored && (
            <DraftBanner
              text={newSessionDraftBanner(projectName, restored, Date.now())}
              className="-mb-3"
              onDiscard={() => {
                if (draftKey !== undefined) useDrafts.getState().removeDraft(draftKey);
                clearPrompt();
              }}
            />
          )}

          {fromGithub && (fromGithub.request.link || fromGithub.error) && (
            <div className="-mb-2 grid gap-2" data-from-link-banner={fromGithub.request.link ? true : undefined}>
              {fromGithub.request.link && (
                <Notice tone="info" icon={<GitBranch size={14} aria-hidden />}>
                  {linkBanner(fromGithub.request.type, githubNumber)}
                </Notice>
              )}
              {fromGithub.request.link?.autostart && (
                <Notice tone="caution" icon={<TriangleAlert size={14} aria-hidden />} data-from-link-no-autostart>
                  {NO_AUTOSTART}
                </Notice>
              )}
              {fromGithub.error && (
                <Notice tone="error" data-github-start-error>
                  {fromGithub.error}
                </Notice>
              )}
            </div>
          )}

          {!fromLater && <PromptChips root={cwd && !question ? cwd : null} draftKey={draftKey} />}

          {/* The message box with its route strip on top: the strip's bottom edge is the card's top border.
              With a folder picked, the whole card takes its project's colour, with a faint ring around it. */}
          <div
            className="rounded-xl transition-shadow [&>div>.rounded-xl]:rounded-t-none"
            style={projectColor ? { boxShadow: `0 0 0 4px color-mix(in srgb, ${projectColor} 14%, transparent)` } : undefined}
            data-project-color={projectColor ?? undefined}
          >
            <div
              className="flex min-h-10 min-w-0 items-center gap-1 rounded-t-xl border border-b-0 border-border bg-border/25 px-1.5 py-1 transition-colors"
              style={projectColor ? { borderColor: projectColor } : undefined}
              data-route-tray
            >
              {/* Where and branch depend on the folder: until there is one, say why instead of showing empty controls. */}
              {!cwd ? (
                <>
                  <span className="min-w-0 flex-1 px-1.5 py-0.5 text-ui text-muted" data-route-placeholder data-route-hint>
                    {folderProblem}
                  </span>
                  {/* No checkout of the link's repository: clone it, with the link's prompt kept for Start. */}
                  {linkRepo?.state === 'missing' && cloneEnabled && !cloneForm && (
                    <Button size="sm" onClick={() => useClone.getState().cloneInNewSession(`https://github.com/${linkRepo.repo}`, { start: true })} className="shrink-0" data-link-clone>
                      Clone {linkRepo.repo}
                    </Button>
                  )}
                </>
              ) : question ? (
                // No project and no git: nothing to choose about where Claude works.
                <>
                  <button
                    type="button"
                    onClick={() => setPickerRequest((n) => n + 1)}
                    aria-label={`${QUESTION_LABEL}. Pick a project instead`}
                    data-tooltip="Pick a project instead"
                    data-route-project
                    data-route-question
                    className="flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-ui font-semibold text-text hover:bg-border/50"
                  >
                    <ProjectIcon project={project} root={cwd} size={16} />
                    <span className="truncate">{QUESTION_LABEL}</span>
                  </button>
                  <span aria-hidden className="text-faint">
                    /
                  </span>
                  <span className="min-w-0 truncate px-1.5 text-ui text-muted" data-tooltip={cwd} data-route-question-note>
                    No project or git. Claude works in a scratch folder.
                  </span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPickerRequest((n) => n + 1)}
                    aria-label={`Project: ${projectName}. Change project`}
                    data-tooltip={cwd}
                    data-route-project
                    className="flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 text-ui font-semibold text-text hover:bg-border/50"
                  >
                    <ProjectIcon project={project} root={cwd} size={16} />
                    <span className="truncate">{projectName}</span>
                  </button>
                  <span aria-hidden className="text-faint">
                    /
                  </span>
                  <ChoiceMenu
                    name="workspace"
                    value={useWorktree ? 'worktree' : 'current'}
                    onChange={(workspace) => update({ workspace })}
                    title={routeHint({ worktree: useWorktree, isGitRepo: canWorktree, branch: githubPr ? prBranch(githubPr) : (checkoutBranch ?? branch), name: effectiveName })}
                    heading={githubPr ? `Work on #${githubPr.number} in` : 'Where'}
                    chevron
                    width={githubPr ? 340 : 300}
                    choices={
                      githubPr
                        ? [
                            { value: 'current', label: 'Current checkout', description: prCurrentBlocked ?? `Checks out ${githubPr.headRefName} here first`, disabled: prCurrentBlocked !== null },
                            { value: 'worktree', label: 'New worktree from the pull request', description: canWorktree ? `Branch ${prBranch(githubPr)}, at the pull request's latest commit` : 'Needs a git repository', disabled: !canWorktree },
                          ]
                        : [
                            { value: 'current', label: 'Current checkout', description: 'Edits land in your working copy' },
                            { value: 'worktree', label: 'New worktree', description: canWorktree ? 'Isolated copy, branched from the one you pick' : 'Needs a git repository', disabled: !canWorktree },
                          ]
                    }
                    extra={
                      (useWorktree || prReadOnly) && (
                        <>
                        {prReadOnly && githubPr && (
                          <p className="mx-3 mt-1 mb-1 flex items-start gap-1.5 text-meta text-caution" data-github-fork-caution>
                            <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
                            {forkCaution(githubPr.number)}
                          </p>
                        )}
                        {useWorktree && (
                        <label
                          className="mx-3 mt-1 mb-1 flex h-6 items-center rounded-md border border-border bg-bg px-2 font-mono text-meta focus-within:border-accent-ink"
                          data-tooltip={`Branch ${githubPr ? prBranch(githubPr) : `worktree-${effectiveName}`} in .claude/worktrees/${effectiveName}`}
                        >
                          {!githubPr && <span className="text-faint">worktree-</span>}
                          <input
                            data-worktree-name
                            aria-label="Worktree name"
                            className="w-full min-w-0 bg-transparent text-text outline-none placeholder:text-faint"
                            value={nameTouched ? worktreeName : ''}
                            placeholder={suggestedName}
                            spellCheck={false}
                            onChange={(e) => {
                              setNameTouched(e.target.value !== '');
                              setWorktreeName(e.target.value.replace(/[^A-Za-z0-9._-]/g, '-'));
                            }}
                          />
                        </label>
                        )}
                        </>
                      )
                    }
                    actions={
                      isProject
                        ? [{ label: 'Save as project default', hint: unsaved ? undefined : 'Saved', disabled: !unsaved, data: { 'data-save-project-defaults': true }, onSelect: () => void saveAsProjectDefault() }]
                        : undefined
                    }
                  >
                    {useWorktree ? <FolderGit2 size={14} className="shrink-0" aria-hidden /> : <Folder size={14} className="shrink-0" aria-hidden />}
                    <span>{useWorktree ? 'New worktree' : 'Current checkout'}</span>
                  </ChoiceMenu>

                  {githubPr ? (
                    <span className="flex min-w-0 items-center gap-1.5 px-2 font-mono text-ui text-muted" data-tooltip={useWorktree ? `The pull request's branch, at its latest commit` : `gh pr checkout ${githubPr.number} switches this folder to it`}>
                      <GitBranch size={14} className="shrink-0" aria-hidden />
                      <span className="truncate" data-route-branch>
                        {useWorktree ? prBranch(githubPr) : githubPr.headRefName}
                      </span>
                    </span>
                  ) : useWorktree ? (
                    <ChoiceMenu
                      name="base"
                      value={d.baseRef}
                      onChange={(baseRef) => update({ baseRef })}
                      title="The branch the new worktree starts from"
                      heading="Branch from"
                      chevron
                      mono
                      search="Search branches"
                      width={300}
                      choices={[
                        { value: 'fresh', label: freshBase(gitStatus?.pushRemote ?? null, gitStatus?.baseBranch ?? null), note: 'default', description: "Claude Code's default" },
                        { value: 'head', label: gitBranches.current ?? 'HEAD', note: 'local HEAD', description: 'Includes your unpushed commits' },
                      ]}
                    >
                      <GitBranch size={14} className="shrink-0" aria-hidden />
                      <span className="truncate" data-route-branch>
                        {trayBranch}
                      </span>
                    </ChoiceMenu>
                  ) : gitBranches.branches.length > 0 ? (
                    <ChoiceMenu
                      name="branch"
                      value={checkoutBranch ?? gitBranches.current ?? ''}
                      onChange={(b) => update({ branch: b === gitBranches.current ? '' : b })}
                      title="Check out a branch before the session starts. Git keeps uncommitted changes, or refuses when they conflict."
                      heading="Branch"
                      chevron
                      mono
                      search="Search branches"
                      width={300}
                      choices={[
                        ...(gitBranches.current ? [] : [{ value: '', label: 'Stay on the current checkout' }]),
                        ...filterBranches(branchOptions, gitBranches.current, '').map((b) => ({ value: b, label: b, note: branchNote(b, gitBranches.current, gitStatus?.behindUpstream ?? null), ...(gitBranches.checkedOutElsewhere?.includes(b) ? { disabled: true, description: ELSEWHERE_NOTE } : {}) })),
                      ]}
                    >
                      <GitBranch size={14} className="shrink-0" aria-hidden />
                      <span className="truncate" data-route-branch>
                        {trayBranch}
                      </span>
                    </ChoiceMenu>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1.5 px-2 text-ui text-muted">
                      <GitBranch size={14} className="shrink-0" aria-hidden />
                      <span className="truncate" data-route-branch>
                        {trayBranch}
                      </span>
                    </span>
                  )}

                  <span className="flex-1" />
                  {/* The quick way to the most common route change; the menu has the details (base, name). */}
                  <label
                    className={`flex shrink-0 items-center gap-2 px-1.5 text-ui ${canWorktree ? 'cursor-pointer text-muted' : 'text-faint'}`}
                    data-tooltip={canWorktree ? 'Work in an isolated copy of the repository' : 'Needs a git repository'}
                  >
                    Worktree
                    <Switch checked={useWorktree} disabled={!canWorktree} onChange={(on) => update({ workspace: on ? 'worktree' : 'current' })} dataAttrs={{ 'data-worktree-switch': true }} />
                  </label>
                </>
              )}
            </div>

            {/* A queued item gets a box of its own: opening or leaving one never touches New session's prompt. */}
            <Composer
              key={fromLater ? `queued:${fromLater.id}` : fromSchedule ? `schedule:${fromSchedule.id}` : 'new'}
              draftKey={draftKey}
              carryOver
              savedPrompts={{ root: cwd && !question ? cwd : null, projectName: projectName ?? 'This project' }}
              links={{ sessionId: null, root: cwd }}
              github={{ root: cwd && !question ? cwd : null }}
              onDraftLoaded={onDraftLoaded}
              restored={restored !== null}
              history={promptHistory}
              onTextChange={onPromptChange}
              onAttachmentsChange={setDraftAttachments}
              cwd={cwd}
              commands={commands}
              placeholder={question ? 'Ask Claude anything' : savedPromptCount > 0 ? 'What should Claude work on? Type / for saved prompts.' : 'What should Claude work on?'}
              large
              frameColor={projectColor}
              autoFocus
              focusRequest={focusRequest}
              submitRequest={submitRequest}
              preset={preset}
              localContext
              onContextChange={setDraftContext}
              controls={controls}
              onCycleMode={() => update({ permissionMode: nextMode(d.permissionMode) })}
              disabledReason={!client ? 'Connecting to the engine…' : cloning ? (canClone(cloneJob.plan) || cloneJob.stage === 'running' ? null : (cloneJob.problem ?? (cloneJob.plan ? planLine(cloneJob.plan, null).text : 'Paste a GitHub repository first'))) : !cwd ? 'Choose a folder first' : inspection && !inspection.exists ? (inspection.isFile ? 'That is a file, not a folder' : 'That folder no longer exists') : null}
              onSubmit={(text, attachments, requested, parts) => {
                // Scheduling, Enter opens the dialog rather than starting a session; the text stays in the box.
                if (scheduleFirst && !question && !fromLater && !runAs) {
                  openSchedule();
                  return false;
                }
                // A pipeline picked in Run as: Enter runs it, with the text as its task.
                if (runAs) return runPipelineWith(runAs.id, text, attachments);
                return create(text, attachments, parts, { skipGate: requested === true });
              }}
              secondary={{ shortcut: 'new-session.queue', onSubmit: (text, attachments, parts) => queuePrompt(text, attachments, parts) }}
              submitControl={(box) => (
                <>
                  {canPipeline && !question && !fromSchedule && projectPipelines.length > 0 && (
                    <RunAsChip pipelines={projectPipelines} value={runAs} onChange={setRunAsId} root={pipelineRoot} openRequest={runAsMenu} disabled={box.sending} />
                  )}
                  <StartButton
                    state={startButtonState({
                      ...box,
                      startBlocked,
                      branchBlocked: branchTaken ?? (githubPr && !useWorktree ? prCurrentBlocked : null),
                      canWorktree,
                      worktree: useWorktree,
                      question,
                      // Opened with Start after this one…: queueing is what it is for.
                      queueFirst: startAfterId !== null && wait.kind === 'session' && wait.sessionId === startAfterId,
                      canSchedule: true,
                      canTrigger: !fromLater,
                      canPipeline,
                      runAs,
                      scheduleFirst: scheduleFirst && !fromLater,
                      editingSchedule: fromSchedule !== null,
                    })}
                    onAction={(action) =>
                      action === 'queue'
                        ? box.submitSecondary()
                        : action === 'schedule'
                          ? openSchedule()
                          : action === 'trigger'
                            ? openTrigger()
                            : action === 'start-worktree'
                              ? box.submitWith((text, attachments, parts) => create(text, attachments, parts, { worktree: true }))
                              : action === 'start-one'
                                ? (setRunAsId(null), box.submitWith((text, attachments, parts) => create(text, attachments, parts)))
                                : action === 'pipeline' && runAs
                                  ? box.submitWith((text, attachments) => runPipelineWith(runAs.id, text, attachments))
                                  : box.submit()
                    }
                    data={{ 'data-composer-submit': true }}
                  />
                </>
              )}
            />
          </div>

          {/* What Start will run: a pipeline's steps, once there is a task. */}
          {runAs && draftPrompt.trim() !== '' && <RunAsSteps name={runAs.name} steps={runAsSteps(runAs, modelWord(shownModel === AUTO_MODEL ? null : shownModel || null))} onChange={() => setRunAsMenu((n) => n + 1)} />}

          {/* A container: as the column narrows, the usage drops its reset times, then its bars. */}
          <div className="@container -mt-2 flex min-h-5 items-center justify-between gap-4 px-2 text-meta text-muted" data-tray-footer>
            <span className="flex min-w-0 items-center">{notice}</span>
            <span className="min-w-0 shrink-0">
              <UsageBand tray profileId={profileId} />
            </span>
          </div>

          {/* Its own line, so it is read whole: what starting from an issue or pull request does, and doesn't. */}
          {githubItem && (
            <p className="-mt-3 flex items-center justify-center gap-1.5 px-2 text-center text-meta text-muted" data-github-start-note>
              <ShieldCheck size={13} className="shrink-0" aria-hidden />
              {startNote(githubItem.type)}
            </p>
          )}

          {queueLine}

          {cwd && options.addAsProject && !isProject && inspection?.exists && (
            <Checkbox checked={addAsProject} onChange={setAddAsProject} className="-mt-3 w-fit px-2 text-meta text-muted" dataAttrs={{ 'data-add-as-project': true }}>
              Add {basename(cwd)} to your projects
            </Checkbox>
          )}

          {cwd && pickUp.length > 0 && (
            <section aria-label={`Pick up in ${projectName}`} data-pick-up>
              <SectionHeader as="h2" className="px-2">
                Pick up in {projectName}
              </SectionHeader>
              <ul className="mt-1 grid">
                {pickUp.map((row) => {
                  const status = rowStatus(row);
                  const dot = status === 'needs-you' ? 'bg-warn' : status === 'running' ? 'bg-accent-ink animate-pulse' : status === 'unread' ? 'bg-unread' : 'bg-faint/50';
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => select(row.id)}
                        className="flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left hover:bg-border/45"
                        data-pick-up-session={row.id}
                      >
                        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
                        <span className="min-w-0 flex-1 truncate text-ui text-text">{row.title || 'Untitled session'}</span>
                        {status === 'needs-you' && <span className="shrink-0 text-meta text-warn">Needs you</span>}
                        {status === 'running' && <span className="shrink-0 text-meta text-accent-ink">Working</span>}
                        <span className="shrink-0 text-meta text-faint tabular-nums">{shortAge(row.updatedAt)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {cwd && projectName && <QueuedInProject cwd={cwd} projectName={projectName} now={now} />}
        </div>
      </div>
      {scheduling && <ScheduleDialog draft={scheduling} schedule={fromSchedule} onClose={() => setScheduling(null)} onSaved={onScheduled} />}
    </div>
  );
}
