import { ChevronDown, CloudDownload, CloudUpload, GitBranch, GitBranchPlus, GitCommitHorizontal, GitPullRequest, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GitSyncAction, WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useSessionRequests } from '../../state/paletteBus.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { CommitDialog } from './CommitDialog.tsx';
import { gitSummary, planGit, STEP_LABEL, stepCount, type GitStep } from './gitPlan.ts';
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
 * behind, commit when dirty, push when ahead, a pull request when a branch is ready, else fetch);
 * the menu has every git step, plus switching branch and starting a worktree session.
 * Commit asks Claude (or opens the commit dialog from the menu); fetch, pull, push and pull request
 * run git (and gh) in a terminal tab so the output stays visible.
 * `activity` changes when the session does something, so the status follows along.
 */
export function GitButton({
  sessionId,
  cwd,
  busy,
  active,
  activity,
  isWorktree,
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

  // The palette's Commit…: the commit dialog, in the active pane.
  useSessionRequests(active, (request) => {
    if (request.kind === 'commit' && status && status.uncommitted > 0) setCommitting(true);
  });

  if (!status || !plan) return null;

  const tooltipFor = (step: GitStep): string => {
    const blocked = plan.blocked[step];
    if (blocked) return blocked;
    if (step === 'commit') return `Ask Claude to commit ${status.uncommitted === 1 ? 'the changed file' : `the ${status.uncommitted} changed files`}`;
    if (step === 'fetch') return 'Fetch from the remote in a terminal tab, to see whether the upstream moved on';
    if (step === 'pull') return `Pull from ${status.upstream} in a terminal tab (${pullShortcut()})`;
    if (step === 'push') return status.upstream ? `Push to ${status.upstream} in a terminal tab` : `Publish ${status.branch} to ${status.pushRemote} in a terminal tab`;
    return `Push ${status.branch}, then open GitHub's pull request page with gh`;
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
    step('pr', 'Create PR', { icon: <GitPullRequest size={13} /> }),
  ];
  if (plan.note) entries.push({ note: plan.note, tone: 'warn' });
  entries.push(
    'separator',
    isWorktree
      ? { label: 'Merge or remove worktree…', icon: <GitBranch size={13} />, onSelect: onBranchMenu, data: { 'data-git-step': 'worktree' } }
      : { label: 'Switch branch…', icon: <GitBranch size={13} />, disabled: busy, onSelect: onBranchMenu, data: { 'data-git-step': 'switch' } },
    { label: 'New worktree…', icon: <GitBranchPlus size={13} />, onSelect: onNewWorktree, data: { 'data-git-step': 'worktree-new' } },
  );

  return (
    <div ref={wrapperRef} className="no-drag relative flex shrink-0" data-git-button={face}>
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
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
      <button
        type="button"
        onClick={() => {
          setVersion((v) => v + 1);
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (menu.at || !rect) menu.close();
          else menu.openAt(rect.right - MENU_WIDTH, rect.bottom + 4);
        }}
        className={`flex h-7 items-center rounded-r-md px-1.5 ${primary ? 'border-l border-on-accent/20 bg-accent text-on-accent hover:bg-accent/85' : 'border border-l-0 border-border text-muted hover:bg-border/50 hover:text-text'}`}
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
    </div>
  );
}
