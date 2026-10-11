import { ChevronDown, ChevronRight, Folder, FolderGit2, GitBranch, GitBranchPlus, SquarePen } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ImageAttachment, LaterDraft, ProjectInspection } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename } from '../../lib/format.ts';
import { nextMode } from '../../lib/modes.ts';
import { passFocusGate, useFocus } from '../../state/focusGate.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { addToQueue } from '../../state/laterStore.ts';
import { busyInProject } from '../../state/queue.ts';
import { useListedRows } from '../../state/useQueue.ts';
import { matches, modKey } from '../../lib/shortcuts.ts';
import { INITIAL_QUESTION_CHOICES, isQuestionsFolder, QUESTION_DEFAULTS_KEY, questionPatch, questionStartingChoices, readQuestionChoices, sessionOptions, type QuestionChoices } from '../../lib/questions.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { newDraftKey } from '../../state/drafts.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { AttachmentThumbs, DropOverlay } from '../composer/Attachments.tsx';
import { ComposerChipRow } from '../composer/ComposerChips.tsx';
import { useAttachments } from '../composer/useAttachments.ts';
import { ChoiceMenu } from '../newSession/ChoiceMenu.tsx';
import { StartButton } from '../newSession/StartButton.tsx';
import { focusStartBlock, startButtonState } from '../newSession/startMenu.ts';
import { DEFAULTS_KEY, globalPatch, INITIAL_CHOICES, readGlobals, startingChoices, type Choices, type GlobalChoices } from '../newSession/choices.ts';
import { checkoutBranchFor, shouldPrewarm, startNewSession } from '../newSession/startSession.ts';
import { branchLabel, branchNote, freshBase } from '../newSession/trayLabels.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { filterBranches } from '../worktree/branchMenu.ts';
import { PaletteFooter } from './PaletteFooter.tsx';

/**
 * Prompts written (and images attached) here and not started are New session drafts of their project, shared with
 * the New session view: Esc keeps them for the next time the step (or New session) opens there.
 */
const savedDraft = (root: string) => useDrafts.getState().drafts[newDraftKey(root)];
const forget = (root: string) => useDrafts.getState().removeDraft(newDraftKey(root));

/**
 * The palette's last step of New session: a small New session form with the project's defaults. The
 * route (this checkout and its branch, or a new worktree), the prompt, and the profile, model, effort
 * and mode chips. ⌘↵ starts it the same way the New session view does; ⌘⇧↵ adds it to the queue; ⌘E moves it there. Clicking
 * the project picks another one; `from` is the project the prompt was written for before that. In the quick
 * questions folder there is no route to choose: no git, and the choices remembered for questions.
 */
export function PromptStep({ root, from, worktree, chip, onBack, onChangeProject, onDone }: { root: string; from?: string; worktree: boolean; chip: string; onBack(): void; onChangeProject(): void; onDone(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const project = useProjects((s) => s.projects.get(root));
  const question = useProjects((s) => isQuestionsFolder(root, s.questionsDir));
  const options = sessionOptions(question);
  const isProject = project?.added ?? false;
  const projectDefaults = isProject ? project!.defaults : null;
  const models = useHosts((s) => s.models);
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = useProfiles((s) => s.defaultId);
  const [globals, setGlobals] = useState<GlobalChoices>(INITIAL_CHOICES);
  const [questionChoices, setQuestionChoices] = useState<QuestionChoices>(INITIAL_QUESTION_CHOICES);
  const [loaded, setLoaded] = useState(false);
  /** Changed here: the project's defaults arriving late must not undo it. */
  const touched = useRef(false);
  const [d, setD] = useState<Choices>(() => ({ ...startingChoices(INITIAL_CHOICES, projectDefaults), ...(worktree ? { workspace: 'worktree' as const } : {}) }));
  const [profileOverride, setProfileOverride] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [gitBranches, setGitBranches] = useState<{ current: string | null; branches: string[] }>({ current: null, branches: [] });
  const [gitStatus, setGitStatus] = useState<{ remote: string | null; baseBranch: string | null; behindUpstream: number | null } | null>(null);
  const moved = from && from !== root ? from : null;
  const [saved] = useState(() => (moved ? savedDraft(moved) : undefined) ?? savedDraft(root));
  const [text, setText] = useState(saved?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What a paste or drop left out. */
  const [notice, setNotice] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const projectProfile = project?.profileId && profiles.some((p) => p.id === project.profileId) ? project.profileId : null;
  const profileId = (profileOverride && profiles.some((p) => p.id === profileOverride) ? profileOverride : null) ?? projectProfile ?? defaultProfile;
  const name = project?.name ?? basename(root);
  /** Sessions busy in this project: a queued prompt would wait for them. */
  const workingHere = busyInProject(useListedRows(), root).length;

  // The choices last made in New session, under the project's defaults (a quick question's own, for one).
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    if (question) {
      client.call('appState.get', { key: QUESTION_DEFAULTS_KEY }).then(
        ({ value }) => !cancelled && (setQuestionChoices(readQuestionChoices(value)), setLoaded(true)),
        () => !cancelled && setLoaded(true),
      );
    } else {
      client.call('appState.get', { key: DEFAULTS_KEY }).then(
        ({ value }) => !cancelled && (setGlobals(readGlobals(value).globals), setLoaded(true)),
        () => !cancelled && setLoaded(true),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [client, question]);
  const defaultsKey = JSON.stringify(projectDefaults);
  useEffect(() => {
    if (!loaded || touched.current) return;
    if (question) {
      setD(questionStartingChoices(questionChoices));
      return;
    }
    const choices = startingChoices(globals, projectDefaults);
    setD(worktree ? { ...choices, workspace: 'worktree' } : choices);
  }, [loaded, globals, defaultsKey, worktree, question, questionChoices]);

  // Is it a git repository, on which branch, and where would a worktree branch from.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('projects.inspect', { path: root }).then((r) => !cancelled && setInspection(r), (e: Error) => !cancelled && setError(`Couldn't check this folder: ${e.message}`));
    if (options.git) {
      client.call('git.branches', { cwd: root }).then((r) => !cancelled && setGitBranches(r), () => {});
      client.call('worktree.status', { cwd: root }).then((r) => !cancelled && setGitStatus({ remote: r.pushRemote, baseBranch: r.baseBranch, behindUpstream: r.behindUpstream }), () => {});
    }
    return () => {
      cancelled = true;
    };
  }, [client, root, options.git]);
  // Warm Claude Code up for the folder while the prompt is written, as New session does.
  useEffect(() => {
    if (client && shouldPrewarm(d)) void client.call('session.prewarm', { cwd: root, profileId });
  }, [client, root, d.workspace, d.branch, profileId]);

  const canWorktree = options.git && (inspection?.isGitRepo ?? false);
  const useWorktree = d.workspace === 'worktree' && canWorktree;
  const checkoutBranch = checkoutBranchFor(d, useWorktree, gitBranches.current);
  const trayBranch = branchLabel({
    worktree: useWorktree,
    baseRef: d.baseRef,
    remote: gitStatus?.remote ?? null,
    baseBranch: gitStatus?.baseBranch ?? null,
    current: gitBranches.current ?? inspection?.branch ?? null,
    checkoutBranch,
    isGitRepo: inspection?.isGitRepo ?? null,
  });
  const branchOptions = d.branch && !gitBranches.branches.includes(d.branch) ? [d.branch, ...gitBranches.branches] : gitBranches.branches;
  const blocked = !client ? 'Connecting to the engine…' : inspection && !inspection.exists ? 'This folder no longer exists' : null;
  const canStart = !busy && !blocked && text.trim() !== '';
  const focus = useFocus();
  // Pasting or dropping images and files works as in the message box.
  const { attachments, setAttachments, onPaste, drop } = useAttachments({ initial: saved?.attachments, rootRef: zoneRef, textareaRef: textRef, cwd: root, disabledReason: blocked, setText, onNotice: setNotice });
  useEffect(() => {
    useDrafts.getState().setDraft(newDraftKey(root), { text, attachments });
  }, [root, text, attachments]);
  // The prompt moved here from the project it was first written for.
  useEffect(() => {
    if (moved && savedDraft(moved)) forget(moved);
  }, [moved]);

  // As in New session: a choice the project doesn't decide is remembered for next time.
  const update = (patch: Partial<Choices>) => {
    touched.current = true;
    setD((current) => ({ ...current, ...patch }));
    if (question) {
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
    const remembered = globalPatch(patch, projectDefaults);
    if (Object.keys(remembered).length) {
      setGlobals((current) => {
        const next = { ...current, ...remembered };
        void client?.call('appState.set', { key: DEFAULTS_KEY, value: { ...next, cwd: root } });
        return next;
      });
    }
  };

  const laterDraft = (prompt: string): LaterDraft => ({
    cwd: root,
    prompt,
    attachments,
    model: d.model || null,
    effort: d.effort || null,
    permissionMode: d.permissionMode,
    workspace: useWorktree ? 'worktree' : 'current',
    baseRef: d.baseRef,
    branch: !useWorktree && d.branch ? d.branch : null,
    profileId: profileOverride,
  });

  /** `worktree`: Start's menu can start in a new worktree for once, without turning the switch on. */
  const start = async (worktree = useWorktree) => {
    if (!client || !canStart) return;
    const prompt = text.trim();
    setBusy(true);
    setError(null);
    const finish = () => {
      forget(root);
      onDone();
    };
    try {
      const outcome = await startNewSession(
        {
          cwd: root,
          prompt,
          attachments,
          choices: d,
          worktree,
          currentBranch: gitBranches.current,
          profileId,
          addProject: options.addAsProject && !isProject && !!inspection?.exists,
          saveForLater: () => addToQueue(laterDraft(prompt)),
        },
        {
          createSession: (params) => client.call('session.create', params),
          gate: passFocusGate,
          addProject: (path) => client.call('projects.add', { path }).then(() => useProjects.getState().reload()),
          open: (sessionId) => {
            finish();
            useSessions.getState().select(sessionId);
          },
        },
      );
      if (outcome.kind === 'saved') finish();
      else if (outcome.kind === 'stopped') setBusy(false);
    } catch (e) {
      setError(`Couldn't start the session: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  /** ⌘⇧↵ or Queue: adds the prompt to the queue (waiting for this project) and closes, as New session's Add to queue does. */
  const queue = async () => {
    if (!client || !canStart) return;
    setBusy(true);
    setError(null);
    try {
      await addToQueue(laterDraft(text.trim()));
      forget(root);
      onDone();
    } catch (e) {
      setError(`Couldn't add it to the queue: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  /** ⌘E: the full New session view, with this project, these choices and the prompt so far. */
  const moreOptions = () => {
    usePaletteBus.getState().handOff({ root, prompt: text, attachments, choices: d, worktree: useWorktree, profileId: profileOverride });
    forget(root);
    onDone();
    useSessions.getState().openNewSession();
  };

  const modelLabel = d.model ? (models.find((m) => m.value === d.model)?.displayName ?? d.model) : 'Default model';
  return (
    // The whole step takes dropped files, like a session view.
    <div ref={zoneRef} className="relative flex min-h-0 flex-1 flex-col" data-drop-zone>
      <DropOverlay drop={drop} />
      {/* The route: the command and project as chips, then where the session works. */}
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-edge px-3" data-palette-route>
        <Pill icon={worktree ? <GitBranchPlus size={12} aria-hidden /> : <SquarePen size={12} aria-hidden />}>{chip}</Pill>
        <ChevronRight size={13} className="shrink-0 text-faint" aria-hidden />
        <Pill
          icon={<ProjectIcon project={project} root={root} size={14} />}
          onClick={onChangeProject}
          aria-label={question ? 'No project. Pick a project instead' : `Change project, ${name}`}
          data-tooltip={question ? 'Pick a project instead' : `Change project · ${root}`}
          data-palette-route-project={root}
        >
          {question ? 'No project' : name}
          <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />
        </Pill>
        {question ? (
          <span className="min-w-0 truncate px-2 text-ui text-muted" data-palette-route-question>
            Claude works in a scratch folder
          </span>
        ) : inspection?.isGitRepo === false ? (
          <span className="flex min-w-0 items-center gap-1.5 px-2 text-ui text-muted">
            <Folder size={13} className="shrink-0" aria-hidden />
            <span className="truncate">This folder · no git</span>
          </span>
        ) : useWorktree ? (
          <ChoiceMenu
            name="palette-base"
            value={d.baseRef}
            onChange={(baseRef) => update({ baseRef })}
            title="The branch the new worktree starts from"
            heading="Branch from"
            chevron
            mono
            width={300}
            choices={[
              { value: 'fresh', label: freshBase(gitStatus?.remote ?? null, gitStatus?.baseBranch ?? null), note: 'default', description: "Claude Code's default" },
              { value: 'head', label: gitBranches.current ?? 'HEAD', note: 'local HEAD', description: 'Includes your unpushed commits' },
            ]}
          >
            <FolderGit2 size={13} className="shrink-0" aria-hidden />
            <span className="truncate" data-palette-route-branch>
              New worktree · {trayBranch}
            </span>
          </ChoiceMenu>
        ) : (
          <ChoiceMenu
            name="palette-branch"
            value={checkoutBranch ?? gitBranches.current ?? ''}
            onChange={(b) => update({ branch: b === gitBranches.current ? '' : b })}
            title="Check out a branch before the session starts. Git keeps uncommitted changes, or refuses when they conflict."
            heading="Branch"
            chevron
            mono
            search="Search branches"
            width={300}
            disabled={gitBranches.branches.length === 0}
            choices={[
              ...(gitBranches.current ? [] : [{ value: '', label: 'Stay on the current checkout' }]),
              ...filterBranches(branchOptions, gitBranches.current, '').map((b) => ({ value: b, label: b, note: branchNote(b, gitBranches.current, gitStatus?.behindUpstream ?? null) })),
            ]}
          >
            <GitBranch size={13} className="shrink-0" aria-hidden />
            <span className="truncate" data-palette-route-branch>
              Current checkout · {trayBranch}
            </span>
          </ChoiceMenu>
        )}
        <span className="flex-1" />
        {workingHere > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 text-meta text-accent-ink" data-palette-busy={workingHere}>
            <span aria-hidden className="size-1.5 rounded-full bg-accent-ink" />
            {workingHere} working here
          </span>
        )}
        {options.git && (
          <label className={`flex shrink-0 items-center gap-2 text-ui ${canWorktree ? 'cursor-pointer text-muted' : 'text-faint'}`} data-tooltip={canWorktree ? 'Work in an isolated copy of the repository' : 'Needs a git repository'}>
            Worktree
            <Switch checked={useWorktree} disabled={!canWorktree} onChange={(on) => update({ workspace: on ? 'worktree' : 'current' })} dataAttrs={{ 'data-palette-worktree': true }} />
          </label>
        )}
      </div>

      <label htmlFor={`${labelId}-prompt`} className="sr-only">
        {question ? 'Your question' : `Prompt for the new session in ${name}`}
      </label>
      <textarea
        ref={textRef}
        id={`${labelId}-prompt`}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          // Keys the palette takes for itself don't also reach the window's shortcuts (⌘E, ⌘↵).
          if (matches(e.nativeEvent, 'new-session.queue')) (e.preventDefault(), e.stopPropagation(), void queue());
          else if (modKey(e) && e.key === 'Enter') (e.preventDefault(), e.stopPropagation(), void start());
          else if (modKey(e) && !e.shiftKey && e.key.toLowerCase() === 'e') (e.preventDefault(), e.stopPropagation(), moreOptions());
          else if (e.key === 'Backspace' && text === '') (e.preventDefault(), onBack());
          else if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey) (e.preventDefault(), update({ permissionMode: nextMode(d.permissionMode) }));
        }}
        placeholder={question ? 'Ask Claude anything' : 'What should Claude work on?'}
        spellCheck={false}
        rows={4}
        className="min-h-28 w-full shrink-0 resize-none bg-transparent px-4 pt-3.5 pb-2 text-body text-text outline-none placeholder:text-faint"
        data-palette-prompt
      />
      <AttachmentThumbs
        attachments={attachments}
        className="shrink-0 px-4 pb-2"
        onRemove={(i) => {
          setAttachments((current) => current.filter((_, j) => j !== i));
          textRef.current?.focus();
        }}
      />

      <div className="flex shrink-0 items-center gap-2 px-3 pb-3">
        <div className="min-w-0 flex-1">
          <ComposerChipRow
            names={{ profile: 'palette-profile', model: 'palette-model', effort: 'palette-effort', mode: 'palette-mode' }}
            profile={{ value: profileId, onChange: (id) => setProfileOverride(id), labelFor: (p) => `${p.name}${p.id === (projectProfile ?? defaultProfile) ? (projectProfile ? ' (project)' : ' (default)') : ''}` }}
            model={{
              value: d.model,
              label: modelLabel,
              onChange: (model) => update({ model }),
              choices: [
                { value: '', label: 'Default model', description: models.find((m) => m.value === 'default')?.description || 'What Claude Code would pick' },
                ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName, description: m.description })),
              ],
            }}
            effort={{ value: d.effort, onChange: (effort) => update({ effort }) }}
            mode={{ value: d.permissionMode, onChange: (permissionMode) => update({ permissionMode }) }}
          />
        </div>
        <StartButton
          state={startButtonState({ blocked, sending: busy, hasMessage: text.trim() !== '', hasText: text.trim() !== '', startBlocked: focusStartBlock(focus), canWorktree, worktree: useWorktree, question })}
          onAction={(action) => void (action === 'queue' ? queue() : start(action === 'start-worktree' || useWorktree))}
          data={{ 'data-palette-start': true }}
          itemData={{ queue: { 'data-palette-queue': true } }}
        />
      </div>
      {(error ?? notice) && (
        <p role="alert" className="shrink-0 px-4 pb-2 text-ui text-error">
          {error ?? notice}
        </p>
      )}

      <PaletteFooter
        keys={[
          { keys: '⌘↵', label: 'start' },
          { keys: '⌘⇧↵', label: 'add to queue' },
          { keys: '⌘E', label: 'more options' },
          { keys: '⌫', label: 'back' },
          { keys: 'Esc', label: 'close, keeps the draft' },
        ]}
      />
    </div>
  );
}
