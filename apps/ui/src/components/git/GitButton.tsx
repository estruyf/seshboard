import {
  CheckCheck,
  ChevronDown,
  CircleCheck,
  CircleMinus,
  CircleX,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PrCheck, PrChecks, GitSyncAction, WorktreePullRequest, WorktreeStatus } from '@switchboard/protocol/client';
import { useReadOnlyFork } from '../../state/githubOriginStore.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useSessionRequests } from '../../state/paletteBus.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals, waitForExit } from '../../state/terminalsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { checksLine, checkTime, checkTitle, failedChecks, fixChecksDraft, MAX_FIX_CHECKS, MENU_CHECKS } from './checks.ts';
import { CommitDialog } from './CommitDialog.tsx';
import { gitSummary, planGit, showsViewPr, STEP_LABEL, stepCount, type GitStep, FORK_READ_ONLY } from './gitPlan.ts';
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

/** A check's state as an icon in its status colour: passed, failed, running (spinning), skipped or cancelled. */
function CheckIcon({ bucket, size = 13 }: { bucket: PrCheck['bucket'] | 'none'; size?: number }): ReactNode {
  if (bucket === 'pass') return <CircleCheck size={size} className="text-ok" aria-hidden />;
  if (bucket === 'fail') return <CircleX size={size} className="text-error" aria-hidden />;
  if (bucket === 'pending') return <LoaderCircle size={size} className="animate-spin text-accent-ink" aria-hidden />;
  return <CircleMinus size={size} className="text-faint" aria-hidden />;
}

/**
 * Split button in the session header. Its face runs the step the checkout needs next (pull when
 * behind, commit when dirty, push when ahead, a pull request when a branch is ready, else fetch), or
 * shows the branch's open pull request (View PR #123) once it has one; the menu has every git step,
 * plus switching branch and starting a worktree session. Commit has Haiku write the message from the changes and
 * commits (Commit… in the menu opens the commit dialog); commit, fetch, pull and push run git in a terminal tab so the
 * output stays visible;
 * Create PR opens the Create pull request dialog. With an open pull request, its checks show as an icon on View PR
 * and as a Checks group in the menu, where failed ones can be handed to Claude with their logs.
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
  /** The open pull request's checks (null until read, or without one). */
  const [checks, setChecks] = useState<PrChecks | null>(null);
  /** Reading failed checks' logs for Claude. */
  const [fixing, setFixing] = useState(false);
  /** A git step is starting: a second click (or ⌘⇧L) waits until it has, instead of running it twice. */
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  /** Ask Claude to commit is writing the message. */
  const [writing, setWriting] = useState(false);
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
  // The open pull request's checks: read when the pane opens, the window comes back or the menu opens (a read from the
  // last few seconds is reused). While some run, the engine reads them again by itself and sends them here.
  const path = status?.path ?? null;
  const openPrNumber = pr?.state === 'open' ? pr.number : null;
  useEffect(() => setChecks(null), [path, openPrNumber]);
  useEffect(() => {
    if (!client || !path || openPrNumber === null) return;
    let cancelled = false;
    client.call('git.prChecks', { cwd, sessionId }).then(
      (result) => !cancelled && setChecks(result.checks),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, sessionId, path, openPrNumber, version]);
  useEffect(() => {
    if (!client || !path || openPrNumber === null) return;
    return client.on('git.checks', (next) => {
      if (next.path === path && next.pr.number === openPrNumber) setChecks(next);
    });
  }, [client, path, openPrNumber]);
  // A push (from the menu, a terminal or Claude) starts new checks: look for them while GitHub starts them.
  const unpushed = status?.unpushed ?? null;
  const lastUnpushed = useRef<{ key: string; count: number | null } | null>(null);
  useEffect(() => {
    const key = `${path}\n${branch}`;
    const before = lastUnpushed.current?.key === key ? lastUnpushed.current.count : null;
    lastUnpushed.current = { key, count: unpushed };
    if (!client || openPrNumber === null || before === null || !(before > 0 && unpushed === 0)) return;
    client.call('git.prChecks', { cwd, sessionId, afterPush: true }).then(
      (result) => setChecks(result.checks),
      () => {},
    );
  }, [client, cwd, sessionId, path, branch, unpushed, openPrNumber]);
  useEffect(() => {
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // A fork's pull request Switchboard can't push back: push and Create PR are off here.
  const readOnly = useReadOnlyFork(sessionId);
  const plan = status ? planGit(status, busy, readOnly) : null;
  const openTerminal = (terminalId: string) => {
    togglePanel(sessionId, true);
    setActive(sessionId, terminalId);
  };
  const run = async (step: GitStep) => {
    setError(null);
    if (step === 'pr') return setCreatingPr(true);
    if (!client || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      if (step === 'commit') {
        // Haiku writes the message from the change alone, in a call of its own: sending the session "commit this"
        // would have the model read the whole conversation again.
        setWriting(true);
        const { message } = await client.call('git.commitMessage', { sessionId, cwd }).finally(() => setWriting(false));
        const { terminalId } = await client.call('git.commit', { sessionId, cwd, message });
        openTerminal(terminalId);
        return;
      }
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

  /**
   * Fix failing checks with Claude: the failed jobs' logs (their ends) as chips in the message box, under a prompt
   * naming the checks. Nothing is sent: you can add to it, and sending while Claude works queues it like any message.
   */
  const fixChecks = async (failed: readonly PrCheck[]) => {
    if (!client || !checks || fixing || failed.length === 0) return;
    setFixing(true);
    setError(null);
    try {
      const picked = failed.slice(0, MAX_FIX_CHECKS);
      const { logs } = await client.call('git.prCheckLogs', { cwd, checks: picked.map(({ name, workflow, link }) => ({ name, workflow, link })) });
      const draft = fixChecksDraft(checks, picked, logs);
      const drafts = useDrafts.getState();
      if (draft.items.length) drafts.addContext(sessionId, draft.items);
      drafts.requestQuote(sessionId, draft.text, { plain: true });
    } catch (e) {
      setError(`Couldn't read the logs of the failed checks: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFixing(false);
    }
  };

  // The palette's Commit…, Create pull request… and Fix failing checks with Claude, in the active pane.
  useSessionRequests(active, (request) => {
    if (request.kind === 'commit' && status && status.uncommitted > 0) setCommitting(true);
    if (request.kind === 'create-pr' && plan?.blocked.pr === null && pr?.state !== 'open') setCreatingPr(true);
    if (request.kind === 'fix-checks' && checks) void fixChecks(failedChecks(checks.checks));
  });

  if (!status || !plan) return null;

  const openPr = pr?.state === 'open' ? pr : null;
  const viewPr = showsViewPr(plan.primary, openPr);
  const openUrl = (url: string) => void window.open(url, '_blank');
  const created = (made: CreatedPr) => {
    setCreatingPr(false);
    setPr({ number: made.number, url: made.url, state: 'open', draft: made.draft });
    setVersion((v) => v + 1);
    // The branch was just pushed: its checks are about to start.
    client?.call('git.prChecks', { cwd, sessionId, afterPush: true }).then(
      (result) => setChecks(result.checks),
      () => {},
    );
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
    if (step === 'commit') return `Ask Claude to commit ${status.uncommitted === 1 ? 'the changed file' : `the ${status.uncommitted} changed files`}. Haiku writes the message from the changes`;
    if (step === 'fetch') return 'Fetch from the remote in a terminal tab, to see whether the upstream moved on';
    if (step === 'pull') return `Pull from ${status.upstream} in a terminal tab (${pullShortcut()})`;
    if (step === 'push') return status.upstream ? `Push to ${status.upstream} in a terminal tab` : `Publish ${status.branch} to ${status.pushRemote} in a terminal tab`;
    return `Push ${status.branch} and create a pull request`;
  };

  const face = plan.primary;
  const FaceIcon = ICON[face];
  // While a step is starting, the face waits (the reason is only for its tooltip).
  const faceBlocked = plan.blocked[face] ?? (writing ? 'Writing the commit message…' : pending ? 'Starting…' : null);
  // The step you clicked is under way (Haiku writing the message, then the terminal opening): say so on the button itself.
  const starting = pending && plan.blocked[face] === null;
  const startingLabel = writing ? 'Writing message…' : 'Starting…';
  const count = COUNT[face] ? stepCount(status, face) : null;
  // The header's one yellow button, whenever there is something to do (pull, commit, push or a PR).
  // With nothing to do the face is Fetch, which stays a quiet bordered button.
  const primary = face !== 'fetch' && faceBlocked === null;
  const step = (s: GitStep, label: string, extra: Partial<Extract<MenuEntry, { label: string }>> = {}): MenuEntry => ({
    label,
    disabled: plan.blocked[s] !== null || pending,
    onSelect: () => void run(s),
    data: { 'data-git-step': s },
    // The menu says why push and Create PR are off on a fork's pull request; a tooltip alone isn't seen in a menu.
    ...(readOnly && (s === 'push' || s === 'pr') ? { detail: FORK_READ_ONLY } : {}),
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
    step('commit', writing ? 'Writing the message…' : 'Ask Claude to commit', { icon: <Sparkles size={13} /> }),
    step('push', 'Push', { icon: <CloudUpload size={13} /> }),
    ...(openPr
      ? [
          { label: `View PR #${openPr.number}`, icon: <ExternalLink size={13} />, hint: openPr.draft ? 'Draft' : 'Open', onSelect: () => openUrl(openPr.url), data: { 'data-git-step': 'view-pr' } } satisfies MenuEntry,
          ...(openPr.draft ? [{ label: 'Mark ready for review', icon: <CheckCheck size={13} />, disabled: readying, onSelect: () => void markReady(), data: { 'data-git-step': 'pr-ready' } } satisfies MenuEntry] : []),
        ]
      : [step('pr', 'Create PR…', { icon: <GitPullRequest size={13} /> })]),
  ];
  // The open pull request's checks, failed ones first (the engine sorts them).
  const prChecks = openPr && checks?.pr.number === openPr.number ? checks : null;
  const failed = prChecks ? failedChecks(prChecks.checks) : [];
  if (prChecks) {
    entries.push('separator', { heading: 'Checks' });
    if (prChecks.error) entries.push({ note: prChecks.error.message });
    else if (prChecks.checks.length === 0) entries.push({ note: 'This pull request has no checks.' });
    const now = Date.now();
    for (const check of prChecks.checks.slice(0, MENU_CHECKS)) {
      entries.push({
        label: check.name,
        detail: check.workflow || check.description || undefined,
        icon: <CheckIcon bucket={check.bucket} />,
        hint: checkTime(check, now) || undefined,
        disabled: !check.link,
        onSelect: () => openUrl(check.link),
        data: { 'data-check': check.bucket },
        ...(check.bucket === 'fail'
          ? { action: { label: `Fix ${checkTitle(check)} with Claude`, icon: <Wrench size={13} aria-hidden />, onSelect: () => void fixChecks([check]), data: { 'data-check-fix': true } } }
          : {}),
      });
    }
    const more = prChecks.checks.length - MENU_CHECKS;
    if (more > 0) entries.push({ label: `${more} more on GitHub`, icon: <ExternalLink size={13} />, onSelect: () => openUrl(`${prChecks.pr.url}/checks`), data: { 'data-checks-more': true } });
    if (failed.length) {
      entries.push({
        label: fixing ? 'Reading the logs…' : 'Fix failing checks with Claude',
        icon: <Wrench size={13} />,
        disabled: fixing,
        onSelect: () => void fixChecks(failed),
        data: { 'data-git-step': 'fix-checks' },
      });
    }
  }
  if (plan.note) entries.push({ note: plan.note, tone: 'warn' });
  entries.push(
    'separator',
    isWorktree
      ? { label: 'Merge or remove worktree…', icon: <GitBranch size={13} />, onSelect: onBranchMenu, data: { 'data-git-step': 'worktree' } }
      : { label: 'Switch branch…', icon: <GitBranch size={13} />, disabled: busy, onSelect: onBranchMenu, data: { 'data-git-step': 'switch' } },
    { label: 'New worktree…', icon: <GitBranchPlus size={13} />, onSelect: onNewWorktree, data: { 'data-git-step': 'worktree-new' } },
  );

  // gh not there or signed out: no icon (the menu's Checks group says why), and none for a pull request without checks.
  const faceChecks = viewPr && prChecks && !prChecks.error && prChecks.summary !== 'none' ? prChecks : null;
  const checksSaid = faceChecks ? checksLine(faceChecks) : null;
  const faceButton = viewPr ? (
    <button
      type="button"
      onClick={() => openUrl(viewPr.url)}
      data-tooltip={error ?? (fixing ? 'Reading the logs of the failed checks…' : checksSaid ? `${checksSaid}. Open pull request #${viewPr.number} on GitHub` : `Open pull request #${viewPr.number} on GitHub`)}
      aria-label={`View PR #${viewPr.number}, ${viewPr.draft ? 'draft' : 'open'}${checksSaid ? `, ${checksSaid}` : ''}`}
      aria-busy={fixing || undefined}
      data-view-pr={viewPr.number}
      data-checks={faceChecks?.summary}
      className={`flex h-7 items-center gap-1.5 rounded-l-md border border-border px-2.5 text-ui text-text hover:bg-border/50 ${error ? 'ring-1 ring-error ring-inset' : ''}`}
    >
      <GitPullRequest size={13} className="text-muted @max-[860px]:hidden" aria-hidden />
      <span>View PR #{viewPr.number}</span>
      {fixing ? <CheckIcon bucket="pending" /> : faceChecks && <CheckIcon bucket={faceChecks.summary} />}
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
        aria-busy={starting || undefined}
        data-tooltip={error ?? (starting ? startingLabel : tooltipFor(face))}
        aria-label={starting ? startingLabel : `${STEP_LABEL[face]}${count ? ` ${count}` : ''}`}
        aria-keyshortcuts={face === 'pull' ? ariaKeysFor('git.pull') : undefined}
        className={`flex h-7 items-center gap-1.5 rounded-l-md px-2.5 text-ui ${primary ? 'bg-accent font-semibold text-on-accent' : 'border border-border text-text'} ${error ? 'ring-1 ring-error ring-inset' : ''} ${faceBlocked ? 'cursor-default opacity-50' : primary ? 'hover:bg-accent/85' : 'hover:bg-border/50'}`}
      >
        {/* A narrow header drops the icon first; under 560px (four panes side by side, or a pop-out at its smallest,
            which also has Move back and Close window) the icon and the count stand in for the word, which stays in the
            label and the tooltip. */}
        {starting ? (
          <LoaderCircle size={13} className="animate-spin" aria-hidden />
        ) : (
          <FaceIcon size={13} className={`@max-[860px]:hidden @max-[560px]:inline ${primary ? '' : 'text-muted'}`} aria-hidden />
        )}
        <span className="@max-[560px]:sr-only">{starting ? startingLabel : STEP_LABEL[face]}</span>
        {!starting && count !== null && count > 0 && (
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
