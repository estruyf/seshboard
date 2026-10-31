import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, KeyboardOff, ListTree, Search, SlidersHorizontal, X } from 'lucide-react';
import { AUTO_MODEL, keptRunAs, pipelineMeta, REMOTE_FEATURE_BRANCHES, REMOTE_FEATURE_PIPELINES, runAsLabel, runAsOrder, runAsSteps, type RemoteBranches, type RemoteOptions, type RemotePermissionMode, type RemotePipeline, type RemoteProject, type RemoteSession } from '@seshboard/protocol/remote-client';
import { checkoutBranch } from '../lib/branches.ts';
import { lastPipeline, rememberPipeline } from '../lib/runs.ts';
import { ChoiceChip } from './ChoiceChip.tsx';
import { clearDraft, loadDraft, saveDraft, type DraftKey } from '../lib/drafts.ts';
import { projectStatus, recentProjects, suggestedProject, type TileTone } from '../lib/groups.ts';
import { useFinePointer, useWide } from '../lib/media.ts';
import { autoOn, changedFrom, defaultChoice, EFFORT_LABEL, MODE_SHORT, modelLabel, profilesOf, projectProfile, takesEffort, type Choice } from '../lib/options.ts';
import { optionsSummary, providerSummary, startState, type SummaryPart } from '../lib/newOptions.ts';
import { lastProject, rememberProject, rememberRunOn } from '../lib/storage.ts';
import type { ConnectionState } from '../lib/connection.ts';
import { AttachButton, AttachmentTray, useAttachments } from './Attachments.tsx';
import type { Client } from './Connected.tsx';
import { BranchChip, EffortChip, ModeChip, ModelChip, ProfileChip, ProviderModeChip, ProviderModelChip, WorkspaceChip } from './OptionChips.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toasts.tsx';
import { Button, Kbd, RoundButton } from './ui.tsx';

/** A computer New session can start on: its name, its connection, what it takes and its sessions. */
export interface RunOnComputer {
  id: string;
  name: string;
  state: ConnectionState;
  client: Client;
  features: readonly string[];
  sessions: readonly RemoteSession[];
}

const RUN_ON_DOT: Record<ConnectionState['kind'], string> = { connected: 'bg-ok', connecting: 'bg-caution', offline: 'bg-error', disconnected: 'bg-faint', unpaired: 'bg-error' };
const RUN_ON_AWAY: Record<ConnectionState['kind'], string> = { connected: '', connecting: 'Connecting…', offline: 'Offline', disconnected: 'Disconnected', unpaired: 'Pair again' };
import { useVisualViewport } from './useVisualViewport.ts';

const TONE_DOT: Record<TileTone, string> = { 'needs-you': 'bg-warn', working: 'bg-accent-ink', idle: 'bg-faint' };
const TONE_TEXT: Record<TileTone, string> = { 'needs-you': 'text-warn', working: 'text-accent-ink', idle: 'text-muted' };
/** More than this and a filter field shows above the tiles (in the sheet on a phone). */
const FILTER_FROM = 7;
/** More than this don't fit across a phone: All projects opens them as a list. */
const LIST_FROM = 3;
/** What you typed survives going back to the list and coming back, until the session starts. */
const DRAFT: DraftKey = { kind: 'new' };

/**
 * New session in one of your projects, the ones you added in Seshboard. The tiles (one row that scrolls sideways)
 * say what's going on in each, most recent first; the project you last started in (or the one with the newest session)
 * is picked for you, so most of the time you only type. On a phone, All projects opens them as a list in a sheet, with
 * the filter there, so the keyboard doesn't come up over the tiles. Under the prompt, the project's profile (with more than one)
 * and its defaults for model, effort, mode and worktree as chips, to change for this session only. In the project's folder,
 * the branch checked out there, or another to check out first (`REMOTE_FEATURE_BRANCHES`). Queue for later puts it in Seshboard's queue instead,
 * while the project has a session working. While the keyboard is up on a phone, only the prompt and the buttons stay: the
 * view takes what the keyboard leaves (as the session's message box does, `lib/viewport.ts`), so Start session sits
 * right above it, and Hide keyboard brings the tiles and the chips back.
 *
 * With more than one computer, Run on picks the one it starts on, as on the computer: its projects become the tiles,
 * and what you typed stays. A computer that isn't connected stays in the switch, disabled, saying why.
 *
 * On a phone it is simpler: a round × to close, the project as one row (Change opens the list), the box, one Options
 * row that sums up the choices (what differs from the project's defaults in the accent colour, `lib/newOptions.ts`)
 * with a sheet of rows behind it, and Start session as the floating pill Home has, dim until there is text.
 */
export function NewSession({ computers, computer, onComputer, banner, onBack, lead = null, onStarted, initialProject = null }: { /** Every paired computer. */ computers: readonly RunOnComputer[]; /** The id of the one it starts on: New session remembers its last project per computer. */ computer: string; /** Run on picked another computer. */ onComputer: (id: string) => void; banner: ReactNode; onBack: (() => void) | null; /** In Back's place on a wide screen whose sidebar folded away: the drawer button. */ lead?: ReactNode; onStarted: (computer: string, sessionId: string) => void; /** Picked from the palette (New session in <project>). */ initialProject?: string | null }) {
  const target = computers.find((c) => c.id === computer) ?? computers[0]!;
  const { client, features, sessions } = target;
  const runOn = computers.length > 1;
  const [projects, setProjects] = useState<RemoteProject[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(initialProject);
  const [filter, setFilter] = useState('');
  const [prompt, setPrompt] = useState(() => loadDraft(DRAFT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<RemoteOptions | null>(null);
  /** What you changed for this session, over the project's defaults. */
  const [changes, setChanges] = useState<Partial<Choice>>({});
  /** The project folder's branches (null: not read yet, or the computer can't say), and one picked to check out first. */
  const [branches, setBranches] = useState<RemoteBranches | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  /** The project's pipelines (`REMOTE_FEATURE_PIPELINES`), and the one Run as picked: Start runs it with the prompt as its task. */
  const [pipelines, setPipelines] = useState<RemotePipeline[]>([]);
  const [runAs, setRunAs] = useState<string | null>(null);
  /** A provider profile's (GitHub Copilot's) own model and mode, picked for this session. */
  const [providerModel, setProviderModel] = useState<string | null>(null);
  const [providerMode, setProviderMode] = useState<RemotePermissionMode | null>(null);
  /** Whether the provider profile picked can start a session there, and its models (null while it is asked). */
  const [providerReady, setProviderReady] = useState<{ profileId: string; problem: string | null; models: RemoteOptions['models'] } | null>(null);
  const attachments = useAttachments({ features, newSession: true, onError: setError });
  const fine = useFinePointer();
  const wide = useWide();
  const [listOpen, setListOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  /** The prompt has focus on a phone's touch screen: the keyboard is up. */
  const [focused, setFocused] = useState(false);
  const typing = focused && !fine && !wide;
  const frame = useVisualViewport(typing);
  /** Keeps the prompt focused when a footer button is tapped, so the layout doesn't jump back under your finger. */
  const keepFocus = typing ? (event: { preventDefault: () => void }) => event.preventDefault() : undefined;
  // Read when the projects arrive, without loading them again each time a session changes.
  const latest = useRef(sessions);
  latest.current = sessions;

  // Another computer has its own projects, defaults and branches: what you picked was for the one before.
  const shownFor = useRef(computer);
  useEffect(() => {
    if (shownFor.current === computer) return;
    shownFor.current = computer;
    setProjects(null);
    setProjectId(null);
    setOptions(null);
    setChanges({});
    setError(null);
    setListOpen(false);
    setProviderModel(null);
    setProviderMode(null);
  }, [computer]);


  useEffect(() => {
    if (!client) return;
    let live = true;
    void client.call('projects.list', {}).then(
      ({ projects }) => {
        if (!live) return;
        setProjects(projects);
        setProjectId((current) => (current && projects.some((p) => p.id === current) ? current : suggestedProject(projects, latest.current, lastProject(computer))));
      },
      (e: Error) => live && setError(e.message),
    );
    void client.call('options.get', {}).then((next) => live && setOptions(next), () => {});
    return () => {
      live = false;
    };
  }, [client, computer]);

  // Another project has its own branches.
  const takesBranch = features.includes(REMOTE_FEATURE_BRANCHES);
  useEffect(() => {
    setBranches(null);
    setBranch(null);
    if (!client || !projectId || !takesBranch) return;
    let current = true;
    void client.call('projects.branches', { projectId }).then(
      (result) => current && setBranches(result),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [client, projectId, takesBranch]);

  // Another project has its own pipelines; the one picked stays while this project can run it too.
  const takesPipelines = features.includes(REMOTE_FEATURE_PIPELINES);
  useEffect(() => {
    if (!client || !projectId || !takesPipelines) {
      setPipelines([]);
      setRunAs(null);
      return;
    }
    let current = true;
    void client.call('pipelines.list', { projectId }).then(
      (result) => {
        if (!current) return;
        setPipelines(result.pipelines);
        setRunAs((picked) => keptRunAs(picked, result.pipelines));
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [client, projectId, takesPipelines]);

  // With a keyboard, the box is ready to type in; on a phone the keyboard waits for a tap.
  useEffect(() => {
    if (fine) box.current?.focus();
  }, [fine]);

  useEffect(() => saveDraft(DRAFT, prompt), [prompt]);

  const pick = (id: string) => {
    // Another project has its own defaults: what you changed was for the one before.
    if (id !== projectId) setChanges({});
    setProjectId(id);
    if (fine) box.current?.focus();
  };
  /** Picked in the list: its tile comes into view, so the row shows what you picked. */
  const pickFromList = (id: string) => {
    pick(id);
    setListOpen(false);
    requestAnimationFrame(() => row.current?.querySelector(`[data-remote-project="${CSS.escape(id)}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }));
  };

  // Another profile brings its defaults, under the project's own and what you changed.
  const baseProfile = projectProfile(options, projectId);
  const defaults = defaultChoice(options, projectId, changes.profileId ?? baseProfile);
  const choice: Choice = { ...defaults, ...changes };
  const change = (next: Partial<Choice>) => setChanges((current) => ({ ...current, ...next }));
  const checkout = checkoutBranch(branch, branches, choice.worktree);
  const withBranch = checkout ? { checkoutBranch: checkout } : {};
  // The profile picks who runs it: a profile of another provider (GitHub Copilot) leaves only that provider's options.
  const provider = (options ? profilesOf(options).find((p) => p.id === choice.profileId)?.provider : undefined) ?? null;
  const providerProfileId = provider ? choice.profileId : null;
  const providerModeNow = provider ? (providerMode && provider.modes.some((m) => m.value === providerMode) ? providerMode : (provider.modes[0]?.value ?? 'default')) : null;
  /** Why the provider can't start a session now (its own words), or that it is being asked. */
  const providerBlocked = provider ? (providerReady?.profileId === providerProfileId ? providerReady!.problem : `Checking ${provider.name}…`) : null;
  const providerModels = providerReady && providerReady.profileId === providerProfileId ? providerReady.models : [];
  // Picking a provider profile asks the computer whether it can run a session now (it starts the provider there).
  useEffect(() => {
    setProviderReady(null);
    if (!client || !providerProfileId) return;
    let current = true;
    void client.call('providers.ready', { profileId: providerProfileId }).then(
      (result) => current && setProviderReady({ profileId: providerProfileId, ...result }),
      (e: Error) => current && setProviderReady({ profileId: providerProfileId, problem: e.message, models: [] }),
    );
    return () => {
      current = false;
    };
  }, [client, providerProfileId]);
  const ready = Boolean(client && projectId && prompt.trim() && !busy && !attachments.reading && !providerBlocked);
  // A pipeline's steps are Claude Code's: none with another provider.
  const pipeline = provider ? null : (pipelines.find((p) => p.id === runAs) ?? null);
  /** Run as a pipeline: the prompt is its task, and the box's choices go to the steps that don't set their own. */
  const startRun = async (picked: RemotePipeline) => {
    const { worktree: _worktree, ...choices } = changedFrom(choice, defaults, baseProfile);
    const { state } = await client!.call('pipelines.run', { pipelineId: picked.id, projectId: projectId!, task: prompt.trim(), ...(attachments.images.length ? { images: attachments.images } : {}), ...(attachments.files.length ? { files: attachments.files } : {}), ...choices });
    rememberPipeline(computer, projectId!, picked.id);
    return state.run.id;
  };
  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (pipeline) {
        const runId = await startRun(pipeline);
        rememberProject(computer, projectId!);
        if (runOn) rememberRunOn(computer);
        clearDraft(DRAFT);
        onStarted(computer, runId);
        return;
      }
      const files = { ...(attachments.images.length ? { images: attachments.images } : {}), ...(attachments.files.length ? { files: attachments.files } : {}) };
      // Another provider takes only its model and mode; Claude Code the choices that differ from the project's defaults.
      const { sessionId } = await client!.call(
        'session.create',
        provider
          ? { projectId: projectId!, prompt: prompt.trim(), ...files, profileId: choice.profileId, model: providerModel, permissionMode: providerModeNow! }
          : { projectId: projectId!, prompt: prompt.trim(), ...files, ...changedFrom(choice, defaults, baseProfile), ...withBranch },
      );
      rememberProject(computer, projectId!);
      if (runOn) rememberRunOn(computer);
      clearDraft(DRAFT);
      onStarted(computer, sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : pipeline ? "The pipeline didn't start." : "The session didn't start.");
      setBusy(false);
    }
  };
  const queue = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await client!.call('later.add', { projectId: projectId!, prompt: prompt.trim(), ...changedFrom(choice, defaults, baseProfile), ...withBranch });
      toast('Queued for later', { detail: `In ${picked?.name ?? 'the project'}${runOn ? ` on ${computerName}` : ''}. Start it from the queue in Seshboard.` });
      clearDraft(DRAFT);
      setPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : "It wasn't queued.");
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  // The filter is only beside the tiles on a wide screen; on a phone it filters the list in the sheet.
  const needle = wide ? filter.trim().toLowerCase() : '';
  const shown = recentProjects(projects ?? [], sessions).filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.id === projectId);
  const picked = projects?.find((p) => p.id === projectId) ?? null;
  const computerName = target.name || 'your computer';

  // Queue for later only while the project is busy: otherwise starting now is what you want.
  const projectBusy = Boolean(projectId && sessions.some((s) => s.projectId === projectId && s.status === 'working'));
  const phone = !wide;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const startable = startState({ connected: Boolean(client), project: Boolean(projectId), text: prompt, busy, reading: attachments.reading, blocked: providerBlocked });
  const branchShown = checkout ?? branches?.current ?? null;
  const summary =
    options && picked && provider
      ? providerSummary({
          provider: provider.name,
          model: providerModel ? (providerModels.find((m) => m.value === providerModel)?.displayName ?? providerModel) : 'Default model',
          mode: provider.modes.find((m) => m.value === providerModeNow)?.label ?? MODE_SHORT[providerModeNow!],
        })
      : options && picked
      ? optionsSummary({
          choice,
          defaults,
          baseProfile,
          profile: profilesOf(options).length > 1 ? (profilesOf(options).find((p) => p.id === choice.profileId)?.name ?? null) : null,
          model: choice.model === AUTO_MODEL ? 'Auto' : modelLabel(options.models, choice.model),
          effort: takesEffort(options.models, choice.model) && (choice.effort || choice.effort !== defaults.effort) ? (choice.effort ? EFFORT_LABEL[choice.effort] : 'Default effort') : null,
          mode: MODE_SHORT[choice.permissionMode],
          branch: choice.worktree ? null : branchShown,
          branchPicked: branch !== null,
          pipeline: pipeline?.name ?? null,
        })
      : null;
  const changedAny = Object.keys(changes).length > 0 || branch !== null || runAs !== null;
  const resetOptions = () => {
    setChanges({});
    setBranch(null);
    setRunAs(null);
    setProviderModel(null);
    setProviderMode(null);
  };
  /** The choices for this session, the same on a wide screen (chips) and a phone (rows in Options). */
  const choiceRows = (look: 'chip' | 'row') =>
    provider && options && picked ? (
      <>
        <ProfileChip options={options} projectId={picked.id} value={choice.profileId} onPick={(profileId) => change({ profileId })} look={look} />
        <ProviderModelChip provider={provider.name} models={providerModels} value={providerModel} onPick={setProviderModel} look={look} />
        <ProviderModeChip modes={provider.modes} value={providerModeNow!} onPick={setProviderMode} look={look} />
      </>
    ) : (
      options &&
      picked && (
        <>
          {pipelines.length > 0 && <RunAsChip pipelines={runAsOrder(pipelines, lastPipeline(computer, picked.id))} value={runAs} onPick={setRunAs} look={look} />}
          <ProfileChip options={options} projectId={picked.id} value={choice.profileId} onPick={(profileId) => change({ profileId })} look={look} />
          <ModelChip options={options} value={choice.model} offerAuto={autoOn(options) && !pipeline} onPick={(model) => change({ model })} look={look} />
          {takesEffort(options.models, choice.model) && <EffortChip options={options} value={choice.effort} onPick={(effort) => change({ effort })} look={look} />}
          <ModeChip options={options} value={choice.permissionMode} onPick={(permissionMode) => change({ permissionMode })} look={look} />
          {/* A run makes its own worktree for its steps. */}
          {!pipeline && <WorkspaceChip value={choice.worktree} onPick={(worktree) => change({ worktree })} look={look} />}
          {!pipeline && !choice.worktree && branches && (branches.current || branches.branches.length > 0) && <BranchChip branches={branches} value={checkout} onPick={setBranch} look={look} />}
        </>
      )
    );
  const startLabel = pipeline ? (busy ? 'Starting the run…' : 'Run pipeline') : 'Start session';

  return (
    <div className="relative flex h-full flex-col bg-bg" style={frame ? { position: 'fixed', left: 0, right: 0, top: frame.top, height: frame.height, zIndex: 20 } : undefined} data-remote-new-session>
      {phone && onBack ? (
        <header className="safe-top flex items-center gap-1 px-2 pb-2">
          <RoundButton onClick={onBack} aria-label="Close" data-remote-new-close>
            <X aria-hidden />
          </RoundButton>
          <h1 className="pl-1 text-title font-semibold">New session</h1>
        </header>
      ) : (
        <header className={`safe-top flex items-center gap-2 border-b border-border pb-2 pointer-fine:pb-2.5 ${onBack || lead ? 'px-2' : 'px-5'}`}>
          {!onBack && lead}
          {onBack && (
            <Button variant="quiet" onClick={onBack} aria-label="Back" className="px-2!">
              <ChevronLeft className="size-5" aria-hidden />
            </Button>
          )}
          <h1 className="text-title font-semibold">New session</h1>
        </header>
      )}
      {banner}
      <main className={`min-h-0 flex-1 overflow-y-auto py-4 sm:py-8 ${phone ? 'pt-2 pb-28' : ''}`}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {runOn && (
            <section aria-labelledby="run-on" className={`flex flex-col gap-2 ${typing ? 'hidden' : ''}`} data-remote-run-on={computer}>
              <h2 id="run-on" className="px-4 text-meta font-semibold tracking-wide text-faint uppercase sm:px-6">
                Run on
              </h2>
              <div role="radiogroup" aria-labelledby="run-on" className="scroll-row flex gap-1.5 px-4 sm:px-6">
                {computers.map((option) => {
                  const isPicked = option.id === computer;
                  const away = RUN_ON_AWAY[option.state.kind];
                  const name = option.name || 'Your computer';
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      disabled={Boolean(away) && !isPicked}
                      onClick={() => !isPicked && onComputer(option.id)}
                      title={away ? `${name}: ${away}` : `Claude runs on ${name}`}
                      data-remote-run-on-option={option.id}
                      className={`flex min-h-11 max-w-56 shrink-0 items-center gap-2 rounded-full border px-3.5 text-ui transition-[background-color,border-color,box-shadow] disabled:opacity-50 pointer-fine:min-h-8 ${isPicked ? 'border-accent-ink bg-card font-semibold text-text ring-4 ring-accent/20' : 'border-edge text-muted enabled:hover:border-faint enabled:hover:bg-border/45 enabled:active:bg-selected'}`}
                    >
                      <span aria-hidden className={`size-2 shrink-0 rounded-full ${RUN_ON_DOT[option.state.kind]}`} />
                      <span className="truncate">{name}</span>
                      {away && <span className="shrink-0 font-normal text-faint">· {away}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {phone && !typing && (
            <section aria-label="Project" className="flex flex-col px-4">
              {projects === null && !error && <p className="text-ui text-muted">Loading projects…</p>}
              {projects?.length === 0 && <p className="rounded-lg bg-sidebar p-3 text-ui text-muted">Add a project in Seshboard on your computer first. New sessions start in the projects you added there.</p>}
              {projects && projects.length > 0 && (
                <ProjectRow project={picked} status={picked ? projectStatus(picked.id, sessions, now) : null} branch={branchShown} onChange={() => setListOpen(true)} />
              )}
            </section>
          )}
          {/* Hidden, not unmounted, while you type: the row keeps its scroll for when the keyboard goes. */}
          <section aria-labelledby="pick-project" className={`flex flex-col gap-2 ${typing || phone ? 'hidden' : ''}`}>
            <div className="flex items-center gap-3 px-4 sm:px-6">
              <h2 id="pick-project" className="flex-1 text-meta font-semibold tracking-wide text-faint uppercase">
                Project
              </h2>
              {!wide && projects && projects.length > LIST_FROM && (
                <Button variant="quiet" size="md" onClick={() => setListOpen(true)} className="-mr-2 px-2!" data-remote-all-projects>
                  All projects
                  <span className="text-faint tabular-nums">{projects.length}</span>
                </Button>
              )}
              {wide && projects && projects.length >= FILTER_FROM && (
                <label className="field flex items-center gap-1.5 px-2">
                  <Search className="size-3.5 text-faint" aria-hidden />
                  <input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter takes the first project that matches and moves on to the prompt.
                      const first = shown.find((p) => p.name.toLowerCase().includes(needle));
                      if (event.key === 'Enter' && needle && first) {
                        event.preventDefault();
                        setFilter('');
                        setProjectId(first.id);
                        box.current?.focus();
                      }
                    }}
                    placeholder="Filter"
                    aria-label="Filter projects"
                    className="min-h-9 w-32 bg-transparent text-body outline-none placeholder:text-faint pointer-fine:min-h-7 pointer-fine:text-ui"
                  />
                </label>
              )}
            </div>
            {projects === null && !error && <p className="px-4 text-ui text-muted sm:px-6">Loading projects…</p>}
            {projects?.length === 0 && <p className="mx-4 rounded-lg bg-sidebar p-3 text-ui text-muted sm:mx-6">Add a project in Seshboard on your computer first. New sessions start in the projects you added there.</p>}
            <div ref={row} role="radiogroup" aria-labelledby="pick-project" className="scroll-row flex snap-x scroll-px-4 gap-2 px-4 pt-1 pb-2 sm:scroll-px-6 sm:px-6">
              {shown.map((project) => {
                const isPicked = projectId === project.id;
                const status = projectStatus(project.id, sessions, now);
                return (
                  <button
                    key={project.id}
                    type="button"
                    role="radio"
                    aria-checked={isPicked}
                    onClick={() => pick(project.id)}
                    data-remote-project={project.id}
                    className={`flex min-h-16 w-40 shrink-0 snap-start flex-col justify-center gap-0.5 rounded-xl border bg-card px-3 py-2 text-left transition-[background-color,border-color,box-shadow] ${isPicked ? 'border-accent-ink ring-4 ring-accent/20' : 'border-edge hover:border-faint hover:bg-border/45 active:bg-selected'}`}
                  >
                    <span className="truncate text-body font-medium">{project.name}</span>
                    <span className={`flex items-center gap-1.5 text-meta ${TONE_TEXT[status.tone]}`}>
                      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} />
                      <span className="truncate">{status.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {projects && projects.length > 0 && shown.length === 0 && <p className="px-4 text-ui text-muted sm:px-6">No project matches.</p>}
          </section>
          {listOpen && projects && <ProjectSheet projects={recentProjects(projects, sessions)} sessions={sessions} now={now} picked={projectId} onPick={pickFromList} onClose={() => setListOpen(false)} />}

          {typing && picked && (
            <p className="-mb-1 truncate px-4 text-meta text-faint" data-remote-new-in>
              In <span className="font-medium text-muted">{picked.name}</span>
              {runOn && (
                <>
                  {' '}
                  on <span className="font-medium text-muted">{computerName}</span>
                </>
              )}
            </p>
          )}
          <form
            id="new-session"
            className="flex flex-col gap-3 px-4 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
            {...attachments.dropProps}
          >
            <div className={`border bg-card p-2 pl-3 transition-[border-color,box-shadow] ${phone ? 'rounded-[18px] p-3 pb-2.5' : 'rounded-xl'} focus-within:border-accent-ink focus-within:ring-4 focus-within:ring-accent/20 ${attachments.dragging ? 'border-accent-ink ring-4 ring-accent/20' : projectId ? 'border-edge' : 'border-border'}`}>
              <AttachmentTray state={attachments} className="pt-1 pr-1 pb-2" />
              <textarea
                ref={box}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onPaste={attachments.onPaste}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void start();
                  }
                }}
                rows={4}
                placeholder={`What should ${provider?.name ?? 'Claude'} do?`}
                aria-label={`What should ${provider?.name ?? 'Claude'} do?`}
                data-remote-new-prompt
                className="min-h-24 w-full resize-none bg-transparent py-1 text-body text-text outline-none [field-sizing:content] placeholder:text-faint"
              />
              <div className="flex items-center">
                <AttachButton state={attachments} disabled={!client} look={phone ? 'clip' : 'quiet'} />
              </div>
            </div>
            {phone && options && picked && summary && !typing && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setOptionsOpen(true)}
                  aria-haspopup="dialog"
                  aria-label={`Options: ${summary.label}`}
                  className="flex min-h-14 items-center gap-3 rounded-[18px] border border-border bg-card px-3.5 py-2 text-left active:bg-selected"
                  data-remote-new-options
                >
                  <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <Summary parts={summary.first} className="text-ui text-text" />
                    <Summary parts={summary.second} className="text-meta text-muted" />
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-ui text-muted">
                    Options
                    <ChevronDown aria-hidden className="size-4 text-faint" />
                  </span>
                </button>
                {provider ? (
                  <p className="px-1 text-meta text-faint" data-remote-provider-note>
                    {providerBlocked ?? `${provider.name} works in ${picked.name}'s folder as it is.`}
                  </p>
                ) : pipeline ? (
                  <RunAsSteps pipeline={pipeline} boxModel={choice.model} />
                ) : (
                  <p className="px-1 text-meta text-faint">From {picked.name}'s defaults. Changes here are for this session only.</p>
                )}
              </div>
            )}
            {!phone && options && picked && !typing && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choices for this session">
                  {choiceRows('chip')}
                </div>
                {provider ? (
                  <p className="text-meta text-faint" data-remote-provider-note>
                    {providerBlocked ?? `${provider.name} works in ${picked.name}'s folder as it is.`}
                  </p>
                ) : pipeline ? (
                  <RunAsSteps pipeline={pipeline} boxModel={choice.model} />
                ) : (
                  <p className="text-meta text-faint">
                    Uses {picked.name}'s defaults. Change them here for this session only.
                  </p>
                )}
              </div>
            )}
          </form>
          {error && (
            <p role="alert" className="mx-4 rounded-lg bg-error/10 px-3 py-2 text-ui text-error sm:mx-6">
              {error}
            </p>
          )}
        </div>
      </main>
      {phone && (
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 px-4 ${typing ? 'pb-3' : 'pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]'}`}>
          {typing && (
            <RoundButton onMouseDown={keepFocus} onClick={() => box.current?.blur()} aria-label="Hide keyboard" title="Hide keyboard" className="pointer-events-auto" data-remote-hide-keyboard>
              <KeyboardOff aria-hidden />
            </RoundButton>
          )}
          {/* The queue starts Claude Code sessions: not with another provider. */}
          {projectBusy && !pipeline && !provider && (
            <button type="button" onClick={() => void queue()} onMouseDown={keepFocus} disabled={!startable.ready || attachments.items.length > 0} title={attachments.items.length ? 'Attachments go with a session that starts now' : undefined} className="pointer-events-auto inline-flex min-h-12 items-center rounded-full border border-edge bg-card px-5 text-body text-text shadow-[var(--sb-overlay-shadow)] disabled:opacity-60" data-remote-queue>
              Queue for later
            </button>
          )}
          {/* Focusable while it can't start, saying why ("Type a message first"). */}
          <button
            type="submit"
            form="new-session"
            onMouseDown={keepFocus}
            aria-disabled={!startable.ready || undefined}
            aria-busy={busy || undefined}
            aria-label={startable.reason ? `${startLabel}. ${startable.reason}` : startLabel}
            title={startable.reason ?? undefined}
            className={`pointer-events-auto inline-flex min-h-12 items-center rounded-full px-7 text-body font-semibold shadow-[var(--sb-overlay-shadow)] transition-[background-color,color,opacity] ${startable.ready ? 'bg-accent text-on-accent active:brightness-90' : 'bg-accent/45 text-on-accent/60'}`}
            data-remote-start={pipeline ? 'pipeline' : 'session'}
            data-remote-start-state={startable.ready ? 'ready' : 'empty'}
          >
            {startLabel}
          </button>
        </div>
      )}
      {phone && optionsOpen && options && picked && (
        <Sheet title="Options" onClose={() => setOptionsOpen(false)} done hook="options">
          <div className="-mx-4 flex flex-col divide-y divide-border border-y border-border">{choiceRows('row')}</div>
          <button type="button" onClick={resetOptions} disabled={!changedAny} className="mt-3 min-h-11 text-left text-ui text-accent-ink disabled:text-faint" data-remote-options-reset>
            Reset to {picked.name}'s defaults
          </button>
        </Sheet>
      )}
      <footer className={`border-t border-border px-4 pt-2 sm:px-6 ${typing ? 'pb-2' : 'safe-bottom'} ${phone ? 'hidden' : ''}`}>
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          {typing && (
            <Button variant="quiet" onMouseDown={keepFocus} onClick={() => box.current?.blur()} aria-label="Hide keyboard" title="Hide keyboard" className="px-3!" data-remote-hide-keyboard>
              <KeyboardOff className="size-5" aria-hidden />
            </Button>
          )}
          <span className="hidden min-w-0 flex-1 truncate text-meta text-faint sm:block" aria-live="polite">
            {picked ? (
              <>
                Starts in <span className="font-medium text-muted">{picked.name}</span>
                {runOn && (
                  <>
                    {' '}
                    on <span className="font-medium text-muted">{computerName}</span>
                  </>
                )}
              </>
            ) : projects && projects.length > 0 ? (
              'Pick a project first.'
            ) : null}
          </span>
          {/* The queue starts Claude Code sessions: not with another provider. */}
          {projectBusy && !pipeline && !provider && (
            <Button onClick={() => void queue()} onMouseDown={keepFocus} disabled={!ready || attachments.items.length > 0} title={attachments.items.length ? 'Attachments go with a session that starts now' : undefined} className="flex-1 sm:flex-none" data-remote-queue>
              Queue for later
            </Button>
          )}
          <Button type="submit" form="new-session" variant="primary" onMouseDown={keepFocus} disabled={!ready} aria-busy={busy || undefined} data-remote-start={pipeline ? 'pipeline' : 'session'} className="flex-1 sm:flex-none">
            {pipeline ? (busy ? 'Starting the run…' : 'Run pipeline') : 'Start session'}
            <Kbd shortcut="mod+enter" tone="on-accent" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

/** A line of the Options summary: the parts that differ from the project's defaults in the accent colour. */
function Summary({ parts, className }: { parts: SummaryPart[]; className: string }) {
  return (
    <span className={`block truncate ${className}`}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <span className={part.changed ? 'text-accent-ink' : undefined} data-remote-summary-changed={part.changed || undefined}>
            {part.text}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/** The project New session starts in, on a phone: its initial, its name, how it is and the branch, and Change. */
function ProjectRow({ project, status, branch, onChange }: { project: RemoteProject | null; status: { tone: TileTone; label: string } | null; branch: string | null; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-haspopup="dialog"
      aria-label={project ? `Project: ${project.name}, ${status?.label ?? ''}${branch ? `, on ${branch}` : ''}. Change` : 'Pick a project'}
      className="flex min-h-16 items-center gap-3 rounded-[18px] border border-border bg-card px-3.5 py-2 text-left active:bg-selected"
      data-remote-new-project={project?.id ?? ''}
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar text-ui font-semibold text-muted uppercase">
        {project?.name.charAt(0) ?? '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold">{project?.name ?? 'Pick a project'}</span>
        {status && (
          <span className={`flex min-w-0 items-center gap-1.5 text-meta ${TONE_TEXT[status.tone]}`}>
            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} />
            <span className="truncate">
              {status.label}
              {branch && <span className="text-muted"> · on {branch}</span>}
            </span>
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-ui text-muted">
        Change
        <ChevronDown aria-hidden className="size-4 text-faint" />
      </span>
    </button>
  );
}

/** The value for one session in Run as's list. */
const ONE_SESSION = '';

/**
 * Run as (#179), as on the computer: one session, or a pipeline with the prompt as its task. The pipeline last run in
 * this project from this device comes first. Picked, Start becomes Run pipeline and the steps show under the chips.
 */
function RunAsChip({ pipelines, value, onPick, look }: { pipelines: readonly RemotePipeline[]; value: string | null; onPick: (pipelineId: string | null) => void; look?: 'chip' | 'row' }) {
  const picked = pipelines.find((p) => p.id === value);
  return (
    <ChoiceChip
      label="Run as"
      face={picked?.name ?? 'One session'}
      icon={look === 'row' ? undefined : <ListTree className={`size-3.5 ${picked ? 'text-pipeline' : 'text-muted'}`} aria-hidden />}
      look={look}
      rowIcon={<ListTree aria-hidden />}
      selected={value ?? ONE_SESSION}
      hook="run-as"
      options={[{ value: ONE_SESSION, label: 'One session', description: 'default', separatorAfter: true }, ...pipelines.map((p) => ({ value: p.id, label: p.name, description: pipelineMeta(p) }))]}
      onPick={(id) => onPick(id === ONE_SESSION ? null : id)}
    />
  );
}

/** What Run pipeline will run: a pill per step with who does it ("Plan Opus → Execute Sonnet → Push you"). */
function RunAsSteps({ pipeline, boxModel }: { pipeline: RemotePipeline; boxModel: string | null }) {
  const steps = runAsSteps(pipeline, boxModel);
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg border border-dashed border-pipeline/35 px-2.5 py-1.5" data-remote-run-as-steps={steps.length}>
      <span className="flex h-6 shrink-0 items-center gap-1.5 text-meta text-muted">
        <ListTree className="size-3.5 text-pipeline" aria-hidden />
        Runs as
      </span>
      <ol aria-label={runAsLabel(pipeline.name, steps)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
        {steps.map((step, i) => (
          <Fragment key={`${i}-${step.name}`}>
            {i > 0 && (
              <span aria-hidden className="text-meta text-faint">
                →
              </span>
            )}
            <li className="inline-flex h-6 items-center gap-1 rounded-full border border-edge bg-card px-2 text-meta whitespace-nowrap">
              <span className="text-text">{step.name}</span>
              <span className="text-muted">{step.who}</span>
            </li>
          </Fragment>
        ))}
      </ol>
    </div>
  );
}

/**
 * Every project as a list, most recent first, with what's going on in each: the phone's way to reach one that's far
 * along the row. A tap picks it and closes the sheet; the search on top filters it (Enter takes the first).
 */
function ProjectSheet({ projects, sessions, now, picked, onPick, onClose }: { projects: readonly RemoteProject[]; sessions: readonly RemoteSession[]; now: number; picked: string | null; onPick: (id: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = projects.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  return (
    <Sheet title="Pick a project" onClose={onClose} tall={projects.length >= FILTER_FROM} hook="projects">
      {/* Always there: the sheet is a phone's only way to another project. */}
      <label className="field sticky top-0 z-10 mb-2 flex items-center gap-2 px-3">
        <Search className="size-4 text-faint" aria-hidden />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && shown[0]) {
              event.preventDefault();
              onPick(shown[0].id);
            }
          }}
          placeholder="Search projects"
          aria-label="Search projects"
          enterKeyHint="go"
          className="min-h-11 w-full bg-transparent text-body outline-none placeholder:text-faint"
        />
      </label>
      <div role="radiogroup" aria-label="Projects" className="-mx-1 flex flex-col">
        {shown.map((project) => {
          const isPicked = picked === project.id;
          const status = projectStatus(project.id, sessions, now);
          return (
            <button key={project.id} type="button" role="radio" aria-checked={isPicked} onClick={() => onPick(project.id)} data-remote-project-option={project.id} className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left active:bg-selected">
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-body ${isPicked ? 'font-semibold' : 'font-medium'}`}>{project.name}</span>
                <span className={`flex items-center gap-1.5 text-ui ${TONE_TEXT[status.tone]}`}>
                  <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} />
                  <span className="truncate">{status.label}</span>
                </span>
              </span>
              <Check aria-hidden className={`size-4 shrink-0 text-accent-ink ${isPicked ? '' : 'invisible'}`} />
            </button>
          );
        })}
        {shown.length === 0 && <p className="px-3 py-2 text-ui text-muted">No project matches.</p>}
      </div>
    </Sheet>
  );
}
