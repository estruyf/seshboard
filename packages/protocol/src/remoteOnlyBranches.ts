/** A branch only a remote has, by the name a checkout of it gets. */
export interface RemoteOnlyBranch {
  /** The local branch `git switch` makes for it (`era2`). */
  name: string;
  /** The remote that has it (`origin`). */
  remote: string;
  /** The remote branch it tracks (`origin/era2`). */
  ref: string;
}

/**
 * The branches a checkout can switch to that only a remote has, such as every branch but the default in a fresh clone.
 * `remoteBranches` is `git.branches`' list (`origin/era2`, most recent first). A name more than one remote has comes
 * from `origin`, else from the most recent: `git switch <name>` alone refuses a name that is on two remotes.
 * Plain TypeScript (no zod), shared by the engine and the app.
 */
export function remoteOnlyBranches(local: readonly string[], remoteBranches: readonly string[]): RemoteOnlyBranch[] {
  const byName = new Map<string, RemoteOnlyBranch>();
  for (const ref of remoteBranches) {
    const slash = ref.indexOf('/');
    if (slash <= 0 || slash === ref.length - 1) continue;
    const branch = { name: ref.slice(slash + 1), remote: ref.slice(0, slash), ref };
    if (branch.name === 'HEAD' || local.includes(branch.name)) continue;
    const seen = byName.get(branch.name);
    if (!seen) byName.set(branch.name, branch);
    else if (branch.remote === 'origin' && seen.remote !== 'origin') byName.set(branch.name, branch);
  }
  return [...byName.values()];
}
