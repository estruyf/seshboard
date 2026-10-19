import { homedir } from 'node:os';
import { z } from 'zod';
import type { GithubIssueDetail, GithubItemType, GithubListItem, GithubPrDetail, GithubReason, GithubReviewComment, GithubSearchResult } from '@switchboard/protocol';
import { classifyGhFailure, firstUsefulLine, ghStatus, runGh, type GhCommand, type RunResult } from './pullRequest.ts';
import { githubPage } from './remotes.ts';

/**
 * Issues and pull requests through the GitHub CLI, for the `#` list, New session from an issue or pull request, saved
 * prompts' `issue` and `pr` blanks, and what Claude gets about an attached one. Read-only: nothing here comments,
 * labels, closes or pushes. gh runs without a shell (`runGh`), always with `--json`, and every answer is checked
 * with zod before it is used. Answers are kept per project and query for a minute; a failure that may pass (rate
 * limit, offline) keeps the last answer that worked.
 */

/** How long an answer is used before gh is asked again. */
export const GITHUB_CACHE_MS = 60_000;
/** Issues and pull requests listed at most, each. */
export const GITHUB_LIST_LIMIT = 10;
/** A quick list call; a view of one item (with its review threads) gets a little longer. */
const LIST_TIMEOUT_MS = 15_000;
const VIEW_TIMEOUT_MS = 20_000;

const LIST_FIELDS = 'number,title,state,labels,author,createdAt,updatedAt,url';
const PR_LIST_FIELDS = `${LIST_FIELDS},headRefName,isDraft,isCrossRepository,headRepositoryOwner`;
const ISSUE_VIEW_FIELDS = `${LIST_FIELDS},body,comments`;
const PR_VIEW_FIELDS = `${PR_LIST_FIELDS},body,comments,baseRefName,headRefOid,maintainerCanModify`;

const RawLabel = z.object({ name: z.string(), color: z.string().default('') });
const RawLogin = z.object({ login: z.string() }).nullable().optional();
const RawItem = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.string(),
  labels: z.array(RawLabel).nullable().default([]),
  author: RawLogin,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  url: z.string(),
});
const RawPr = RawItem.extend({
  headRefName: z.string().default(''),
  isDraft: z.boolean().default(false),
  isCrossRepository: z.boolean().default(false),
  headRepositoryOwner: RawLogin,
});
const RawText = { body: z.string().nullable().default(''), comments: z.array(z.unknown()).nullable().default([]) };
const RawIssueView = RawItem.extend(RawText);
const RawPrView = RawPr.extend({ ...RawText, baseRefName: z.string().default(''), headRefOid: z.string().default(''), maintainerCanModify: z.boolean().default(false) });

const RawThreads = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }).nullable().optional(),
    repository: z
      .object({
        viewerPermission: z.string().nullable().optional(),
        pullRequest: z
          .object({
            reviewThreads: z.object({
              nodes: z.array(
                z.object({
                  isResolved: z.boolean(),
                  path: z.string(),
                  line: z.number().int().nullable().optional(),
                  originalLine: z.number().int().nullable().optional(),
                  comments: z.object({ nodes: z.array(z.object({ author: RawLogin, body: z.string() })) }),
                }),
              ),
            }),
          })
          .nullable(),
      })
      .nullable(),
  }),
});
const RawUnresolved = z.object({
  data: z.object({ repository: z.record(z.string(), z.object({ reviewThreads: z.object({ nodes: z.array(z.object({ isResolved: z.boolean() })) }) }).nullable()).nullable() }),
});

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    viewerPermission
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes { isResolved path line originalLine comments(first: 1) { nodes { author { login } body } } } }
    }
  }
}`;

/** `owner/name` and the item's kind from a link to it. */
const LINK = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/(issues|pull)\/(\d{1,9})(?:[/?#].*)?$/i;

/**
 * What a reference to an issue or pull request points at: a number (`123` or `#123`) in the project's repository,
 * or a link to one, in any repository. Null for anything else.
 */
export function parseGithubRef(ref: string): { number: number; repo: string | null; type: GithubItemType | null; url: string | null } | null {
  const text = ref.trim();
  const link = LINK.exec(text);
  if (link) {
    const repo = link[1]!;
    const type = link[2]!.toLowerCase() === 'pull' ? 'pr' : 'issue';
    return { number: Number(link[3]), repo, type, url: `https://github.com/${repo}/${type === 'pr' ? 'pull' : 'issues'}/${link[3]}` };
  }
  const number = /^#?(\d{1,9})$/.exec(text);
  return number && Number(number[1]) > 0 ? { number: Number(number[1]), repo: null, type: null, url: null } : null;
}

/** What a gh failure means: not installed, signed out, rate limited, offline, or something else (its own words). */
export function failureOf(result: RunResult): { reason: Exclude<GithubReason, 'ok' | 'not-github'>; message: string } {
  const failure = classifyGhFailure(result);
  if (failure.code === 'GH_MISSING') return { reason: 'no-gh', message: "GitHub CLI (gh) isn't installed." };
  if (failure.code === 'GH_AUTH') return { reason: 'not-signed-in', message: 'gh is not signed in to GitHub. Run gh auth login.' };
  const output = `${result.stderr}\n${result.stdout}`;
  if (/rate limit/i.test(output)) return { reason: 'rate-limited', message: 'GitHub asked to slow down (rate limit). Try again in a few minutes.' };
  if (/could not resolve host|no such host|dial tcp|network is unreachable|connection (refused|reset)|i\/o timeout|tls handshake|took too long/i.test(output)) {
    return { reason: 'offline', message: "Couldn't reach GitHub." };
  }
  return { reason: 'failed', message: firstUsefulLine(output) || 'gh failed.' };
}

const stateOf = (state: string): GithubListItem['state'] => (/^merged$/i.test(state) ? 'merged' : /^closed$/i.test(state) ? 'closed' : 'open');
const repoOfUrl = (url: string): string | null => /github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\//i.exec(url)?.[1] ?? null;
const timeOf = (iso: string | undefined) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : 0;
};

function listItem(type: GithubItemType, raw: z.infer<typeof RawItem> & Partial<z.infer<typeof RawPr>>, repo: string): GithubListItem {
  const item: GithubListItem = {
    type,
    repo: repoOfUrl(raw.url) ?? repo,
    number: raw.number,
    title: raw.title,
    state: stateOf(raw.state),
    labels: (raw.labels ?? []).map((l) => ({ name: l.name, color: /^[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : '' })),
    author: raw.author?.login ?? null,
    createdAt: timeOf(raw.createdAt),
    updatedAt: timeOf(raw.updatedAt),
    url: raw.url,
  };
  if (type === 'pr') {
    item.headRefName = raw.headRefName ?? '';
    item.isDraft = raw.isDraft ?? false;
    item.isCrossRepository = raw.isCrossRepository ?? false;
    item.headOwner = raw.headRepositoryOwner?.login ?? null;
  }
  return item;
}

/** gh's JSON, checked: null when it isn't what was asked for. */
function parsed<T>(schema: z.ZodType<T>, stdout: string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(stdout));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

type Failure = { ok: false; reason: Exclude<GithubReason, 'ok'>; message: string };
type Found<T> = { ok: true; value: T } | Failure;
/** An answer, and the failure it stands in for when it is the last one that worked. */
type Cached<T> = { value: Found<T>; failure: Failure | null };
/** Failures that may pass: the last answer that worked is used meanwhile. */
const PASSING = new Set<GithubReason>(['rate-limited', 'offline', 'failed']);

export interface GithubServiceDeps {
  gh(): GhCommand;
  /** The login shell's environment, so gh finds its config and Homebrew's PATH when the app started from the Dock. */
  env(): Promise<Record<string, string>>;
  /** The project's repository on GitHub, `owner/name`; null when no remote is on GitHub. */
  repoOf?(root: string): Promise<string | null>;
  now?(): number;
}

interface Entry {
  at: number;
  value: Found<unknown>;
  /** The last answer that worked, kept when a later call failed. */
  good: Found<unknown> | null;
}

/** See the top of this file. One per engine: the `#` list, blanks, New session and the expansion share its cache. */
export class GithubService {
  private readonly cache = new Map<string, Entry>();
  private readonly running = new Map<string, Promise<Cached<unknown>>>();

  constructor(private readonly deps: GithubServiceDeps) {}

  private now = () => this.deps.now?.() ?? Date.now();
  private repoOf = (root: string) => (this.deps.repoOf ? this.deps.repoOf(root) : githubPage(root).then((page) => page?.repo ?? null)).catch(() => null);

  private async gh(args: string[], cwd: string, timeout: number): Promise<RunResult> {
    return runGh(this.deps.gh(), args, { cwd, env: await this.deps.env(), timeout });
  }

  /**
   * `load` once per key and minute. A failure that may pass gives the last answer that worked (`stale`, with the
   * failure), and isn't kept, so the next call asks again; an answer such as "not signed in" is kept like any other.
   */
  private async cached<T>(key: string, load: () => Promise<Found<T>>): Promise<Cached<T>> {
    const entry = this.cache.get(key);
    if (entry && this.now() - entry.at < GITHUB_CACHE_MS) return { value: entry.value as Found<T>, failure: null };
    const running = this.running.get(key);
    if (running) return running as Promise<Cached<T>>;
    const work = load().then(
      (value): Cached<unknown> => {
        const previous = this.cache.get(key);
        if (!value.ok && PASSING.has(value.reason) && previous?.good) return { value: previous.good, failure: value };
        this.cache.set(key, { at: this.now(), value, good: value.ok ? value : (previous?.good ?? null) });
        return { value, failure: null };
      },
      (error: Error): Cached<unknown> => ({ value: { ok: false, reason: 'failed', message: error.message }, failure: null }),
    );
    this.running.set(key, work);
    void work.finally(() => this.running.delete(key));
    return work as Promise<Cached<T>>;
  }

  /** Forgets what gh said about a project (Refresh in the list). */
  clear(root: string): void {
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${root}\u0000`)) this.cache.delete(key);
  }

  /** Whether the `#` list can work in a project, and why not. Checked once a minute. */
  async status(root: string): Promise<{ available: boolean; reason: 'ok' | 'no-gh' | 'not-signed-in' | 'not-github'; repo: string | null }> {
    const repo = await this.repoOf(root);
    if (!repo) return { available: false, reason: 'not-github', repo: null };
    const { value } = await this.cached(`${root}\u0000status`, async (): Promise<Found<'ok' | 'no-gh' | 'not-signed-in'>> => {
      const gh = await ghStatus(this.deps.gh(), root, await this.deps.env(), 'github.com');
      return { ok: true, value: !gh.installed ? 'no-gh' : gh.signedIn === false ? 'not-signed-in' : 'ok' };
    });
    const reason = value.ok ? value.value : 'ok';
    return { available: reason === 'ok', reason, repo };
  }

  /**
   * Open issues and pull requests of the project's repository, at most 10 of each. An empty query lists the most
   * recently updated; a number (`123`, `#123`) puts that item first, open or closed, then the recent ones whose
   * number starts with it; a link to an issue or pull request finds that one, in any repository; other words search.
   */
  async search(root: string, query: string, options: { refresh?: boolean } = {}): Promise<GithubSearchResult> {
    if (options.refresh) this.clear(root);
    const repo = await this.repoOf(root);
    const ref = parseGithubRef(query);
    if (!repo && !ref?.repo) return { repo: null, reason: 'not-github', message: null, issues: [], pullRequests: [], stale: false };
    const words = query.trim();
    const { value, failure } = await this.cached(`${root}\u0000search\u0000${words.toLowerCase()}`, () => this.searchNow(root, repo, words, ref));
    if (!value.ok) return { repo, reason: value.reason, message: value.message, issues: [], pullRequests: [], stale: false };
    return { repo, ...value.value, reason: failure?.reason ?? 'ok', message: failure?.message ?? null, stale: failure !== null };
  }

  private async searchNow(root: string, repo: string | null, words: string, ref: ReturnType<typeof parseGithubRef>): Promise<Found<{ issues: GithubListItem[]; pullRequests: GithubListItem[] }>> {
    // A link: that item alone, wherever it is.
    if (ref?.url) {
      const found = await this.view(ref.repo!, ref.type!, ref.number, root);
      if (!found.ok) return found;
      return { ok: true, value: ref.type === 'pr' ? { issues: [], pullRequests: [found.value] } : { issues: [found.value], pullRequests: [] } };
    }
    if (!repo) return { ok: false, reason: 'not-github', message: 'This project has no remote on GitHub.' };
    const number = ref?.number ?? null;
    const lists = this.lists(root, repo, number === null ? words : '');
    if (number === null) return lists;
    // A number: that item first (a pull request when it is one), then recent ones whose number starts with it.
    const [listed, pr, issue] = await Promise.all([lists, this.view(repo, 'pr', number, root), this.view(repo, 'issue', number, root)]);
    if (!listed.ok) return listed;
    const digits = String(number);
    const exact = pr.ok ? pr.value : issue.ok ? issue.value : null;
    const startsWith = (items: GithubListItem[]) => items.filter((i) => String(i.number).startsWith(digits) && i.number !== number);
    const issues = startsWith(listed.value.issues);
    const pullRequests = startsWith(listed.value.pullRequests);
    if (exact?.type === 'issue') issues.unshift(exact);
    if (exact?.type === 'pr') pullRequests.unshift(exact);
    return { ok: true, value: { issues, pullRequests } };
  }

  /** The open issues and pull requests that match `words` (the most recently updated without). */
  private async lists(root: string, repo: string, words: string): Promise<Found<{ issues: GithubListItem[]; pullRequests: GithubListItem[] }>> {
    const search = ['--search', words || 'sort:updated-desc'];
    const common = ['--repo', repo, '--state', 'open', '--limit', String(GITHUB_LIST_LIMIT), ...search];
    const [issues, prs] = await Promise.all([
      this.gh(['issue', 'list', ...common, '--json', LIST_FIELDS], root, LIST_TIMEOUT_MS),
      this.gh(['pr', 'list', ...common, '--json', PR_LIST_FIELDS], root, LIST_TIMEOUT_MS),
    ]);
    for (const result of [issues, prs]) if (result.code !== 0 || result.missing) return { ok: false, ...failureOf(result) };
    const issueList = parsed(z.array(RawItem), issues.stdout);
    const prList = parsed(z.array(RawPr), prs.stdout);
    if (!issueList || !prList) return { ok: false, reason: 'failed', message: "gh's answer didn't read." };
    const pullRequests = prList.map((raw) => listItem('pr', raw, repo));
    await this.addUnresolved(root, repo, pullRequests);
    return { ok: true, value: { issues: issueList.map((raw) => listItem('issue', raw, repo)), pullRequests } };
  }

  /** "2 unresolved comments" on the list's pull requests: one GraphQL call for all of them; left out when it fails. */
  private async addUnresolved(root: string, repo: string, prs: GithubListItem[]): Promise<void> {
    if (!prs.length) return;
    const [owner, name] = repo.split('/') as [string, string];
    const fields = prs.map((pr) => `p${pr.number}: pullRequest(number: ${pr.number}) { reviewThreads(first: 100) { nodes { isResolved } } }`).join('\n');
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {\n${fields}\n} }`;
    const result = await this.gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`], root, LIST_TIMEOUT_MS).catch(() => null);
    const data = result?.code === 0 ? parsed(RawUnresolved, result.stdout) : null;
    if (!data?.data.repository) return;
    for (const pr of prs) {
      const threads = data.data.repository[`p${pr.number}`]?.reviewThreads.nodes;
      if (threads) pr.unresolved = threads.filter((t) => !t.isResolved).length;
    }
  }

  /** One item for a list row, open or closed. */
  private async view(repo: string, type: GithubItemType, number: number, cwd: string): Promise<Found<GithubListItem>> {
    const result = await this.gh([type === 'pr' ? 'pr' : 'issue', 'view', String(number), '--repo', repo, '--json', type === 'pr' ? PR_LIST_FIELDS : LIST_FIELDS], cwd, VIEW_TIMEOUT_MS);
    if (result.code !== 0 || result.missing) return { ok: false, ...notFound(result, type, number) };
    const raw = parsed(type === 'pr' ? RawPr : RawItem, result.stdout);
    return raw ? { ok: true, value: listItem(type, raw, repo) } : { ok: false, reason: 'failed', message: "gh's answer didn't read." };
  }

  /** The repository and number a reference names in a project; a failure says why there is none. */
  private async resolve(root: string, ref: string): Promise<Found<{ repo: string; number: number; type: GithubItemType | null }>> {
    const parsedRef = parseGithubRef(ref);
    if (!parsedRef) return { ok: false, reason: 'failed', message: 'Paste a link to an issue or pull request, or type its number.' };
    const repo = parsedRef.repo ?? (await this.repoOf(root));
    if (!repo) return { ok: false, reason: 'not-github', message: 'This project has no remote on GitHub.' };
    return { ok: true, value: { repo, number: parsedRef.number, type: parsedRef.type } };
  }

  /** The full issue a reference names (`github.issue`). */
  async issue(root: string, ref: string): Promise<{ issue: GithubIssueDetail | null; reason: GithubReason; message: string | null }> {
    const where = await this.resolve(root, ref);
    if (!where.ok) return { issue: null, reason: where.reason, message: where.message };
    const { value } = await this.issueOf(where.value.repo, where.value.number, root);
    return value.ok ? { issue: value.value, reason: 'ok', message: null } : { issue: null, reason: value.reason, message: value.message };
  }

  /** The full pull request a reference names (`github.pr`). */
  async pr(root: string, ref: string): Promise<{ pr: GithubPrDetail | null; reason: GithubReason; message: string | null }> {
    const where = await this.resolve(root, ref);
    if (!where.ok) return { pr: null, reason: where.reason, message: where.message };
    const { value } = await this.prOf(where.value.repo, where.value.number, root);
    return value.ok ? { pr: value.value, reason: 'ok', message: null } : { pr: null, reason: value.reason, message: value.message };
  }

  /** An item by its repository and number, for what Claude gets (cached like the rest). */
  async detail(type: GithubItemType, repo: string, number: number): Promise<GithubIssueDetail | GithubPrDetail | null> {
    const { value } = type === 'pr' ? await this.prOf(repo, number) : await this.issueOf(repo, number);
    return value.ok ? value.value : null;
  }

  /** What is known about an item without asking gh: for writing a message that can't wait. */
  known(type: GithubItemType, repo: string, number: number): GithubIssueDetail | GithubPrDetail | null {
    const entry = this.cache.get(`${itemKey(type, repo, number)}`);
    const found = entry?.value.ok ? entry.value : entry?.good;
    return found?.ok ? (found.value as GithubIssueDetail | GithubPrDetail) : null;
  }

  private issueOf(repo: string, number: number, cwd = homedir()) {
    return this.cached(itemKey('issue', repo, number), async (): Promise<Found<GithubIssueDetail>> => {
      const result = await this.gh(['issue', 'view', String(number), '--repo', repo, '--json', ISSUE_VIEW_FIELDS], cwd, VIEW_TIMEOUT_MS);
      if (result.code !== 0 || result.missing) return { ok: false, ...notFound(result, 'issue', number) };
      const raw = parsed(RawIssueView, result.stdout);
      if (!raw) return { ok: false, reason: 'failed', message: "gh's answer didn't read." };
      return { ok: true, value: { ...listItem('issue', raw, repo), body: raw.body ?? '', comments: raw.comments?.length ?? 0 } };
    });
  }

  private prOf(repo: string, number: number, cwd = homedir()) {
    return this.cached(itemKey('pr', repo, number), async (): Promise<Found<GithubPrDetail>> => {
      const [owner, name] = repo.split('/') as [string, string];
      const [view, threads] = await Promise.all([
        this.gh(['pr', 'view', String(number), '--repo', repo, '--json', PR_VIEW_FIELDS], cwd, VIEW_TIMEOUT_MS),
        this.gh(['api', 'graphql', '-f', `query=${THREADS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`], cwd, VIEW_TIMEOUT_MS),
      ]);
      if (view.code !== 0 || view.missing) return { ok: false, ...notFound(view, 'pr', number) };
      const raw = parsed(RawPrView, view.stdout);
      if (!raw) return { ok: false, reason: 'failed', message: "gh's answer didn't read." };
      const data = threads.code === 0 ? parsed(RawThreads, threads.stdout)?.data : null;
      const item = listItem('pr', raw, repo);
      const headOwner = raw.headRepositoryOwner?.login ?? null;
      return {
        ok: true,
        value: {
          ...item,
          body: raw.body ?? '',
          comments: raw.comments?.length ?? 0,
          headRefName: raw.headRefName,
          baseRefName: raw.baseRefName,
          headOid: raw.headRefOid,
          isDraft: raw.isDraft,
          isCrossRepository: raw.isCrossRepository,
          headOwner,
          canPush: canPush({ fork: raw.isCrossRepository, headOwner, maintainerCanModify: raw.maintainerCanModify, viewer: data?.viewer?.login ?? null, permission: data?.repository?.viewerPermission ?? null }),
          reviewComments: unresolvedComments(data?.repository?.pullRequest?.reviewThreads.nodes ?? []),
        },
      };
    });
  }
}

const itemKey = (type: GithubItemType, repo: string, number: number) => `item\u0000${type}\u0000${repo.toLowerCase()}#${number}`;

/** A view that failed: "No issue #404." when GitHub has no such item, else what the failure means. */
function notFound(result: RunResult, type: GithubItemType, number: number): { reason: Exclude<GithubReason, 'ok'>; message: string } {
  if (/could not resolve to|not found|no (issue|pull request)/i.test(`${result.stderr}\n${result.stdout}`)) {
    return { reason: 'failed', message: `No ${type === 'pr' ? 'pull request' : 'issue'} #${number} found.` };
  }
  return failureOf(result);
}

const WRITE = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);

/**
 * Whether you can push to a pull request's branch: one in the repository itself (when GitHub didn't say otherwise),
 * one in your own fork, or a fork that lets maintainers change it when you can write to the repository.
 */
export function canPush(pr: { fork: boolean; headOwner: string | null; maintainerCanModify: boolean; viewer: string | null; permission: string | null }): boolean {
  const writes = pr.permission === null || WRITE.has(pr.permission);
  if (!pr.fork) return writes;
  if (pr.viewer && pr.headOwner && pr.viewer.toLowerCase() === pr.headOwner.toLowerCase()) return true;
  return pr.maintainerCanModify && pr.permission !== null && WRITE.has(pr.permission);
}

/** The first comment of each thread that isn't resolved, with where it is. */
export function unresolvedComments(threads: ReadonlyArray<{ isResolved: boolean; path: string; line?: number | null; originalLine?: number | null; comments: { nodes: ReadonlyArray<{ author?: { login: string } | null; body: string }> } }>): GithubReviewComment[] {
  return threads.flatMap((thread) => {
    const first = thread.comments.nodes[0];
    if (thread.isResolved || !first) return [];
    return [{ path: thread.path, line: thread.line ?? thread.originalLine ?? null, author: first.author?.login ?? null, body: first.body }];
  });
}
