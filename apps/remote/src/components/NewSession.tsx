import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, KeyboardOff, Search } from 'lucide-react';
import { REMOTE_FEATURE_BRANCHES, type RemoteBranches, type RemoteOptions, type RemoteProject, type RemoteSession } from '@switchboard/protocol/remote-client';
import { checkoutBranch } from '../lib/branches.ts';
import { clearDraft, loadDraft, saveDraft, type DraftKey } from '../lib/drafts.ts';
import { projectStatus, recentProjects, suggestedProject, type TileTone } from '../lib/groups.ts';
import { useFinePointer, useWide } from '../lib/media.ts';
import { autoOn, changedFrom, defaultChoice, projectProfile, takesEffort, type Choice } from '../lib/options.ts';
import { lastProject, rememberProject } from '../lib/storage.ts';
import { AttachButton, AttachmentTray, useAttachments } from './Attachments.tsx';
import type { Client } from './Connected.tsx';
import { BranchChip, EffortChip, ModeChip, ModelChip, ProfileChip, WorkspaceChip } from './OptionChips.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toasts.tsx';
import { Button, Kbd } from './ui.tsx';
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
 * New session in one of your projects, the ones you added in Switchboard. The tiles (one row that scrolls sideways)
 * say what's going on in each, most recent first; the project you last started in (or the one with the newest session)
 * is picked for you, so most of the time you only type. On a phone, All projects opens them as a list in a sheet, with
 * the filter there, so the keyboard doesn't come up over the tiles. Under the prompt, the project's profile (with more than one)
 * and its defaults for model, effort, mode and worktree as chips, to change for this session only. In the project's folder,
 * the branch checked out there, or another to check out first (`REMOTE_FEATURE_BRANCHES`). Queue for later puts it in Switchboard's queue instead,
 * while the project has a session working. While the keyboard is up on a phone, only the prompt and the buttons stay: the
 * view takes what the keyboard leaves (as the session's message box does, `lib/viewport.ts`), so Start session sits
 * right above it, and Hide keyboard brings the tiles and the chips back.
 */
export function NewSession({ client, computer, features, sessions, banner, onBack, lead = null, onStarted, initialProject = null }: { client: Client; /** The computer's id on this phone: New session remembers its last project per computer. */ computer: string; /** What the computer takes beyond what every version does (its hello). */ features: readonly string[]; sessions: readonly RemoteSession[]; banner: ReactNode; onBack: (() => void) | null; /** In Back's place on a wide screen whose sidebar folded away: the drawer button. */ lead?: ReactNode; onStarted: (sessionId: string) => void; /** Picked from the palette (New session in <project>). */ initialProject?: string | null }) {
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

  useEffect(() => {
    if (!client) return;
    void client.call('projects.list', {}).then(
      ({ projects }) => {
        setProjects(projects);
        setProjectId((current) => current ?? suggestedProject(projects, latest.current, lastProject(computer)));
      },
      (e: Error) => setError(e.message),
    );
    void client.call('options.get', {}).then(setOptions, () => {});
  }, [client]);

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
  const ready = Boolean(client && projectId && prompt.trim() && !busy && !attachments.reading);
  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionId } = await client!.call('session.create', { projectId: projectId!, prompt: prompt.trim(), ...(attachments.images.length ? { images: attachments.images } : {}), ...(attachments.files.length ? { files: attachments.files } : {}), ...changedFrom(choice, defaults, baseProfile), ...withBranch });
      rememberProject(computer, projectId!);
      clearDraft(DRAFT);
      onStarted(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The session didn't start.");
      setBusy(false);
    }
  };
  const queue = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await client!.call('later.add', { projectId: projectId!, prompt: prompt.trim(), ...changedFrom(choice, defaults, baseProfile), ...withBranch });
      toast('Queued for later', { detail: `In ${picked?.name ?? 'the project'}. Start it from the queue in Switchboard.` });
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

  // Queue for later only while the project is busy: otherwise starting now is what you want.
  const projectBusy = Boolean(projectId && sessions.some((s) => s.projectId === projectId && s.status === 'working'));

  return (
    <div className="flex h-full flex-col bg-bg" style={frame ? { position: 'fixed', left: 0, right: 0, top: frame.top, height: frame.height, zIndex: 20 } : undefined} data-remote-new-session>
      <header className={`safe-top flex items-center gap-2 border-b border-border pb-2 pointer-fine:pb-2.5 ${onBack || lead ? 'px-2' : 'px-5'}`}>
        {!onBack && lead}
        {onBack && (
          <Button variant="quiet" onClick={onBack} aria-label="Back" className="px-2!">
            <ChevronLeft className="size-5" aria-hidden />
          </Button>
        )}
        <h1 className="text-title font-semibold">New session</h1>
      </header>
      {banner}
      <main className="min-h-0 flex-1 overflow-y-auto py-4 sm:py-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {/* Hidden, not unmounted, while you type: the row keeps its scroll for when the keyboard goes. */}
          <section aria-labelledby="pick-project" className={`flex flex-col gap-2 ${typing ? 'hidden' : ''}`}>
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
            {projects?.length === 0 && <p className="mx-4 rounded-lg bg-sidebar p-3 text-ui text-muted sm:mx-6">Add a project in Switchboard on your computer first. New sessions start in the projects you added there.</p>}
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
            <div className={`rounded-xl border bg-card p-2 pl-3 transition-[border-color,box-shadow] focus-within:border-accent-ink focus-within:ring-4 focus-within:ring-accent/20 ${attachments.dragging ? 'border-accent-ink ring-4 ring-accent/20' : projectId ? 'border-edge' : 'border-border'}`}>
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
                placeholder="What should Claude do?"
                aria-label="What should Claude do?"
                data-remote-new-prompt
                className="min-h-24 w-full resize-none bg-transparent py-1 text-body text-text outline-none [field-sizing:content] placeholder:text-faint"
              />
              <div className="flex items-center">
                <AttachButton state={attachments} disabled={!client} />
              </div>
            </div>
            {options && picked && !typing && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choices for this session">
                  <ProfileChip options={options} projectId={picked.id} value={choice.profileId} onPick={(profileId) => change({ profileId })} />
                  <ModelChip options={options} value={choice.model} offerAuto={autoOn(options)} onPick={(model) => change({ model })} />
                  {takesEffort(options.models, choice.model) && <EffortChip options={options} value={choice.effort} onPick={(effort) => change({ effort })} />}
                  <ModeChip options={options} value={choice.permissionMode} onPick={(permissionMode) => change({ permissionMode })} />
                  <WorkspaceChip value={choice.worktree} onPick={(worktree) => change({ worktree })} />
                  {!choice.worktree && branches && (branches.current || branches.branches.length > 0) && <BranchChip branches={branches} value={checkout} onPick={setBranch} />}
                </div>
                <p className="text-meta text-faint">
                  Uses {picked.name}'s defaults. Change them here for this session only.
                </p>
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
      <footer className={`border-t border-border px-4 pt-2 sm:px-6 ${typing ? 'pb-2' : 'safe-bottom'}`}>
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
              </>
            ) : projects && projects.length > 0 ? (
              'Pick a project first.'
            ) : null}
          </span>
          {projectBusy && (
            <Button onClick={() => void queue()} onMouseDown={keepFocus} disabled={!ready || attachments.items.length > 0} title={attachments.items.length ? 'Attachments go with a session that starts now' : undefined} className="flex-1 sm:flex-none" data-remote-queue>
              Queue for later
            </Button>
          )}
          <Button type="submit" form="new-session" variant="primary" onMouseDown={keepFocus} disabled={!ready} data-remote-start className="flex-1 sm:flex-none">
            Start session
            <Kbd shortcut="mod+enter" tone="on-accent" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

/**
 * Every project as a list, most recent first, with what's going on in each: the phone's way to reach one that's far
 * along the row. A tap picks it and closes the sheet; with many projects a filter sits on top (Enter takes the first).
 */
function ProjectSheet({ projects, sessions, now, picked, onPick, onClose }: { projects: readonly RemoteProject[]; sessions: readonly RemoteSession[]; now: number; picked: string | null; onPick: (id: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = projects.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const withFilter = projects.length >= FILTER_FROM;
  return (
    <Sheet title="Pick a project" onClose={onClose} tall={withFilter} hook="projects">
      {withFilter && (
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
            placeholder="Filter"
            aria-label="Filter projects"
            enterKeyHint="go"
            className="min-h-11 w-full bg-transparent text-body outline-none placeholder:text-faint"
          />
        </label>
      )}
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
