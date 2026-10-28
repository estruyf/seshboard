import { ChevronDown, GitBranch, GitMerge, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorktreeStatus } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';

type Finish = 'merge' | 'remove';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line on where the worktree stands. */
function describe(status: WorktreeStatus): string {
  const parts = [
    status.ahead > 0 ? `${plural(status.ahead, 'commit', 'commits')} ahead of ${status.baseBranch}` : `nothing new vs ${status.baseBranch ?? 'base'}`,
    status.behind > 0 && `${status.behind} behind`,
    status.uncommitted > 0 && `${plural(status.uncommitted, 'uncommitted file', 'uncommitted files')}`,
    status.unpushed !== null && (status.unpushed > 0 ? `${status.unpushed} unpushed` : 'pushed'),
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * Finishing a worktree session: merge into the base branch, or remove the worktree (and its branch).
 * Its button is the worktree's branch, in the session header's meta line; a new `openRequest` (the
 * git menu) opens it too. Commit, push and pull requests are on the header's git button.
 */
export function WorktreeMenu({ sessionId, cwd, branch, openRequest = 0 }: { sessionId: string; cwd: string; branch: string | null; openRequest?: number }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const menu = useMenu();
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Finish | null>(null);
  const [deleteBranch, setDeleteBranch] = useState(true);

  const load = () => {
    setError(null);
    client?.call('worktree.status', { cwd }).then(setStatus, (e: Error) => setError(`Couldn't read the worktree: ${e.message}`));
  };

  const base = status?.baseBranch ?? 'the base branch';
  const mergeBlocked = !status
    ? 'Checking…'
    : status.uncommitted > 0
      ? 'Commit or revert the uncommitted changes first'
      : status.ahead === 0
        ? `Nothing to merge into ${base}`
        : status.mainCheckout.branch !== status.baseBranch
          ? `The main checkout is on ${status.mainCheckout.branch ?? 'a detached HEAD'}`
          : status.mainCheckout.dirty
            ? 'The main checkout has uncommitted changes'
            : null;
  const removeBlocked = !status ? 'Checking…' : status.uncommitted > 0 ? 'Commit or revert the uncommitted changes first' : null;

  const entries: MenuEntry[] = [
    { heading: status?.branch ?? 'Worktree' },
    ...(error ? [{ heading: error }] : status ? [{ heading: describe(status) }] : [{ heading: 'Checking…' }]),
    'separator',
    { label: `Merge into ${base}…`, icon: <GitMerge size={13} />, disabled: mergeBlocked !== null, onSelect: () => setConfirm('merge') },
    'separator',
    { label: 'Remove worktree…', icon: <Trash2 size={13} />, danger: true, disabled: removeBlocked !== null, onSelect: () => (setDeleteBranch(true), setConfirm('remove')) },
  ];
  // Say why an action is unavailable, under the actions.
  const why = [mergeBlocked && status && `Merge: ${mergeBlocked}.`, removeBlocked && status && `Remove: ${removeBlocked}.`].filter(Boolean) as string[];
  if (why.length) entries.push('separator', ...why.map((text) => ({ heading: text })));

  const trigger = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (menu.at) return menu.close();
    load();
    if (trigger.current) menu.openBelow(trigger.current);
  };
  const lastRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === lastRequest.current) return;
    lastRequest.current = openRequest;
    if (!menu.at) toggle();
  }, [openRequest]);

  const unsafeToDelete = status !== null && status.ahead > 0 && (status.unpushed === null || status.unpushed > 0);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-worktree-menu
        onClick={toggle}
        data-tooltip="Finish this worktree: merge or remove"
        aria-label={`Worktree${branch ? ` on ${branch}` : ''}: merge or remove`}
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        className={`no-drag inline-flex max-w-64 min-w-0 items-center gap-1 rounded px-0.5 text-muted hover:text-text ${menu.at ? 'text-text' : ''}`}
      >
        <GitBranch size={11} className="shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          <span className="@max-[860px]:hidden">worktree · </span>
          {branch ?? 'worktree'}
        </span>
        <ChevronDown size={11} className="shrink-0 @max-[860px]:hidden" aria-hidden />
      </button>
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={280} entries={entries} onClose={menu.close} label="Worktree" />}

      {confirm && status && client && (
        <ConfirmDialog
          title={confirm === 'merge' ? `Merge ${status.branch} into ${base}?` : `Remove this worktree?`}
          danger={confirm === 'remove'}
          confirmLabel={confirm === 'merge' ? 'Merge' : 'Remove'}
          body={
            confirm === 'merge' ? (
              <p>
                Merges {plural(status.ahead, 'commit', 'commits')} into {base} in the main checkout (<span className="font-mono">{status.root}</span>), in a terminal tab so you can see the result. The worktree stays; remove it afterwards.
              </p>
            ) : (
              <>
                <p>
                  Deletes the folder <span className="font-mono">{status.path}</span> and stops this session in Seshboard. The conversation stays in your history.
                </p>
                <Checkbox checked={deleteBranch} onChange={setDeleteBranch} className="mt-3 text-text" dataAttrs={{ 'data-delete-branch': true }}>
                  Also delete the branch <span className="font-mono">{status.branch}</span>
                </Checkbox>
                {deleteBranch && unsafeToDelete && (
                  <p className="mt-2 text-warn">
                    {plural(status.ahead, 'commit is', 'commits are')} not in {base}
                    {status.unpushed === null ? ' and the branch was never pushed' : ' and not pushed'}: deleting the branch loses {status.ahead === 1 ? 'it' : 'them'}.
                  </p>
                )}
              </>
            )
          }
          onConfirm={async () => {
            await client.call('worktree.finish', { sessionId, cwd, action: confirm, deleteBranch: confirm === 'remove' && deleteBranch });
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
