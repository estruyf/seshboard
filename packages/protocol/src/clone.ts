import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';

/**
 * Clone from GitHub (Settings › Projects): a repository cloned into the folder set there, added as a project, and
 * New session's first prompt run in it. The URL rules are in `githubRepo.ts`.
 */

/** Settings › Projects › Clone from GitHub, kept by each computer's engine. On only with a folder. */
export const CloneSettings = z.object({
  enabled: z.boolean(),
  /** The folder new clones go in (`~/Developer`); null until one is chosen. */
  folder: AbsolutePath.nullable(),
});
export type CloneSettings = z.infer<typeof CloneSettings>;

export const GithubRepoSchema = z.object({ owner: z.string(), name: z.string(), branch: z.string().nullable() });

/**
 * Where a clone would go, before it starts:
 *  - `off`: Clone from GitHub is off on that computer (or has no folder);
 *  - `free`: nothing there yet;
 *  - `cloned`: a checkout of the same repository is there already, and is used as it is;
 *  - `taken`: something else is there: pick another name.
 */
export const ClonePlanState = z.enum(['off', 'free', 'cloned', 'taken']);
export type ClonePlanState = z.infer<typeof ClonePlanState>;

export const ClonePlan = z.object({
  state: ClonePlanState,
  repo: GithubRepoSchema,
  /** The folder's name: the repository's, or the one typed. */
  name: z.string(),
  /** Where it goes, `~` for the home folder (`~/Developer/switchboard`); empty while off. */
  where: z.string(),
});
export type ClonePlan = z.infer<typeof ClonePlan>;

/** A hook a repository's project settings run, as `.claude/settings.json` lists it. */
export const RepoHook = z.object({ event: z.string(), command: z.string() });
export type RepoHook = z.infer<typeof RepoHook>;

/**
 * What a repository's own Claude Code settings bring to a session started in it, without asking: hooks, MCP servers,
 * `allow` rules, plugins, and settings that run commands or change where requests go (`env`, `apiKeyHelper`, a
 * default permission mode). Read from `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json`.
 */
export const RepoBrings = z.object({
  hooks: z.array(RepoHook),
  /** `name: command` (or the URL of a remote server). */
  mcpServers: z.array(z.string()),
  allow: z.array(z.string()),
  plugins: z.array(z.string()),
  /** Other settings that run something or send requests elsewhere, as `key: value`. */
  settings: z.array(z.string()),
});
export type RepoBrings = z.infer<typeof RepoBrings>;

/** How far a clone is: git's own steps, as `--progress` reports them. */
export const ClonePhase = z.enum(['starting', 'receiving', 'resolving', 'checkout']);
export type ClonePhase = z.infer<typeof ClonePhase>;

/**
 * A clone moved on. `done` carries the project (`root`), whether an existing checkout was used (`reused`) and what the
 * repository brings, or null when nothing needs asking about (it brings nothing, or it was one of your projects
 * already). `failed` carries the reason; `cancelled` follows Cancel, once the folder it made is gone.
 */
export const CloneProgress = z.object({
  jobId: z.string(),
  state: z.enum(['running', 'done', 'failed', 'cancelled']),
  phase: ClonePhase.nullable(),
  /** 0–100 for the whole clone; null before git says. */
  percent: z.number().nullable(),
  root: z.string().nullable(),
  reused: z.boolean(),
  brings: RepoBrings.nullable(),
  error: z.string().nullable(),
});
export type CloneProgress = z.infer<typeof CloneProgress>;

