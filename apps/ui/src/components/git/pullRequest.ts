import { PR_BODY_LIMIT, type PrDraft, type PrError, type PrTemplate } from '@switchboard/protocol/client';

/** Where the description started from: a template, the commit list, or nothing. */
export type DescriptionSource = { kind: 'template'; path: string } | { kind: 'commits' } | { kind: 'empty' };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A branch name as a title: `feat/sessions-archive` → "Sessions archive". */
export function readableBranch(branch: string): string {
  const words = (branch.split('/').filter(Boolean).at(-1) ?? branch).replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : branch;
}

/** The title to start with: the commit's subject for one commit, else the branch name made readable. */
export function defaultTitle(commits: readonly string[], branch: string): string {
  return commits.length === 1 ? commits[0]! : readableBranch(branch);
}

/**
 * The commits as a list, one "- subject" a line. Cut short with "- … and N more" when it would be longer than
 * `limit`, so even thousands of commits fit in what GitHub takes.
 */
export function commitList(commits: readonly string[], limit: number = PR_BODY_LIMIT): string {
  const lines = commits.map((subject) => `- ${subject}`);
  const full = lines.join('\n');
  if (full.length <= limit) return full;
  let length = 0;
  let kept = 0;
  // Room for the last line, at its longest.
  const tail = (left: number) => `\n- … and ${left.toLocaleString('en-US')} more`;
  while (kept < lines.length && length + lines[kept]!.length + 1 + tail(lines.length).length <= limit) length += lines[kept++]!.length + 1;
  return lines.slice(0, kept).join('\n') + tail(lines.length - kept);
}

/** The source a new description starts from: the first template, else the commit list. */
export const defaultSource = (templates: readonly PrTemplate[]): DescriptionSource => (templates[0] ? { kind: 'template', path: templates[0].path } : { kind: 'commits' });

/** The text a source gives. A template that is gone gives nothing. */
export function sourceText(source: DescriptionSource, templates: readonly PrTemplate[], commits: readonly string[]): string {
  if (source.kind === 'commits') return commitList(commits);
  if (source.kind === 'empty') return '';
  return templates.find((t) => t.path === source.path)?.content ?? '';
}

/** How the source is named next to "From" and in its menu. */
export const sourceLabel = (source: DescriptionSource) => (source.kind === 'template' ? source.path : source.kind === 'commits' ? 'Commit list' : 'Empty');

export const sameSource = (a: DescriptionSource, b: DescriptionSource) => a.kind === b.kind && (a.kind !== 'template' || (b.kind === 'template' && a.path === b.path));

/** How many characters a description is over GitHub's limit (0 when it fits). */
export const overLimit = (body: string) => Math.max(0, body.length - PR_BODY_LIMIT);

/** "412 / 65,536". */
export const counterText = (body: string) => `${body.length.toLocaleString('en-US')} / ${PR_BODY_LIMIT.toLocaleString('en-US')}`;

/** "3 commits · 9 files · " and the line counts (shown in their colours by the dialog). */
export const statsText = (draft: Pick<PrDraft, 'commits' | 'files'>) => `${plural(draft.commits.length, 'commit', 'commits')} · ${plural(draft.files, 'file', 'files')}`;

/** What happens before the pull request is created, for the footer. */
export function pushLine(draft: Pick<PrDraft, 'ahead' | 'hasUpstream' | 'remote' | 'branch'>): string {
  if (draft.ahead > 0) return `Pushes ${plural(draft.ahead, 'commit', 'commits')} to ${draft.remote} first`;
  if (!draft.hasUpstream) return `Publishes ${draft.branch} to ${draft.remote} first`;
  return 'Already pushed';
}

/** What a notice offers: each is a button. */
export type NoticeAction = 'install' | 'web' | 'sign-in' | 'pull' | 'output' | 'view';

export interface PrNotice {
  tone: 'warn' | 'error' | 'info';
  title: string;
  detail: string;
  actions: NoticeAction[];
}

/** What the dialog says about a failure, and what it offers to do next. */
export function noticeFor(error: PrError, branch: string): PrNotice {
  const output: NoticeAction[] = error.output ? ['output'] : [];
  switch (error.code) {
    case 'GH_MISSING':
      return { tone: 'warn', title: "GitHub CLI isn't installed.", detail: 'Switchboard uses gh to create the pull request.', actions: ['install', 'web'] };
    case 'GH_AUTH':
      return { tone: 'warn', title: 'Not signed in to GitHub.', detail: 'Sign in once in a terminal; Switchboard picks it up.', actions: ['sign-in'] };
    case 'PUSH_REJECTED':
      return { tone: 'error', title: 'Push rejected.', detail: error.message, actions: ['pull', ...output] };
    case 'PR_EXISTS':
      return {
        tone: 'info',
        title: 'This branch already has a pull request.',
        detail: error.pr ? `#${error.pr.number} is open for ${branch}.` : `It is open for ${branch}.`,
        actions: error.pr ? ['view'] : [],
      };
    case 'BODY_TOO_LONG':
      return { tone: 'error', title: 'The description is too long.', detail: error.message, actions: output };
    default:
      return { tone: 'error', title: "The pull request wasn't created.", detail: error.message, actions: output };
  }
}

/** What the draft already says will go wrong: no gh, signed out, or a pull request that is open for the branch. */
export function draftProblem(draft: PrDraft): PrError | null {
  if (!draft.gh.installed) return { code: 'GH_MISSING', message: "GitHub CLI isn't installed.", output: null, pr: null };
  if (draft.existingPr?.state === 'open') return { code: 'PR_EXISTS', message: 'This branch already has a pull request.', output: null, pr: { number: draft.existingPr.number, url: draft.existingPr.url } };
  if (draft.gh.signedIn === false) return { code: 'GH_AUTH', message: 'Not signed in to GitHub.', output: null, pr: null };
  return null;
}

/** What you wrote in the dialog, kept when it closes without creating (Cancel, signing in, pulling first). */
export interface SavedDraft {
  title: string;
  body: string;
  source: DescriptionSource;
  base: string;
  draft: boolean;
}

/** Saved drafts by checkout and branch, for this run of the app. */
const saved = new Map<string, SavedDraft>();
const key = (cwd: string, branch: string) => `${cwd}\0${branch}`;

export const savedDraft = (cwd: string, branch: string) => saved.get(key(cwd, branch)) ?? null;
export function saveDraft(cwd: string, branch: string, draft: SavedDraft | null): void {
  if (draft) saved.set(key(cwd, branch), draft);
  else saved.delete(key(cwd, branch));
}
