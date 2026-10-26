import { mkdirSync } from 'node:fs';
import { cloneFolderProblem, CloneSettings, isLocalAbsolutePath, isSameOrInside, joinPath, parseGithubRepo, pathInside, RpcError, separatorOf, type ClonePlan, type CloneProgress, type GithubRepoRef } from '@seshboard/protocol';
import type { AppStateStore } from '../db/appState.ts';
import { CloneCancelled, cloneCommand, ghSignedIn, readRepoBrings, runClone, targetState, type CloneRun } from '../git/clone.ts';
import { git } from '../git/gitChanges.ts';
import type { GhCommand } from '../git/pullRequest.ts';

const SETTINGS_KEY = 'clone.settings';
const OFF: CloneSettings = { enabled: false, folder: null };

export interface CloneServiceOptions {
  appState: AppStateStore;
  home: string;
  /** The login shell's environment (PATH for git and gh, the user's git config). */
  env(): Promise<Record<string, string>>;
  gh: GhCommand;
  /**
   * Clone from this folder instead of GitHub (`<source>/<owner>/<name>.git`), and never with gh: the smoke run and
   * tests, which must never clone from the network. Never set in normal use.
   */
  source?: string;
  addProject(root: string): void;
  /** Whether `root` is one of your projects already. */
  isProject(root: string): boolean;
  progress(progress: CloneProgress): void;
  settingsChanged(settings: CloneSettings): void;
  log(level: 'info' | 'warn', message: string): void;
  platform?: string;
}

/** A clone the service runs: where it goes, so a second one there waits its turn. */
interface Job {
  target: string;
  run: CloneRun | null;
  cancelled: boolean;
}

/**
 * Clone from GitHub (Settings › Projects): the setting, kept per computer in the engine; where a clone goes; the clone
 * itself as a job that reports `projects.cloneProgress`; and Cancel. A finished clone becomes a project here, so a
 * clone started from another computer shows there as a tile too.
 */
export class CloneService {
  private readonly jobs = new Map<string, Job>();
  private readonly platform: string;

  constructor(private readonly options: CloneServiceOptions) {
    this.platform = options.platform ?? process.platform;
  }

  settings(): CloneSettings {
    const saved = CloneSettings.safeParse(this.options.appState.get(SETTINGS_KEY));
    if (!saved.success) return OFF;
    // A folder from a settings file of another OS can't be used here.
    const folder = saved.data.folder && isLocalAbsolutePath(saved.data.folder, this.platform) ? saved.data.folder : null;
    return { enabled: saved.data.enabled && folder !== null, folder };
  }

  setSettings(change: Partial<CloneSettings>): CloneSettings {
    const next = { ...this.settings(), ...change };
    if (next.folder !== null && !isLocalAbsolutePath(next.folder, this.platform)) throw new RpcError('INVALID', 'Choose a folder on this computer.');
    if (next.enabled && !next.folder) throw new RpcError('INVALID', 'Choose the folder new projects go in first.');
    this.options.appState.set(SETTINGS_KEY, next);
    this.options.settingsChanged(next);
    return next;
  }

  /** The repository a URL names, or INVALID with why. */
  private repoOf(url: string): GithubRepoRef {
    const parsed = parseGithubRepo(url);
    if (!parsed) throw new RpcError('INVALID', 'Paste the URL of a GitHub repository.');
    if (!parsed.ok) throw new RpcError('INVALID', parsed.error);
    return parsed.repo;
  }

  private targetOf(folder: string, name: string): string {
    const problem = cloneFolderProblem(name, this.platform);
    if (problem) throw new RpcError('INVALID', problem);
    return joinPath(folder, name);
  }

  /** `~/Developer/name` for a path in the home folder, the path itself elsewhere. */
  private where(path: string): string {
    const inside = pathInside(path, this.options.home);
    return inside === null ? path : inside === '' ? '~' : `~${separatorOf(this.options.home)}${inside}`;
  }

  async plan(url: string, name?: string): Promise<ClonePlan> {
    const repo = this.repoOf(url);
    const folderName = name?.trim() || repo.name;
    const { enabled, folder } = this.settings();
    if (!enabled || !folder) return { state: 'off', repo, name: folderName, where: '' };
    const target = this.targetOf(folder, folderName);
    return { state: await targetState(target, repo), repo, name: folderName, where: this.where(target) };
  }

  /**
   * Starts a clone and returns at once; it reports through `progress`. A checkout of the same repository already at
   * the target is used as it is (done at once, `reused`).
   */
  async start(jobId: string, url: string, name: string): Promise<void> {
    const repo = this.repoOf(url);
    const { enabled, folder } = this.settings();
    if (!enabled || !folder) throw new RpcError('CLONE_OFF', 'Clone from GitHub is off. Turn it on in Settings › Projects.');
    const target = this.targetOf(folder, name.trim());
    if (this.jobs.has(jobId)) throw new RpcError('BUSY', 'That clone has started already.');
    if ([...this.jobs.values()].some((job) => isSameOrInside(job.target, target) || isSameOrInside(target, job.target))) throw new RpcError('BUSY', `${this.where(target)} is being cloned already.`);
    const state = await targetState(target, repo);
    if (state === 'taken') throw new RpcError('CLONE_TAKEN', `${this.where(target)} already exists. Choose another name.`);

    const report = (rest: Partial<CloneProgress> & Pick<CloneProgress, 'state'>) =>
      this.options.progress({ jobId, phase: null, percent: null, root: null, reused: false, brings: null, error: null, ...rest });
    const finish = (reused: boolean) => {
      const wasProject = this.options.isProject(target);
      if (!wasProject) this.options.addProject(target);
      // Your own project was trusted when you added it; a new one is asked about once, before its first session.
      report({ state: 'done', phase: 'checkout', percent: 100, root: target, reused, brings: wasProject ? null : readRepoBrings(target) });
    };
    if (state === 'cloned') {
      finish(true);
      return;
    }

    mkdirSync(folder, { recursive: true });
    const job: Job = { target, run: null, cancelled: false };
    this.jobs.set(jobId, job);
    report({ state: 'running', phase: 'starting', percent: 0 });
    void (async () => {
      try {
        const env = await this.options.env();
        // gh clones private repositories with the user's login and their protocol choice; without it, git over https.
        const gh = !this.options.source && (await ghSignedIn(this.options.gh, folder, env)) ? this.options.gh : null;
        if (job.cancelled) throw new CloneCancelled();
        const source = this.options.source ? joinPath(this.options.source, `${repo.owner}/${repo.name}.git`) : undefined;
        job.run = runClone({ repo, target, parent: folder, command: cloneCommand(repo, target, { source, gh }), env, onProgress: (phase, percent) => report({ state: 'running', phase, percent }) });
        await job.run.done;
        // A clone from the stand-in source points at GitHub afterwards, as a real one does.
        if (source) await git(target, ['remote', 'set-url', 'origin', `https://github.com/${repo.owner}/${repo.name}.git`]);
        this.options.log('info', `clone: ${repo.owner}/${repo.name} into ${target}${gh ? ' with gh' : ''}`);
        finish(false);
      } catch (error) {
        if (error instanceof CloneCancelled) report({ state: 'cancelled' });
        else {
          this.options.log('warn', `clone: ${repo.owner}/${repo.name} failed: ${(error as Error).message}`);
          report({ state: 'failed', error: (error as Error).message });
        }
      } finally {
        this.jobs.delete(jobId);
      }
    })();
  }

  /** Stops a clone; `cancelled` follows once its folder is gone. Nothing happens for one that already ended. */
  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.cancelled = true;
    job.run?.cancel();
  }

  /** Stops every clone (the engine is closing). */
  close(): void {
    for (const jobId of this.jobs.keys()) this.cancel(jobId);
  }
}
