import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WorktreeEntry, WorktreeRemoveResult, WorktreeSize } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { branchChoice, formatBytes, freedBytes, ignoredLine, isMerged, mergeLabel, removedMessage } from './worktreeGroups.ts';

/** A worktree's branch and where it stands, for the confirmation: "worktree-x · merged", "folder missing · git worktree prune". */
function describe(entry: WorktreeEntry): string {
  if (entry.missing) return `${entry.branch ? `${entry.branch} · ` : ''}folder missing · git worktree prune`;
  const state = mergeLabel(entry)?.text ?? (entry.ahead === 0 ? 'no commits of its own' : entry.unpushed > 0 ? `${entry.unpushed} not pushed` : 'not merged');
  return [entry.branch ?? 'detached HEAD', state].join(' · ');
}

/**
 * "Remove N worktrees?": one confirmation for the whole batch. Lists what goes, how much it frees and the ignored
 * files that would be lost, and asks whether the branches go too (on by default only when every one is merged). A
 * branch with commits no remote has gets a warning with a way to push it or keep it. Cancel has the focus.
 */
export function CleanupDialog({
  root,
  entries,
  sizes,
  onClose,
  onDone,
}: {
  root: string;
  entries: WorktreeEntry[];
  sizes: ReadonlyMap<string, WorktreeSize>;
  onClose(): void;
  /** After the engine answered: every item's result (failures are shown on the tab). */
  onDone(results: WorktreeRemoveResult[]): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const choice = useMemo(() => branchChoice(entries), [entries]);
  const [deleteBranches, setDeleteBranches] = useState(choice.defaultOn);
  const [recoveryRef, setRecoveryRef] = useState(false);
  /** Worktrees whose branch stays even with "Also delete their branches" on ("Remove worktree, keep branch"). */
  const [keepBranch, setKeepBranch] = useState<Set<string>>(new Set());
  /** Branches pushed from here, so their warning goes away. */
  const [pushed, setPushed] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Map<string, { files: string[]; total: number }>>(new Map());
  const [busy, setBusy] = useState(false);
  /** How far a removal got, per worktree: they go one by one, so a slow or failed one doesn't hide the rest. */
  const [progress, setProgress] = useState<Map<string, 'removing' | 'removed' | { error: string }>>(new Map());
  const stopRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const freed = freedBytes(
    entries.filter((e) => !e.missing).map((e) => e.path),
    sizes,
  );

  // Ignored files may hold work (a local .env): read them for every worktree that still has a folder.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    for (const entry of entries) {
      if (entry.missing) continue;
      client.call('worktrees.ignoredFiles', { path: entry.path }).then(
        (result) => !cancelled && setIgnored((m) => new Map(m).set(entry.path, result)),
        () => {},
      );
    }
    return () => {
      cancelled = true;
    };
  }, [client, entries]);

  const losesWork = (entry: WorktreeEntry) => deleteBranches && !recoveryRef && entry.branch !== null && !keepBranch.has(entry.path) && !pushed.has(entry.path) && entry.unpushed > 0 && !isMerged(entry);
  const atRisk = entries.filter(losesWork);

  const push = async (entry: WorktreeEntry) => {
    if (!client) return;
    setPushing(entry.path);
    setError(null);
    try {
      await client.call('worktrees.push', { path: entry.path });
      setPushed((s) => new Set(s).add(entry.path));
      toast(`Pushed ${entry.branch}`);
    } catch (e) {
      setError(`Couldn't push ${entry.branch}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPushing(null);
    }
  };

  const remove = async () => {
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    stopRef.current = false;
    const results: WorktreeRemoveResult[] = [];
    const mark = (path: string, state: 'removing' | 'removed' | { error: string }) => setProgress((m) => new Map(m).set(path, state));
    let interrupted = false;
    for (const e of entries) {
      if (stopRef.current) break;
      mark(e.path, 'removing');
      try {
        // One call per worktree: each is short, and its result shows as soon as it is done.
        const { results: one } = await client.call('worktrees.remove', {
          root,
          items: [{ path: e.path, deleteBranch: deleteBranches && e.branch !== null && !keepBranch.has(e.path), recoveryRef: recoveryRef && e.branch !== null }],
        });
        const result = one[0]!;
        results.push(result);
        mark(e.path, result.ok ? 'removed' : { error: result.error ?? 'Failed' });
      } catch (err) {
        // A timeout doesn't say whether git finished: the tab reads the list again and shows what is left.
        mark(e.path, { error: `No answer: ${err instanceof Error ? err.message : String(err)}` });
        setError('Stopped at a worktree that did not answer. The list is read again to show what is left.');
        interrupted = true;
        break;
      }
    }
    const removed = results.filter((r) => r.ok);
    if (removed.length) {
      toast(
        removedMessage(
          removed.length,
          freedBytes(
            removed.map((r) => r.path),
            sizes,
          ).bytes,
        ),
      );
    }
    onDone(results);
    if (interrupted || results.some((r) => !r.ok)) setBusy(false);
    else onClose();
  };

  const count = entries.length;
  const anyBranch = entries.some((e) => e.branch);
  return (
    <Dialog
      role="alertdialog"
      width="md"
      title={`Remove ${count} ${count === 1 ? 'worktree' : 'worktrees'}?`}
      subtitle={
        <>
          Uses <span className="font-mono">git worktree remove</span>
          {freed.bytes > 0 ? `. Frees about ${formatBytes(freed.bytes)}.` : '.'}
        </>
      }
      onClose={onClose}
      initialFocus={cancelRef}
      data-worktree-cleanup
      footer={
        <>
          <Button ref={cancelRef} kbd="Esc" onClick={busy ? () => (stopRef.current = true) : onClose}>
            {busy ? 'Stop after this one' : 'Cancel'}
          </Button>
          <Button variant="danger" filled disabled={busy || !client} onClick={() => void remove()} data-worktree-cleanup-confirm>
            {busy ? `Removing ${Math.min(progress.size, count)} of ${count}…` : `Remove ${count}`}
          </Button>
        </>
      }
    >
      <ul className="grid gap-2" aria-label="Worktrees to remove">
        {entries.map((entry) => {
          const files = ignored.get(entry.path);
          const size = sizes.get(entry.path);
          const state = progress.get(entry.path);
          return (
            <li key={entry.path} className="grid gap-0.5 rounded-lg border border-edge bg-card px-3 py-2" data-cleanup-item={entry.path}>
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-ui font-semibold">{entry.name}</span>
                <span className="shrink-0 font-mono text-meta text-muted">{entry.missing ? '0 B' : size ? formatBytes(size.bytes) : '…'}</span>
              </div>
              <span className="truncate font-mono text-meta text-muted">{describe(entry)}</span>
              {state && (
                <span className={typeof state === 'object' ? 'text-meta text-error' : 'text-meta text-muted'} data-cleanup-state={typeof state === 'object' ? 'failed' : state}>
                  {state === 'removing' ? 'Removing…' : state === 'removed' ? 'Removed' : state.error}
                </span>
              )}
              {files && files.total > 0 && !state && (
                <span className="text-meta text-caution" data-cleanup-ignored>
                  Ignored files that will be deleted: <span className="font-mono">{ignoredLine(files.files, files.total)}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid gap-2">
        <Checkbox checked={deleteBranches && anyBranch} disabled={!anyBranch} onChange={setDeleteBranches} className="text-ui text-text" dataAttrs={{ 'data-cleanup-delete-branches': true }}>
          Also delete their branches {choice.note && <span className="text-muted">({choice.note})</span>}
        </Checkbox>
        <Checkbox checked={recoveryRef && anyBranch} disabled={!anyBranch} onChange={setRecoveryRef} className="text-ui text-text" dataAttrs={{ 'data-cleanup-recovery-ref': true }}>
          Keep a recovery ref for each branch <span className="font-mono text-meta text-muted">refs/switchboard/removed/…</span>
        </Checkbox>
      </div>
      {atRisk.map((entry) => (
        <Notice
          key={entry.path}
          tone="warn"
          icon={<AlertTriangle size={13} aria-hidden />}
          className="mt-3"
          data-cleanup-unpushed={entry.path}
          actions={
            <>
              <Button size="sm" disabled={pushing !== null} onClick={() => void push(entry)}>
                {pushing === entry.path ? 'Pushing…' : 'Push branch'}
              </Button>
              <Button size="sm" onClick={() => setKeepBranch((s) => new Set(s).add(entry.path))}>
                Remove worktree, keep branch
              </Button>
            </>
          }
        >
          <span className="font-semibold">
            {entry.name} has {entry.unpushed} {entry.unpushed === 1 ? "commit that isn't" : "commits that aren't"} pushed.
          </span>{' '}
          Deleting its branch would lose {entry.unpushed === 1 ? 'it' : 'them'}.
        </Notice>
      ))}
      {error && (
        <p role="alert" className="mt-3 text-ui text-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
