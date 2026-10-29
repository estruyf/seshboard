import { CONTEXT_BUDGET, GITHUB_ITEM_BUDGET, parseBriefs, parseGithubBlocks, replaceGithubBlocks, writeGithubContext, writeGithubUnreachable, type GithubIssueDetail, type GithubItemType, type GithubPrDetail } from '@seshboard/protocol';
import { WARM_WAIT_MS } from './linkService.ts';

/** What the expansion needs from `GithubService`: reading an item (cached), and what is known of it without waiting. */
export interface GithubSource {
  detail(type: GithubItemType, repo: string, number: number): Promise<GithubIssueDetail | GithubPrDetail | null>;
  known(type: GithubItemType, repo: string, number: number): GithubIssueDetail | GithubPrDetail | null;
}

const keyOf = (block: { type: GithubItemType; repo: string; number: number }) => `${block.type}:${block.repo.toLowerCase()}#${block.number}`;

/** The attached issues and pull requests a message still has as stubs, each once. */
function stubsOf(text: string) {
  const seen = new Set<string>();
  return parseGithubBlocks(text).blocks.filter((b) => b.stub && !seen.has(keyOf(b)) && seen.add(keyOf(b)));
}

/**
 * Attached issues and pull requests in the engine (githubContext.ts): `warm` reads them through gh before a message is
 * sent or queued (at most two seconds, like linked sessions), and `expand` writes each stub as the block Claude reads,
 * right before it does, from what was read. It never waits: an item gh couldn't read goes as its title and link, with
 * a line that says so, and the message is never held back for it.
 */
export class GithubExpander {
  constructor(private readonly github: GithubSource) {}

  async warm(text: string, wait = WARM_WAIT_MS): Promise<void> {
    const stubs = stubsOf(text);
    if (!stubs.length) return;
    const work = Promise.all(stubs.map((b) => this.github.detail(b.type, b.repo, b.number).catch(() => null)));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, wait).unref?.())]);
  }

  /** How many blocks a message's stubs become. */
  count(text: string): number {
    return stubsOf(text).length;
  }

  /** The message with each stub expanded, each item once; `slots` is how many blocks share the message's budget. */
  expand(text: string, slots = this.count(text)): string {
    if (!this.count(text)) return text;
    const budget = Math.min(GITHUB_ITEM_BUDGET, Math.floor(CONTEXT_BUDGET / Math.max(1, slots)));
    const written = new Set<string>();
    const out = replaceGithubBlocks(text, (block, raw) => {
      if (!block.stub) return raw;
      if (written.has(keyOf(block))) return '';
      written.add(keyOf(block));
      const detail = this.github.known(block.type, block.repo, block.number);
      return detail ? writeGithubContext(detail, budget) : writeGithubUnreachable(block);
    });
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }
}

/**
 * A message as Claude reads it: linked sessions' briefs (`expandBriefs`, `LinkService.expand`) and attached issues and
 * pull requests, sharing one budget.
 */
export function expandMessage(text: string, expandBriefs: (text: string, others: number) => string, github: GithubExpander): string {
  const issues = github.count(text);
  const sessions = new Set(parseBriefs(text).briefs.filter((b) => b.stub).map((b) => b.sessionId)).size;
  return github.expand(expandBriefs(text, issues), sessions + issues);
}
