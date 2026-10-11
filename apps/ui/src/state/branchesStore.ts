import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { isAbsolutePath, type BranchList } from '@switchboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { branchRows, type BranchRow } from '../components/branches/branchGroups.ts';

/** A project's branches as last read. */
export interface BranchesOf {
  list: BranchList | null;
  /** Not a git repository: there is nothing to list. */
  notRepo: boolean;
  error: string | null;
  loading: boolean;
  loadedAt: number | null;
}

const EMPTY: BranchesOf = { list: null, notRepo: false, error: null, loading: false, loadedAt: null };
/** A list this recent is shown without asking again (opening a tab, the Overview). */
const FRESH_MS = 30_000;

interface BranchesState {
  byRoot: Map<string, BranchesOf>;
  patch(root: string, change: Partial<BranchesOf>): void;
}

export const useBranches = create<BranchesState>()((set) => ({
  byRoot: new Map(),
  patch: (root, change) =>
    set((s) => {
      const byRoot = new Map(s.byRoot);
      byRoot.set(root, { ...(s.byRoot.get(root) ?? EMPTY), ...change });
      return { byRoot };
    }),
}));

/** Reads a project's branches; `fetch` runs `git fetch --all --prune` first and asks `gh` again. */
export async function loadBranches(client: EngineClient, root: string, options: { fetch?: boolean } = {}): Promise<BranchList | null> {
  const { patch } = useBranches.getState();
  patch(root, { loading: true });
  try {
    const list = await client.call('branches.list', { root, fetch: options.fetch ?? false });
    patch(root, { list, notRepo: false, error: null, loading: false, loadedAt: Date.now() });
    return list;
  } catch (error) {
    const code = (error as { code?: string }).code;
    patch(root, { loading: false, loadedAt: Date.now(), notRepo: code === 'NOT_A_REPO', error: code === 'NOT_A_REPO' ? null : (error as Error).message });
    return null;
  }
}

/** A project's branches, read when first shown and again once the list is older than half a minute. */
export function useBranchesOf(root: string | null): BranchesOf {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const state = useBranches((s) => (root ? s.byRoot.get(root) : undefined));
  useEffect(() => {
    if (!client || !root || !isAbsolutePath(root)) return;
    const current = useBranches.getState().byRoot.get(root);
    if (current?.loading || (current?.loadedAt && Date.now() - current.loadedAt < FRESH_MS)) return;
    void loadBranches(client, root);
  }, [client, root]);
  return state ?? EMPTY;
}

/** A project's branches grouped for the overview. */
export function useBranchRows(root: string | null): { state: BranchesOf; rows: BranchRow[] } {
  const state = useBranchesOf(root);
  const rows = useMemo(() => (state.list ? branchRows(state.list.branches, state.list.baseBranch, Date.now()) : []), [state.list]);
  return { state, rows };
}
