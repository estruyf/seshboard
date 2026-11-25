import { useEffect } from 'react';
import { worktreeRequestBase, type RpcClient, type WorktreeBase } from '@seshboard/protocol/client';
import type { Contract } from '@seshboard/protocol/client';

/**
 * While the prompt is written for a new worktree, fetches the remote branch it starts from (`origin/dev`), so Start
 * finds it fresh and the worktree is made without waiting on the network. The engine does nothing when that start
 * fetches nothing, and fetches at most once in two minutes.
 */
export function usePrefetchBase(client: RpcClient<Contract> | null, cwd: string | null, worktree: boolean, base: WorktreeBase): void {
  useEffect(() => {
    if (client && cwd && worktree) void client.call('worktree.prefetch', { cwd, baseRef: worktreeRequestBase(base) }).catch(() => {});
  }, [client, cwd, worktree, base]);
}
