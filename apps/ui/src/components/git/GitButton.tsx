import { CheckCheck, ChevronDown, CloudDownload, CloudUpload, ExternalLink, GitBranch, GitBranchPlus, GitCommitHorizontal, GitPullRequest, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GitSyncAction, WorktreePullRequest, WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useSessionRequests } from '../../state/paletteBus.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals, waitForExit } from '../../state/terminalsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { CommitDialog } from './CommitDialog.tsx';
import { gitSummary, planGit, showsViewPr, STEP_LABEL, stepCount, type GitStep } from './gitPlan.ts';
import { PullRequestDialog, type CreatedPr } from './PullRequestDialog.tsx';
import { ariaKeysFor, formatKeys, keysFor, matches } from '../../lib/shortcuts.ts';

const ICON: Record<GitStep, typeof GitCommitHorizontal> = { fetch: RefreshCw, commit: GitCommitHorizontal, pull: CloudDownload, push: CloudUpload, pr: GitPullRequest };
/** The count on the button's face (↓ behind, ↑ ahead, files to commit). It sits on the yellow fill, so it keeps the fill's text colour. */
const COUNT: Partial<Record<GitStep, { prefix: string }>> = {
  pull: { prefix: '↓' },
  push: { prefix: '↑' },
  commit: { prefix: '' },
};
const MENU_WIDTH = 280;
const pullShortcut = () => formatKeys(keysFor('git.pull'));

/**
 * Split button in the session header. Its face runs the step the checkout needs next (pull when
 * behind, commit when dirty, push when ahead, a pull request when a branch is ready, else fetch), or
 * shows the branch's open pull request (View PR #123) once it has one; the menu has every git step,
 * plus switching branch and starting a worktree session. Commit asks Claude (or opens the commit
 * dialog from the menu); fetch, pull and push run git in a terminal tab so the output stays visible;
 * Create PR opens the Create pull request dialog.
 * `activity` changes when the session does something, so the status follows along.
 */
export function GitButton({
  sessionId,
  cwd,
  busy,
  active,
  activity,
  isWorktree,
  projectBase,
  onCommit,
  onBranchMenu,
  onNewWorktree,
}: {
  sessionId: string;
  cwd: string;
  busy: boolean;
  /** This session's pane is the active one: ⌘⇧L pulls here. */
  active: boolean;
  activity: string;
  isWorktree: boolean;
  /** The project's default branch, where a pull request goes into first. */
  projectBase: string | null;
  /** Asks Claude to commit. */
  onCommit(): void;
  /** Opens the branch menu (or, in a worktree, the worktree's merge and remove menu). */
  onBranchMenu(): void;
  onNewWorktree(): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const togglePanel = useTerminals((s) => s.togglePanel);
  const setActive = useTerminals((s) => s.setActive);
  // A git command finishing in this session's terminal changes where the branch stands.
  const exited = useTerminals((s) => [...s.terminals.values()].filter((t) => t.sessionId === sessionId && t.exitCode !== null).length);
  const menu = useMenu();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [creatingPr, setCreatingPr] = useState(false);
  /** The branch's newest pull request, from gh (null: none, or no gh). */
  const [pr, setPr] = useState<WorktreePullRequest | null>(null);
  const [readying, setReadying] = useState(false);
  /** A git step is starting: a second click (or ⌘⇧L) waits until it has, instead of running it twice. */
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  /** The folder whose status has been read once. */
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    // Debounced like the Changes panel: a busy turn changes `activity` often. The first read is
    // immediate, so the button is there as soon as the pane opens.
    const timer = setTimeout(
      () => {
        client.call('worktree.status', { cwd }).then(
          (result) => !cancelled && ((loaded.current = cwd), setStatus(result)),
          () => !cancelled && setStatus(null),
        );
      },
      loaded.current === cwd ? 500 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, cwd, activity, exited, version]);
  // The branch's pull request: gh keeps a list for a few minutes, read again when the branch changes or the window comes back.
  const branch = status?.branch ?? null;
  useEffect(() => {
    setPr(null);
    if (!client || !branch) return;
    let cancelled = false;
    client.call('git.prFor', { cwd }).then(
      (result) => !cancelled && setPr(result.pr),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, branch, version]);
  useEffect(() => {
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const plan = status ? planGit(status, busy) : null;
  const openTerminal = (terminalId: string) => {
    togglePanel(sessionId, true);
    setActive(sessionId, terminalId);
  };
  const run = async (step: GitStep) => {
    setError(null);
    if (step === 'commit') return onCommit();
    if (step === 'pr') return setCreatingPr(true);
    if (!client || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const { terminalId } = await client.call('git.sync', { sessionId, cwd, action: step satisfies GitSyncAction });
      openTerminal(terminalId);
    } catch (e) {
      setError(`Couldn't ${STEP_LABEL[step].toLowerCase()}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  // ⌘⇧L pulls while this session is on screen and behind its upstream.
  const pullRef = useRef<(() => void) | null>(null);
  pullRef.current = plan && plan.blocked.pull === null ? () => void run('pull') : null;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      // Not while another view (Settings) covers the session, a dialog is open, or a shortcut recorder took the key.
      if (event.defaultPrevented || useSessions.getState().view !== 'session' || document.querySelector('[aria-modal="true"]')) return;
      if (wrapperRef.current?.closest('[inert]')) return;
      if (matches(event, 'git.pull') && pullRef.current) {
        event.preventDefault();
        pullRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // The palette's Commit… and Create pull request…: their dialogs, in the active pane.
  useSessionRequests(active, (request) => {
    if (request.kind === 'commit' && status && status.uncommitted > 0) setCommitting(true);
    if (request.kind === 'create-pr' && plan?.blocked.pr === null && pr?.state !== 'open') setCreatingPr(true);
  });

  if (!status || !plan) return null;

  const openPr = pr?.state === 'open' ? pr : null;
  const viewPr = showsViewPr(plan.primary, openPr);
  const openUrl = (url: string) => void window.open(url, '_blank');
  const created = (made: CreatedPr) => {
    setCreatingPr(false);
    setPr({ number: made.number, url: made.url, state: 'open', draft: made.draft });
    setVersion((v) => v + 1);
    toast(`Pull request #${made.number} created`, {
      icon: 'pull-request',
      actions: [
        { label: 'Open', primary: true, onSelect: () => openUrl(made.url), data: { 'data-pr-toast-open': true } },
        { label: 'Copy link', onSelect: () => void navigator.clipboard.writeText(made.url), data: { 'data-pr-toast-copy': true } },
      ],
      data: { 'data-pr-toast': String(made.number) },
    });
  };
  // The push was turned down: pull in a terminal tab (merging what the remote has), then the dialog again with your text.
  const pullThenRetry = async () => {
    if (!client) return;
    try {
      const { terminalId } = await client.call('git.sync', { sessionId, cwd, action: 'pull' });
      openTerminal(terminalId);
      if ((await waitForExit(terminalId, 10 * 60_000)) && useTerminals.getState().terminals.get(terminalId)?.exitCode === 0) setCreatingPr(true);
    } catch (e) {
      setError(`Couldn't pull: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const markReady = async () => {
    if (!client || !openPr) return;
    setReadying(true);
    try {
      await client.call('git.prReady', { cwd, number: openPr.number });
      setPr({ ...openPr, draft: false });
    } catch (e) {
      setError(`Couldn't mark #${openPr.number} ready: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReadying(false);
    }
  };

  const tooltipFor = (step: GitStep): string => {
    const blocked = plan.blocked[step];
    if (blocked) return blocked;
    if (step === 'commit') return `Ask Claude to commit ${status.uncommitted === 1 ? 'the changed file' : `the ${status.uncommitted} changed files`}`;
    if (step === 'fetch') return 'Fetch from the remote in a terminal tab, to see whether the upstream moved on';
    if (step === 'pull') return `Pull from ${status.upstream} in a terminal tab (${pullShortcut()})`;
    if (step === 'push') return status.upstream ? `Push to ${status.upstream} in a terminal tab` : `Publish ${status.branch} to ${status.pushRemote} in a terminal tab`;
    return `Push ${status.branch} and create a pull request`;
  };

  const face = plan.primary;
  const FaceIcon = ICON[face];
  // While a step is starting, the face waits (the reason is only for its tooltip).
  const faceBlocked = plan.blocked[face] ?? (pending && face !== 'commit' ? 'Starting…' : null);
  const count = COUNT[face] ? stepCount(status, face) : null;
  // The header's one yellow button, whenever there is something to do (pull, commit, push or a PR).
  // With nothing to do the face is Fetch, which stays a quiet bordered button.
  const primary = face !== 'fetch' && faceBlocked === null;
  const step = (s: GitStep, label: string, extra: Partial<Extract<MenuEntry, { label: string }>> = {}): MenuEntry => ({
    label,
    disabled: plan.blocked[s] !== null || (pending && s !== 'commit'),
    onSelect: () => void run(s),
    data: { 'data-git-step': s },
    ...extra,
  });
  const entries: MenuEntry[] = [
    { title: status.branch ?? 'Detached HEAD', detail: gitSummary(status) },
    'separator',
    step('pull', 'Pull', { icon: <CloudDownload size={13} />, hint: pullShortcut() }),
    step('fetch', 'Fetch', { icon: <RefreshCw size={13} /> }),
    'separator',
    {
      label: 'Commit…',
      icon: <GitCommitHorizontal size={13} />,
      hint: status.uncommitted ? `${status.uncommitted} ${status.uncommitted === 1 ? 'file' : 'files'}` : undefined,
      disabled: plan.blocked.commit !== null,
      onSelect: () => setCommitting(true),
      data: { 'data-git-step': 'commit-dialog' },
    },
    step('commit', 'Ask Claude to commit', { icon: <Sparkles size={13} /> }),
    step('push', 'Push', { icon: <CloudUpload size={13} /> }),
    ...(openPr
      ? [
          { label: `View PR #${openPr.number}`, icon: <ExternalLink size={13} />, hint: openPr.draft ? 'Draft' : 'Open', onSelect: () => openUrl(openPr.url), data: { 'data-git-step': 'view-pr' } } satisfies MenuEntry,
          ...(openPr.draft ? [{ label: 'Mark ready for review', icon: <CheckCheck size={13} />, disabled: readying, onSelect: () => void markReady(), data: { 'data-git-step': 'pr-ready' } } satisfies MenuEntry] : []),
        ]
      : [step('pr', 'Create PR…', { icon: <GitPullRequest size={13} /> })]),
  ];
  if (plan.note) entries.push({ note: plan.note, tone: 'warn' });
  entries.push(
    'separator',
    isWorktree
      ? { label: 'Merge or remove worktree…', icon: <GitBranch size={13} />, onSelect: onBranchMenu, data: { 'data-git-step': 'worktree' } }
      : { label: 'Switch branch…', icon: <GitBranch size={13} />, disabled: busy, onSelect: onBranchMenu, data: { 'data-git-step': 'switch' } },
    { label: 'New worktree…', icon: <GitBranchPlus size={13} />, onSelect: onNewWorktree, data: { 'data-git-step': 'worktree-new' } },
  );

  const faceButton = viewPr ? (
    <button
      type="button"
      onClick={() => openUrl(viewPr.url)}
      data-tooltip={error ?? `Open pull request #${viewPr.number} on GitHub`}
      aria-label={`View PR #${viewPr.number}, ${viewPr.draft ? 'draft' : 'open'}`}
      data-view-pr={viewPr.number}
      className={`flex h-7 items-center gap-1.5 rounded-l-md border border-border px-2.5 text-ui text-text hover:bg-border/50 ${error ? 'ring-1 ring-error ring-inset' : ''}`}
    >
      <GitPullRequest size={13} className="text-muted @max-[860px]:hidden" aria-hidden />
      <span>View PR #{viewPr.number}</span>
      <span aria-hidden className={`rounded px-1.5 text-meta font-medium @max-[860px]:hidden ${viewPr.draft ? 'bg-border/60 text-muted' : 'bg-ok/15 text-ok'}`}>
        {viewPr.draft ? 'Draft' : 'Open'}
      </span>
    </button>
  ) : null;
  const quietFace = viewPr !== null || !primary;

  return (
    <div ref={wrapperRef} className="no-drag relative flex shrink-0" data-git-button={viewPr ? 'view-pr' : face}>
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
      {faceButton ?? (
      <button
        type="button"
        // Not `disabled`: a blocked step stays hoverable and focusable so its tooltip can say why.
        onClick={() => faceBlocked === null && void run(face)}
        aria-disabled={faceBlocked !== null}
        data-tooltip={error ?? tooltipFor(face)}
        aria-label={`${STEP_LABEL[face]}${count ? ` ${count}` : ''}`}
        aria-keyshortcuts={face === 'pull' ? ariaKeysFor('git.pull') : undefined}
        className={`flex h-7 items-center gap-1.5 rounded-l-md px-2.5 text-ui ${primary ? 'bg-accent font-semibold text-on-accent' : 'border border-border text-text'} ${error ? 'ring-1 ring-error ring-inset' : ''} ${faceBlocked ? 'cursor-default opacity-50' : primary ? 'hover:bg-accent/85' : 'hover:bg-border/50'}`}
      >
        <FaceIcon size={13} className={`@max-[860px]:hidden ${primary ? '' : 'text-muted'}`} aria-hidden />
        <span>{STEP_LABEL[face]}</span>
        {count !== null && count > 0 && (
          <span className="tabular-nums" aria-hidden>
            {COUNT[face]!.prefix}
            {count}
          </span>
        )}
      </button>
      )}
      <button
        type="button"
        onClick={() => {
          setVersion((v) => v + 1);
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (menu.at || !rect) menu.close();
          else menu.openAt(rect.right - MENU_WIDTH, rect.bottom + 4);
        }}
        className={`flex h-7 items-center rounded-r-md px-1.5 ${!quietFace ? 'border-l border-on-accent/20 bg-accent text-on-accent hover:bg-accent/85' : 'border border-l-0 border-border text-muted hover:bg-border/50 hover:text-text'}`}
        aria-label="Git: pull, fetch, commit, push, pull request, branches"
        data-tooltip="Git"
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        data-git-menu
      >
        <ChevronDown size={13} aria-hidden />
      </button>
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={MENU_WIDTH} entries={entries} onClose={menu.close} label="Git" />}
      {committing && (
        <CommitDialog
          branch={status.branch}
          files={status.uncommitted}
          onCommit={async (message) => {
            if (!client) throw new Error('Not connected to the engine');
            const { terminalId } = await client.call('git.commit', { sessionId, cwd, message });
            openTerminal(terminalId);
          }}
          onClose={() => setCommitting(false)}
        />
      )}
      {creatingPr && (
        <PullRequestDialog sessionId={sessionId} cwd={cwd} projectBase={projectBase} onClose={() => setCreatingPr(false)} onCreated={created} onPullFirst={() => void pullThenRetry()} />
      )}
    </div>
  );
}
