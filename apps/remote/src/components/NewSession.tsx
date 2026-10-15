import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, Search } from 'lucide-react';
import type { RemoteOptions, RemoteProject, RemoteSession } from '@switchboard/protocol/remote-client';
import { projectStatus, recentProjects, suggestedProject, type TileTone } from '../lib/groups.ts';
import { useFinePointer } from '../lib/media.ts';
import { autoOn, changedFrom, defaultChoice, projectProfile, takesEffort, type Choice } from '../lib/options.ts';
import { lastProject, rememberProject } from '../lib/storage.ts';
import type { Client } from './Connected.tsx';
import { EffortChip, ModeChip, ModelChip, ProfileChip, WorkspaceChip } from './OptionChips.tsx';
import { toast } from './Toasts.tsx';
import { Button, Kbd } from './ui.tsx';

const TONE_DOT: Record<TileTone, string> = { 'needs-you': 'bg-warn', working: 'bg-accent-ink', idle: 'bg-faint' };
const TONE_TEXT: Record<TileTone, string> = { 'needs-you': 'text-warn', working: 'text-accent-ink', idle: 'text-muted' };
/** More than this and a filter field shows above the tiles. */
const FILTER_FROM = 7;
/** What you typed survives going back to the list and coming back, until the session starts. */
const DRAFT = 'switchboard-remote:new-draft';

/**
 * New session in one of your projects, the ones you added in Switchboard. The tiles (one row that scrolls sideways)
 * say what's going on in each, most recent first; the project you last started in (or the one with the newest session)
 * is picked for you, so most of the time you only type. Under the prompt, the project's profile (with more than one)
 * and its defaults for model, effort, mode and worktree as chips, to change for this session only. Queue for later puts it in Switchboard's queue instead,
 * while the project has a session working.
 */
export function NewSession({ client, sessions, banner, onBack, onStarted, initialProject = null }: { client: Client; sessions: readonly RemoteSession[]; banner: ReactNode; onBack: (() => void) | null; onStarted: (sessionId: string) => void; /** Picked from the palette (New session in <project>). */ initialProject?: string | null }) {
  const [projects, setProjects] = useState<RemoteProject[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(initialProject);
  const [filter, setFilter] = useState('');
  const [prompt, setPrompt] = useState(() => sessionStorage.getItem(DRAFT) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<RemoteOptions | null>(null);
  /** What you changed for this session, over the project's defaults. */
  const [changes, setChanges] = useState<Partial<Choice>>({});
  const fine = useFinePointer();
  const box = useRef<HTMLTextAreaElement>(null);
  // Read when the projects arrive, without loading them again each time a session changes.
  const latest = useRef(sessions);
  latest.current = sessions;

  useEffect(() => {
    if (!client) return;
    void client.call('projects.list', {}).then(
      ({ projects }) => {
        setProjects(projects);
        setProjectId((current) => current ?? suggestedProject(projects, latest.current, lastProject()));
      },
      (e: Error) => setError(e.message),
    );
    void client.call('options.get', {}).then(setOptions, () => {});
  }, [client]);

  // With a keyboard, the box is ready to type in; on a phone the keyboard waits for a tap.
  useEffect(() => {
    if (fine) box.current?.focus();
  }, [fine]);

  useEffect(() => {
    if (prompt) sessionStorage.setItem(DRAFT, prompt);
    else sessionStorage.removeItem(DRAFT);
  }, [prompt]);

  const pick = (id: string) => {
    // Another project has its own defaults: what you changed was for the one before.
    if (id !== projectId) setChanges({});
    setProjectId(id);
    if (fine) box.current?.focus();
  };

  // Another profile brings its defaults, under the project's own and what you changed.
  const baseProfile = projectProfile(options, projectId);
  const defaults = defaultChoice(options, projectId, changes.profileId ?? baseProfile);
  const choice: Choice = { ...defaults, ...changes };
  const change = (next: Partial<Choice>) => setChanges((current) => ({ ...current, ...next }));
  const ready = Boolean(client && projectId && prompt.trim() && !busy);
  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionId } = await client!.call('session.create', { projectId: projectId!, prompt: prompt.trim(), ...changedFrom(choice, defaults, baseProfile) });
      rememberProject(projectId!);
      sessionStorage.removeItem(DRAFT);
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
      await client!.call('later.add', { projectId: projectId!, prompt: prompt.trim(), ...changedFrom(choice, defaults, baseProfile) });
      toast('Queued for later', { detail: `In ${picked?.name ?? 'the project'}. Start it from the queue in Switchboard.` });
      sessionStorage.removeItem(DRAFT);
      setPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : "It wasn't queued.");
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const needle = filter.trim().toLowerCase();
  const shown = recentProjects(projects ?? [], sessions).filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.id === projectId);
  const picked = projects?.find((p) => p.id === projectId) ?? null;

  // Queue for later only while the project is busy: otherwise starting now is what you want.
  const projectBusy = Boolean(projectId && sessions.some((s) => s.projectId === projectId && s.status === 'working'));

  return (
    <div className="flex h-full flex-col">
      <header className={`safe-top flex items-center gap-2 border-b border-border pb-2 pointer-fine:pb-2.5 ${onBack ? 'px-2' : 'px-5'}`}>
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
          <section aria-labelledby="pick-project" className="flex flex-col gap-2">
            <div className="flex items-center gap-3 px-4 sm:px-6">
              <h2 id="pick-project" className="flex-1 text-meta font-semibold tracking-wide text-faint uppercase">
                Project
              </h2>
              {projects && projects.length >= FILTER_FROM && (
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
            <div role="radiogroup" aria-labelledby="pick-project" className="scroll-row flex snap-x gap-2 px-4 pt-1 pb-2 sm:px-6">
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

          <form
            id="new-session"
            className="flex flex-col gap-3 px-4 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            <div className={`rounded-xl border bg-card p-2 pl-3 transition-[border-color,box-shadow] focus-within:border-accent-ink focus-within:ring-4 focus-within:ring-accent/20 ${projectId ? 'border-edge' : 'border-border'}`}>
              <textarea
                ref={box}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
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
            </div>
            {options && picked && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choices for this session">
                  <ProfileChip options={options} projectId={picked.id} value={choice.profileId} onPick={(profileId) => change({ profileId })} />
                  <ModelChip options={options} value={choice.model} offerAuto={autoOn(options)} onPick={(model) => change({ model })} />
                  {takesEffort(options.models, choice.model) && <EffortChip options={options} value={choice.effort} onPick={(effort) => change({ effort })} />}
                  <ModeChip options={options} value={choice.permissionMode} onPick={(permissionMode) => change({ permissionMode })} />
                  <WorkspaceChip value={choice.worktree} onPick={(worktree) => change({ worktree })} />
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
      <footer className="safe-bottom border-t border-border px-4 pt-2 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
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
            <Button onClick={() => void queue()} disabled={!ready} className="flex-1 sm:flex-none" data-remote-queue>
              Queue for later
            </Button>
          )}
          <Button type="submit" form="new-session" variant="primary" disabled={!ready} data-remote-start className="flex-1 sm:flex-none">
            Start session
            <Kbd shortcut="mod+enter" tone="on-accent" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
