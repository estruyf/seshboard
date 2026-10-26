import { issueQuery, STATE_LABEL_COLORS, STATE_LABEL_DESCRIPTIONS, STATE_LABEL_KEYS, type IssueItem, type StateLabelKey, type TriggerSource } from '@seshboard/protocol';
import { json, readFailure, type GhRun, type SourceRead } from './gh.ts';

/**
 * Issues for you: the open issues that match the trigger's label, assignee or both, as `gh issue list` gives them
 * (GitHub does the filtering). `gh issue list` can't say who an issue's author is to the repository, so
 * `readAssociations` asks GraphQL for that, only for the issues a check might start.
 */
export async function readIssues(gh: GhRun, root: string, source: TriggerSource): Promise<SourceRead<IssueItem[]>> {
  const result = await gh(issueQuery({ source }), root, 20_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const raw = json(result.stdout);
  if (!Array.isArray(raw)) return { ok: false, message: "gh's answer didn't read", rateLimited: false };
  const issues = raw.flatMap((r): IssueItem[] => {
    const issue = r as Partial<IssueItem> | null;
    if (!issue || typeof issue.number !== 'number' || typeof issue.title !== 'string' || typeof issue.url !== 'string') return [];
    const names = (list: unknown, key: 'name' | 'login') => (Array.isArray(list) ? list.flatMap((x) => (typeof (x as Record<string, unknown>)?.[key] === 'string' ? [{ [key]: (x as Record<string, string>)[key] }] : [])) : []);
    return [
      {
        number: issue.number,
        title: issue.title,
        url: issue.url,
        labels: names(issue.labels, 'name') as Array<{ name: string }>,
        assignees: names(issue.assignees, 'login') as Array<{ login: string }>,
        author: issue.author && typeof issue.author.login === 'string' ? { login: issue.author.login } : null,
        body: typeof issue.body === 'string' ? issue.body : null,
        updatedAt: typeof issue.updatedAt === 'string' ? issue.updatedAt : undefined,
      },
    ];
  });
  return { ok: true, value: issues };
}

/** `owner/name` from an issue's link. */
export const repoOfIssueUrl = (url: string) => /github\.com\/([^/]+)\/([^/]+)\/issues\//i.exec(url);

/** Who opened each issue, to the repository (`OWNER`, `MEMBER`, `COLLABORATOR`, `NONE`, …), in one GraphQL call. */
export async function readAssociations(gh: GhRun, root: string, issues: readonly IssueItem[]): Promise<SourceRead<Map<number, string>>> {
  const out = new Map<number, string>();
  const where = issues.length ? repoOfIssueUrl(issues[0]!.url) : null;
  if (!where) return { ok: true, value: out };
  const fields = issues.map((i) => `i${i.number}: issue(number: ${i.number}) { authorAssociation }`).join('\n');
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {\n${fields}\n} }`;
  const result = await gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${where[1]}`, '-f', `name=${where[2]}`], root, 20_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const data = (json(result.stdout) as { data?: { repository?: Record<string, { authorAssociation?: unknown } | null> | null } } | null)?.data?.repository;
  if (!data) return { ok: false, message: "gh's answer didn't read", rateLimited: false };
  for (const issue of issues) {
    const association = data[`i${issue.number}`]?.authorAssociation;
    if (typeof association === 'string') out.set(issue.number, association);
  }
  return { ok: true, value: out };
}

/** An issue's text, comments and assignees, for what a session gets to read and who has it now. */
export async function readIssue(gh: GhRun, root: string, number: number): Promise<SourceRead<{ body: string; comments: Array<{ author: string | null; body: string }>; assignees: string[]; labels: string[]; state: string }>> {
  const result = await gh(['issue', 'view', String(number), '--json', 'body,comments,assignees,labels,state'], root, 20_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const raw = json(result.stdout) as { body?: unknown; comments?: unknown; assignees?: unknown; labels?: unknown; state?: unknown } | null;
  if (!raw) return { ok: false, message: "gh's answer didn't read", rateLimited: false };
  const list = (value: unknown) => (Array.isArray(value) ? value : []) as Array<Record<string, unknown>>;
  return {
    ok: true,
    value: {
      body: typeof raw.body === 'string' ? raw.body : '',
      comments: list(raw.comments).flatMap((c) => (typeof c.body === 'string' ? [{ author: typeof (c.author as { login?: unknown } | null)?.login === 'string' ? (c.author as { login: string }).login : null, body: c.body }] : [])),
      assignees: list(raw.assignees).flatMap((a) => (typeof a.login === 'string' ? [a.login] : [])),
      labels: list(raw.labels).flatMap((l) => (typeof l.name === 'string' ? [l.name] : [])),
      state: typeof raw.state === 'string' ? raw.state.toLowerCase() : 'open',
    },
  };
}

/** How many people can push to the project's repository; null when gh can't tell (you can't list them). */
export async function readCollaborators(gh: GhRun, root: string): Promise<number | null> {
  const result = await gh(['api', 'repos/{owner}/{repo}/collaborators?per_page=100', '--jq', 'length'], root, 15_000);
  if (result.code !== 0 || result.missing) return null;
  const count = Number(result.stdout.trim());
  return Number.isInteger(count) ? count : null;
}

/** One `gh issue edit`: the state label, the trigger's label and the assignee in one call. */
export async function editIssue(gh: GhRun, root: string, args: string[]): Promise<SourceRead<null>> {
  const result = await gh(args, root, 20_000);
  return result.code === 0 && !result.missing ? { ok: true, value: null } : readFailure(result);
}

/**
 * Makes the state labels the repository doesn't have yet, in their colours. Labels that are there keep theirs. Says
 * why when it can't (no right to make labels).
 */
export async function ensureStateLabels(gh: GhRun, root: string, names: Record<StateLabelKey, string>): Promise<SourceRead<null>> {
  const listed = await gh(['label', 'list', '--json', 'name', '--limit', '500'], root, 15_000);
  if (listed.code !== 0 || listed.missing) return readFailure(listed);
  const raw = json(listed.stdout);
  const have = new Set((Array.isArray(raw) ? raw : []).flatMap((l) => (typeof (l as { name?: unknown })?.name === 'string' ? [(l as { name: string }).name.toLowerCase()] : [])));
  for (const key of STATE_LABEL_KEYS) {
    if (have.has(names[key].toLowerCase())) continue;
    const made = await gh(['label', 'create', names[key], '--color', STATE_LABEL_COLORS[key], '--description', STATE_LABEL_DESCRIPTIONS[key]], root, 15_000);
    // Made meanwhile (another computer): fine.
    if ((made.code !== 0 || made.missing) && !/already exists/i.test(`${made.stderr}\n${made.stdout}`)) return readFailure(made);
  }
  return { ok: true, value: null };
}
