import { z } from 'zod';
import { RemoteProject } from '@seshboard/protocol';

/*
 * start_session on another computer (docs/orchestrator.md): which paired computer, which of its projects is this one,
 * and what list_computers says. Pure, so the matching is tested without a connection.
 */

/** A computer paired with this one (Settings › Remote › Other computers), as the tools see it. */
export interface PairedComputer {
  id: string;
  /** The name shown here: yours, else what it calls itself. */
  name: string;
  connected: boolean;
  /** What its Seshboard takes beyond every version (`hello`'s features), such as `projects.clone`. */
  features?: readonly string[];
}

/** A session on another computer as this one's windows key it: the sidebar's row id (`remoteRowId` in the UI). */
export const remoteSessionKey = (computerId: string, sessionId: string): string => `remote:${computerId}:${sessionId}`;

/** What a repository brings that a session there runs without asking, one line each; empty when nothing. */
export function bringsLines(brings: { hooks: Array<{ event: string; command: string }>; mcpServers: string[]; allow: string[]; plugins: string[]; settings: string[] } | null): Array<[string, string]> {
  if (!brings) return [];
  return [
    ...brings.hooks.map((h): [string, string] => [`Hook (${h.event})`, h.command]),
    ...brings.mcpServers.map((m): [string, string] => ['MCP server', m]),
    ...brings.allow.map((a): [string, string] => ['Allowed without asking', a]),
    ...brings.plugins.map((p): [string, string] => ['Plugin', p]),
    ...brings.settings.map((x): [string, string] => ['Setting', x]),
  ];
}

/** This computer's project, as another computer's are compared with it. */
export interface LocalProject {
  name: string;
  /** The GitHub repositories its folder's remotes point at (`owner/name`, lowercased). */
  repos: readonly string[];
}

const squash = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** A paired computer by the name list_computers gave (any case), or by its id. */
export function findComputer<C extends PairedComputer>(computers: readonly C[], wanted: string): C | null {
  const name = squash(wanted);
  return computers.find((c) => squash(c.name) === name) ?? computers.find((c) => c.id === wanted.trim()) ?? null;
}

/**
 * Another computer's project that is this one. Folders differ between computers, so the GitHub repository decides; by
 * name only where there is nothing to compare: this project has no GitHub remote, or that computer's Seshboard is too
 * old to say its projects' repositories. A project there with another repository is never a match, whatever its name.
 */
export function matchProject(projects: readonly RemoteProject[], local: LocalProject): { project: RemoteProject; by: 'repo' | 'name' } | null {
  if (local.repos.length) {
    const byRepo = projects.find((p) => p.repo && local.repos.includes(p.repo.toLowerCase()));
    if (byRepo) return { project: byRepo, by: 'repo' };
  }
  const name = squash(local.name);
  // With a repository here, a name only counts for a project whose computer can't say its repository.
  const byName = projects.find((p) => squash(p.name) === name && (!local.repos.length || p.repo === undefined));
  return byName ? { project: byName, by: 'name' } : null;
}

/** `projects.list` from another computer, whose answer is checked here: it comes unchecked. */
export function readProjects(result: unknown): RemoteProject[] {
  const parsed = z.object({ projects: z.array(RemoteProject) }).safeParse(result);
  return parsed.success ? parsed.data.projects : [];
}

/** `options.get` from another computer: its profiles' ids and names, or null when it has none to say (an older version). */
export function readProfiles(result: unknown): Array<{ id: string; name: string }> | null {
  const parsed = z.object({ profiles: z.array(z.object({ id: z.string(), name: z.string() })) }).safeParse(result);
  return parsed.success ? parsed.data.profiles : null;
}

/** One row of list_computers. `project` is this project's name there; null when it has none, undefined while offline. */
export interface ComputerLine {
  name: string;
  connected: boolean;
  project?: string | null;
}

export const NO_COMPUTERS = 'No other computers are paired with Seshboard. The user pairs one in Settings › Remote › Other computers.';

/** list_computers' answer. */
export function writeComputerList(rows: readonly ComputerLine[]): string {
  if (!rows.length) return NO_COMPUTERS;
  const lines = rows.map((row) => {
    if (!row.connected) return `- ${row.name}: not connected now`;
    if (row.project) return `- ${row.name}: connected, has this project as "${row.project}"`;
    return `- ${row.name}: connected, does not have this project`;
  });
  return [...lines, 'start_session takes one of these names as its computer. A computer needs this project, and to be connected.'].join('\n');
}
