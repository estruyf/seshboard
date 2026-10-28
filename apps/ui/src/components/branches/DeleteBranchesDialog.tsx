import { useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { BranchDeleteResult } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { baseLabel, deletedMessage, deletePlan, isMerged, localLoss, remoteLoss, type BranchRow, type DeleteScope } from './branchGroups.ts';

/**
 * "Delete N branches?": one confirmation for the whole batch. Two choices say which copies go: the local branches
 * (on by default) and their copies on the remote (off unless you asked for them from a row's menu), plus a recovery
 * ref for each local branch. A branch that would lose commits gets a warning with a way to keep it. Cancel has the focus.
 */
export function DeleteBranchesDialog({
  root,
  rows,
  initialScope,
  baseBranch,
  onClose,
  onDone,
}: {
  root: string;
  rows: BranchRow[];
  initialScope: DeleteScope;
  baseBranch: string | null;
  onClose(): void;
  /** After the engine answered: every item's result (failures are shown on the tab). */
  onDone(results: BranchDeleteResult[]): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState<DeleteScope>(initialScope);
  const [recoveryRef, setRecoveryRef] = useState(false);
  /** Branches taken out of the batch from their warning ("Keep this branch"). */
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listed = rows.filter((r) => !kept.has(r.key));
  const plan = deletePlan(listed, scope);
  const withLocal = listed.filter((r) => r.entry.local && !r.localLock);
  const withRemote = listed.filter((r) => r.entry.remote && !r.remoteLock);
  const remotes = [...new Set(withRemote.map((r) => r.entry.remote!.remote))];
  const remoteName = remotes.length === 1 ? remotes[0]! : 'the remote';
  const remoteMerged = withRemote.every((r) => isMerged(r.entry));
  const base = baseBranch ?? 'the base branch';
  const atRisk = plan
    .map((p) => ({ ...p, lostHere: p.local && !recoveryRef ? localLoss(p.row.entry) : 0, lostThere: p.remote ? remoteLoss(p.row.entry, p.local) : 0 }))
    .filter((p) => p.lostHere > 0 || p.lostThere > 0);

  const remove = async () => {
    if (!client || busy || plan.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { results } = await client.call('branches.delete', {
        root,
        items: plan.map((p) => ({ name: p.row.entry.name, local: p.local, remoteRef: p.remote ? p.row.entry.remote!.ref : null, recoveryRef: p.local && recoveryRef })),
      });
      const local = results.filter((r) => r.localDeleted).length;
      const remote = results.filter((r) => r.remoteDeleted).length;
      if (local + remote > 0) toast(deletedMessage(local, remote, remoteName));
      onDone(results);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const count = plan.length;
  return (
    <Dialog
      role="alertdialog"
      width="md"
      title={`Delete ${count} ${count === 1 ? 'branch' : 'branches'}?`}
      subtitle={
        <>
          Uses <span className="font-mono">git branch -D</span>
          {scope.remote && withRemote.length > 0 && (
            <>
              {' '}
              and <span className="font-mono">git push {remotes.length === 1 ? remoteName : '<remote>'} --delete</span>
            </>
          )}
          .
        </>
      }
      onClose={onClose}
      initialFocus={cancelRef}
      data-branch-delete
      footer={
        <>
          <Button ref={cancelRef} kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" filled disabled={busy || !client || count === 0} onClick={() => void remove()} data-branch-delete-confirm>
            {busy ? 'Deleting…' : `Delete ${count}`}
          </Button>
        </>
      }
    >
      <ul className="grid max-h-64 gap-2 overflow-y-auto" aria-label="Branches to delete">
        {listed.map((row) => {
          const step = plan.find((p) => p.row === row);
          const where = [step?.local && 'here', step?.remote && row.entry.remote!.ref].filter(Boolean).join(' · ');
          const stays = [row.entry.local && !step?.local && row.localLock, row.entry.remote && !step?.remote && row.remoteLock && `${row.entry.remote.ref} stays: ${row.remoteLock}`].filter(Boolean);
          return (
            <li key={row.key} className={`grid gap-0.5 rounded-lg border border-edge bg-card px-3 py-2 ${step ? '' : 'opacity-60'}`} data-branch-delete-item={row.key}>
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-ui font-semibold">{row.entry.name}</span>
                <span className="shrink-0 font-mono text-meta text-muted">{where || 'nothing to delete'}</span>
              </div>
              <span className="truncate text-meta text-muted">{baseLabel(row.entry)?.text ?? ''}</span>
              {stays.map((note) => (
                <span key={String(note)} className="truncate text-meta text-faint">
                  {note}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid gap-2">
        <Checkbox checked={scope.local && withLocal.length > 0} disabled={withLocal.length === 0} onChange={(local) => setScope((s) => ({ ...s, local }))} className="text-ui text-text" dataAttrs={{ 'data-branch-delete-local': true }}>
          Delete the local {withLocal.length === 1 ? 'branch' : 'branches'} <span className="text-muted">({withLocal.length})</span>
        </Checkbox>
        <Checkbox checked={scope.remote && withRemote.length > 0} disabled={withRemote.length === 0} onChange={(remote) => setScope((s) => ({ ...s, remote }))} className="text-ui text-text" dataAttrs={{ 'data-branch-delete-remote': true }}>
          Also delete {withRemote.length === 1 ? 'it' : 'them'} on {remoteName}{' '}
          <span className="text-muted">
            ({withRemote.length}
            {withRemote.length > 0 && (remoteMerged ? ', all merged' : `, ${withRemote.filter((r) => !isMerged(r.entry)).length} not merged`)})
          </span>
        </Checkbox>
        {scope.remote && withRemote.length > 0 && <p className="pl-[22px] text-meta text-muted">Everyone who uses {remoteName} loses {withRemote.length === 1 ? 'this branch' : 'these branches'}. This can't be undone from here.</p>}
        <Checkbox checked={recoveryRef && scope.local && withLocal.length > 0} disabled={!scope.local || withLocal.length === 0} onChange={setRecoveryRef} className="text-ui text-text" dataAttrs={{ 'data-branch-delete-recovery-ref': true }}>
          Keep a recovery ref for each local branch <span className="font-mono text-meta text-muted">refs/switchboard/removed/…</span>
        </Checkbox>
      </div>
      {atRisk.map(({ row, lostHere, lostThere }) => (
        <Notice
          key={row.key}
          tone="warn"
          icon={<AlertTriangle size={13} aria-hidden />}
          className="mt-3"
          data-branch-delete-at-risk={row.key}
          actions={
            <Button size="sm" onClick={() => setKept((s) => new Set(s).add(row.key))}>
              Keep this branch
            </Button>
          }
        >
          <span className="font-semibold">
            {lostHere > 0
              ? `${row.entry.name} has ${lostHere} ${lostHere === 1 ? "commit that isn't" : "commits that aren't"} pushed anywhere.`
              : `${row.entry.remote!.ref} has ${lostThere} ${lostThere === 1 ? "commit that isn't" : "commits that aren't"} in ${base}.`}
          </span>{' '}
          Deleting it would lose {(lostHere || lostThere) === 1 ? 'it' : 'them'}
          {lostHere > 0 ? '; a recovery ref keeps them.' : '.'}
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
