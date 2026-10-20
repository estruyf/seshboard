import { FolderDown, GitBranch } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { bringsAnything, REMOTE_FEATURE_BRANCHES, type Computer, type Contract, type RemoteBranches, type RemoteProject, type RpcClient } from '@switchboard/protocol/client';
import { comboPresses, matches, shortcutById } from '../../lib/shortcuts.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useClone, useCloneEnabled } from '../../state/cloneStore.ts';
import { ClonePanel } from '../clone/ClonePanel.tsx';
import { useTrustQuestion } from '../clone/CloneTrustDialog.tsx';
import { canClone, planLine } from '../clone/cloneModel.ts';
import { CloneCancelled, useCloneJob, type CloneResult } from '../clone/useCloneJob.ts';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { remoteProjectKey } from '../../state/remoteRows.ts';
import { useRunOn } from '../../state/runOnStore.ts';
import { toast } from '../../state/toastStore.ts';
import { DropOverlay } from '../composer/Attachments.tsx';
import { ChoiceMenu } from '../newSession/ChoiceMenu.tsx';
import { RunOnSwitch } from '../newSession/RunOnSwitch.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { callComputer } from './callComputer.ts';
import { ComputerChip } from './ComputerChip.tsx';
import { RemoteAttachButton, RemoteAttachmentList, useRemoteAttachments } from './RemoteAttachments.tsx';
import { ChipMenu, RemoteEffortChip, RemoteModeChip, RemoteModelChip, RemoteProfileChip, useRemoteOptions } from './RemoteChips.tsx';
import { remoteBranchChoices, remoteChanges, remoteCheckoutBranch, remoteDefaultChoice, remoteProjectProfile, remoteProjectTiles, remoteTakesEffort, type RemoteChoice, type RemoteTile } from './remoteNewSession.ts';

/** Tiles before "+N more on …": the fifth place is that tile. */
const QUICK = 4;

const TONE_DOT = { 'needs-you': 'bg-warn animate-pulse', working: 'bg-accent-ink', idle: 'bg-faint/60' } as const;
const TONE_TEXT = { 'needs-you': 'text-warn', working: 'text-accent-ink', idle: 'text-muted' } as const;
const TILE = 'flex min-w-0 items-center gap-2 rounded-lg border p-2.5 text-left transition-[background-color,border-color,box-shadow,translate] @max-[600px]:flex-col @max-[600px]:items-start @max-[600px]:gap-1.5';

/**
 * New session with another computer picked in Run on (docs/remote-access.md, Other computers): that computer's projects
 * as tiles (⌘1 to ⌘9 still pick), the route tray with its chip, and Start, which asks it to start the session with
 * `session.create` and opens it here. Profile, model, effort, mode and where only show when that computer answers
 * `options.get` (an older Switchboard doesn't); they start from the project's defaults, then its profile's, and only
 * what you change is sent, as in the remote app. Images and files go with the prompt when that computer takes them
 * (`RemoteAttachments.tsx`). In the current checkout, the branch checked out there shows, and another one picked is
 * checked out before the session starts (`REMOTE_FEATURE_BRANCHES`). Folders there can't be picked from here, and Quick question, the queue and the focus limit
 * are this computer's. Clone from GitHub (on here) clones on that computer, into its own Clone into folder
 * (`REMOTE_FEATURE_CLONE`), and the session starts in the clone there.
 */
export function RemoteNewSession({ client, computer }: { client: RpcClient<Contract> | null; computer: Computer }) {
  const [projects, setProjects] = useState<RemoteProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [changes, setChanges] = useState<Partial<RemoteChoice>>({});
  /** That computer's branches for the picked project's folder (null: not read yet, or it can't say). */
  const [branches, setBranches] = useState<RemoteBranches | null>(null);
  /** A branch picked to check out first; null stays on what is checked out. */
  const [branch, setBranch] = useState<string | null>(null);
  const picked = useRunOn((s) => s.projects[computer.id] ?? null);
  const list = useComputers((s) => s.lists.get(computer.id) ?? null);
  const box = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const name = computer.name;
  const connected = computer.state === 'connected';
  const attachments = useRemoteAttachments({ computer, rootRef: composer, newSession: true, disabledReason: connected ? null : `${name} is not connected` });
  // An older Switchboard there has no options.get: then New session sends only the project and the prompt.
  const options = useRemoteOptions(client, computer);
  // Clone from GitHub, on that computer: the same form as here (kept when Run on changes), the clone there.
  const cloneEnabled = useCloneEnabled();
  const cloneForm = useClone((s) => s.form);
  const cloneRequest = useClone((s) => s.request);
  const cloneJob = useCloneJob(client, cloneForm?.url ?? '', cloneForm?.name ?? '', computer);
  const [cloneSoon, setCloneSoon] = useState(false);
  const trust = useTrustQuestion();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!client || !connected) return;
    let current = true;
    setLoadError(null);
    void callComputer(client, computer.id, 'projects.list', {}).then(
      (result) => current && setProjects(result.projects),
      (e: Error) => current && setLoadError(e.message),
    );
    return () => {
      current = false;
    };
  }, [client, computer.id, connected, reload]);

  const tiles = useMemo(() => remoteProjectTiles(projects ?? [], list), [projects, list]);
  const project = tiles.find((t) => t.id === picked)?.project ?? null;
  const pick = (id: string) => {
    // Another project has its own defaults: what you changed was for the one before.
    if (id !== picked) setChanges({});
    useRunOn.getState().setProject(computer.id, id);
    requestAnimationFrame(() => box.current?.focus());
  };
  // Clone from GitHub asked for (the palette's step, a URL): clone as soon as that computer has said where it goes.
  useEffect(() => {
    if (!cloneRequest) return;
    const request = useClone.getState().take();
    if (request) setCloneSoon(request.start);
  }, [cloneRequest]);
  /** The clone finished there: its project is listed and picked. */
  const onCloned = (result: CloneResult) => {
    if (!result.projectId) return;
    setReload((n) => n + 1);
    pick(result.projectId);
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
  };
  const cloned = cloneForm && cloneJob.stage === 'done' ? (cloneJob.result?.projectId ?? null) : null;
  /** The form is open and Start would clone first: no project to pick yet. */
  const cloning = !!cloneForm && cloned === null;

  // A picked tile that is past the quick ones shows anyway, as in the local picker.
  const shown = expanded ? tiles : tiles.slice(0, tiles.length > QUICK + 1 ? QUICK : QUICK + 1);
  const more = expanded ? 0 : tiles.length - shown.length;

  const pickRef = useRef<(index: number) => void>(() => {});
  pickRef.current = (index) => {
    const tile = shown[index];
    if (tile) pick(tile.id);
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!matches(event, 'new-session.pick')) return;
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')) return;
      event.preventDefault();
      pickRef.current(Number(event.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Another profile brings its defaults, under the project's own and what you changed.
  const projectId = project?.id ?? null;
  const baseProfile = remoteProjectProfile(options, projectId);
  const defaults = remoteDefaultChoice(options, projectId, changes.profileId ?? baseProfile);
  const choice: RemoteChoice = { ...defaults, ...changes };
  const change = (next: Partial<RemoteChoice>) => setChanges((current) => ({ ...current, ...next }));
  const worktree = choice.worktree;

  // Another project has its own branches; read them again when the window comes back, as they change there too.
  const takesBranch = computer.features.includes(REMOTE_FEATURE_BRANCHES);
  useEffect(() => {
    setBranches(null);
    setBranch(null);
    if (!client || !connected || !takesBranch || !projectId) return;
    let current = true;
    const load = () =>
      void callComputer(client, computer.id, 'projects.branches', { projectId }).then(
        (result) => current && setBranches(result),
        () => current && setBranches(null),
      );
    load();
    window.addEventListener('focus', load);
    return () => {
      current = false;
      window.removeEventListener('focus', load);
    };
  }, [client, computer.id, connected, takesBranch, projectId]);
  const checkoutBranch = remoteCheckoutBranch(branch, branches, worktree);

  const cloneBlocked = cloning && !canClone(cloneJob.plan) && cloneJob.stage !== 'running' ? (cloneJob.problem ?? (cloneJob.plan ? planLine(cloneJob.plan, name).text : 'Paste a GitHub repository first')) : null;
  const blocked = !client ? 'Connecting to the engine…' : !connected ? `${name} is not connected` : cloneBlocked ? cloneBlocked : !project && !cloning ? 'Choose a project first' : !prompt.trim() ? 'Type a message first' : null;
  const start = async () => {
    if (blocked || starting || attachments.reading || !client || (!project && !cloning)) return;
    setStarting(true);
    const { images, files } = attachments;
    try {
      // With the clone form open, Start waits for the clone there, then asks once about what the repository brings.
      let fresh: CloneResult | null = null;
      if (cloneForm) {
        try {
          fresh = await cloneJob.wait();
        } catch (e) {
          if (e instanceof CloneCancelled) return;
          throw e;
        }
        if (!fresh.projectId) throw new Error(`The clone has no project on ${name}`);
        onCloned(fresh);
        if (bringsAnything(fresh.brings) && !(await trust.ask(`${computer.id}:${fresh.projectId}`, fresh.brings))) return;
      }
      const projectId = fresh?.projectId ?? project!.id;
      // A fresh clone runs in the clone, on the branch it checked out: no worktree, no other branch.
      const inClone = fresh !== null && !fresh.reused;
      const { sessionId } = await callComputer(client, computer.id, 'session.create', {
        projectId,
        prompt: prompt.trim(),
        // Only a computer that takes them gets these: an older one would drop them without a word.
        ...(images.length ? { images } : {}),
        ...(files.length ? { files } : {}),
        ...(options ? remoteChanges(choice, defaults, baseProfile) : {}),
        ...(inClone ? { worktree: false } : {}),
        ...(checkoutBranch && !fresh ? { checkoutBranch } : {}),
      });
      if (fresh) closeClone();
      setPrompt('');
      setChanges({});
      setBranch(null);
      attachments.clear();
      useComputers.getState().openSession({ computerId: computer.id, sessionId }, { starting: true });
    } catch (e) {
      toast((e as Error).message, { body: `It didn’t start on ${name}.` });
    } finally {
      setStarting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) || matches(event.nativeEvent, 'new-session.start')) {
      event.preventDefault();
      void start();
    }
  };
  const keys = comboPresses(shortcutById('new-session.pick').keys[0]!);
  return (
    <div className="flex h-full min-h-0 flex-col" data-remote-new-session={computer.id} data-drop-zone>
      <div className="drag flex h-13 shrink-0 items-center justify-between px-4">
        <SidebarToggle />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-2 pb-12" data-new-session-view>
          <div className="grid gap-3 text-center">
            <div>
              <h1 className="text-hero leading-tight font-semibold">Where do we start?</h1>
              <p className="mt-1 text-ui text-muted">
                <Kbd keys={keys[0]!} /> to <Kbd keys={keys.at(-1)!} /> picks a project
              </p>
            </div>
            <RunOnSwitch />
          </div>

          {loadError && <Notice tone="error">{loadError}</Notice>}
          {cloneForm ? (
            <ClonePanel
              url={cloneForm.url}
              name={cloneForm.name}
              job={cloneJob}
              computer={name}
              onUrl={(url) => useClone.getState().editForm({ url })}
              onName={(folder) => useClone.getState().editForm({ name: folder })}
              onStart={startClone}
              onClose={closeClone}
              closeLabel={cloned ? 'Done' : 'Pick a project instead'}
            />
          ) : (
          <div className="@container grid gap-2">
            {cloneEnabled && (
              <SectionHeader
                className="h-6"
                action={
                  <Button size="sm" icon={<FolderDown size={14} aria-hidden />} onClick={() => useClone.getState().openForm()} className="ml-auto font-normal tracking-normal normal-case" data-clone-from-github>
                    Clone from GitHub…
                  </Button>
                }
              >
                Project
              </SectionHeader>
            )}
            {projects === null && !loadError ? (
              <p className="py-3 text-center text-ui text-muted">{connected ? `Loading the projects on ${name}…` : `The projects show once ${name} is back.`}</p>
            ) : tiles.length === 0 && !loadError ? (
              <Notice>No projects on {name} yet. Add one in Switchboard there, and it shows here.</Notice>
            ) : (
              <div role="group" aria-label={`Projects on ${name}`} className={`grid gap-2 ${expanded || more === 0 ? 'grid-cols-4' : 'grid-cols-5'}`} data-remote-projects>
                {shown.map((tile, index) => (
                  <Tile key={tile.id} tile={tile} index={index} computerId={computer.id} selected={tile.id === picked} onPick={() => pick(tile.id)} />
                ))}
                {more > 0 && (
                  <button type="button" onClick={() => setExpanded(true)} className={`${TILE} justify-center border-dashed border-border text-ui text-muted hover:bg-border/45 hover:text-text`} data-remote-more-projects>
                    +{more} more on {name}
                  </button>
                )}
              </div>
            )}
          </div>
          )}
          {trust.dialog}

          <div className="rounded-xl">
            <div className="flex min-h-10 min-w-0 items-center gap-1 rounded-t-xl border border-b-0 border-remote/45 bg-border/25 px-1.5 py-1" data-route-tray>
              <ComputerChip name={name} size="header" offline={!connected} />
              <span aria-hidden className="px-0.5 text-faint">
                /
              </span>
              {project && !cloning ? (
                <span className="flex min-w-0 items-center gap-1.5 px-1 text-ui font-semibold text-text" data-route-project>
                  <ProjectIcon project={undefined} root={remoteProjectKey(computer.id, project.id)} name={project.name} size={16} />
                  <span className="truncate">{project.name}</span>
                </span>
              ) : (
                <span className="min-w-0 truncate px-1.5 text-ui text-muted" data-route-hint>
                  {cloning ? (cloneJob.plan ? `Claude works in the clone of ${cloneJob.plan.repo.owner}/${cloneJob.plan.repo.name}.` : 'Paste a GitHub repository to clone.') : `Choose a project on ${name}`}
                </span>
              )}
              {options && project && !cloning && (
                <>
                  <span aria-hidden className="px-0.5 text-faint">
                    /
                  </span>
                  <ChipMenu
                    label={`Where: ${worktree ? 'New worktree' : 'Current checkout'}`}
                    value={worktree ? 'New worktree' : 'Current checkout'}
                    entries={[
                      { label: 'Current checkout', checked: !worktree, onSelect: () => change({ worktree: false }) },
                      { label: 'New worktree', checked: worktree, onSelect: () => change({ worktree: true }) },
                    ]}
                    data-route-where
                  />
                  {!worktree && branches && (branches.current || branches.branches.length > 0) && (
                    <>
                      <span aria-hidden className="px-0.5 text-faint">
                        /
                      </span>
                      <ChoiceMenu
                        name="remote-branch"
                        value={checkoutBranch ?? branches.current ?? ''}
                        onChange={(b) => setBranch(b === branches.current || b === '' ? null : b)}
                        title={`Check out a branch on ${name} before the session starts. Git keeps uncommitted changes, or refuses when they conflict.`}
                        heading="Branch"
                        chevron
                        mono
                        search="Search branches"
                        width={300}
                        choices={remoteBranchChoices(branches)}
                      >
                        <GitBranch size={14} className="shrink-0" aria-hidden />
                        <span className="truncate" data-route-branch>
                          {checkoutBranch ?? branches.current ?? 'detached'}
                        </span>
                      </ChoiceMenu>
                    </>
                  )}
                </>
              )}
            </div>
            <div ref={composer} className="relative rounded-xl rounded-t-none border border-remote/45 bg-card px-3 pt-2.5 pb-2 shadow-sm" data-remote-composer>
              <DropOverlay drop={attachments.drop} />
              <RemoteAttachmentList state={attachments} className="mb-2 px-1 pt-1" />
              <textarea
                ref={box}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={attachments.onPaste}
                rows={1}
                autoFocus
                disabled={!connected}
                placeholder={`What should Claude work on? It runs on ${name}.`}
                aria-label={`Message to Claude on ${name}`}
                className="block field-sizing-content max-h-80 min-h-24 w-full min-w-0 resize-none bg-transparent px-1 pt-1 text-title leading-relaxed font-normal text-text outline-none placeholder:text-faint disabled:opacity-60"
                data-composer
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <div className="-ml-1.5 flex min-w-0 flex-1 items-center gap-0.5">
                  <RemoteAttachButton state={attachments} computer={computer} disabled={!connected} />
                  {options && project && !cloning && (
                    <>
                      <RemoteProfileChip
                        options={options}
                        computerName={name}
                        value={choice.profileId}
                        projectProfileId={baseProfile}
                        ownProfile={Boolean(options.projects.find((p) => p.id === project.id)?.profileId)}
                        onPick={(profileId) => change({ profileId })}
                      />
                      <RemoteModelChip options={options} value={choice.model} offerAuto={options.auto?.enabled ?? false} onPick={(model) => change({ model })} />
                      {options.efforts.length > 0 && remoteTakesEffort(options.models, choice.model) && <RemoteEffortChip options={options} value={choice.effort} onPick={(effort) => change({ effort })} />}
                      <RemoteModeChip options={options} value={choice.permissionMode} onPick={(permissionMode) => change({ permissionMode })} />
                    </>
                  )}
                </div>
                <span className="flex" data-tooltip={!starting ? (blocked ?? undefined) : undefined}>
                  <Button variant="primary" size="lg" shortcut="new-session.start" disabled={!!blocked || starting || attachments.reading} onClick={() => void start()} className="disabled:pointer-events-none" data-composer-submit data-remote-start>
                    {starting ? 'Starting…' : `Start on ${name}`}
                  </Button>
                </span>
              </div>
            </div>
          </div>
          <p className="-mt-2 text-center text-meta text-muted" data-remote-start-note>
            Claude runs on {name}, in its folders and with its Claude profile. You follow it from here.
          </p>
        </div>
      </div>
    </div>
  );
}

function Tile({ tile, index, computerId, selected, onPick }: { tile: RemoteTile; index: number; computerId: string; selected: boolean; onPick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      data-remote-project={tile.id}
      data-tooltip={tile.project.name}
      className={`${TILE} ${selected ? '-translate-y-px border-remote/70 bg-selected' : 'border-border bg-card hover:bg-border/45'}`}
    >
      <ProjectIcon project={undefined} root={remoteProjectKey(computerId, tile.id)} name={tile.project.name} size={24} remote />
      <span className="grid min-w-0 flex-1 content-start gap-0.5 @max-[600px]:w-full">
        <span className="truncate text-ui font-semibold text-text">{tile.project.name}</span>
        <span className={`flex min-w-0 items-center gap-1.5 text-meta ${TONE_TEXT[tile.tone]}`}>
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tile.tone]}`} />
          <span className="truncate">{tile.label}</span>
        </span>
      </span>
      {index < 9 && <Kbd keys={`⌘${index + 1}`} tone="plain" className="@max-[680px]:hidden" />}
    </button>
  );
}
