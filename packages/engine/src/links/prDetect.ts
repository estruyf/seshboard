import type { TranscriptMessage } from '@seshboard/protocol';
import { parsePrUrl } from '../git/pullRequest.ts';

/** A pull request a session opened: `gh pr create` ran in it and printed the link. */
export interface OpenedPr {
  repo: string;
  number: number;
  url: string;
  /** When the command's result came back. */
  at: number | null;
  /** The base the command asked for (`--base`/`-B`), when it said one. */
  base: string | null;
}

const GH_PR_CREATE = /(^|[\s;&|(])gh\s+pr\s+create\b/;

/** `owner/name` from a pull request's link (`https://github.com/owner/name/pull/12`). */
export function repoOfPrUrl(url: string): string | null {
  const match = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url);
  return match ? match[1]! : null;
}

/** The `--base` a `gh pr create` command asked for. */
export function baseOfCommand(command: string): string | null {
  const match = /(?:--base|-B)(?:=|\s+)(["']?)([^\s"']+)\1/.exec(command);
  return match ? match[2]! : null;
}

/**
 * The pull requests opened in a session: each `gh pr create` (in a Bash call) whose output has a pull request's
 * link. A link that only shows up in what Claude wrote (someone else's PR) doesn't count.
 */
export function openedPullRequests(messages: readonly TranscriptMessage[]): OpenedPr[] {
  const commands = new Map<string, string>();
  const out: OpenedPr[] = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_use' && block.name === 'Bash') {
        const command = (block.input as { command?: unknown } | null)?.command;
        if (typeof command === 'string' && GH_PR_CREATE.test(command)) commands.set(block.id, command);
      } else if (block.type === 'tool_result' && !block.isError && commands.has(block.toolUseId)) {
        const pr = parsePrUrl(block.text);
        const repo = pr && repoOfPrUrl(pr.url);
        if (pr && repo && !out.some((o) => o.url === pr.url)) out.push({ repo, number: pr.number, url: pr.url, at: message.timestamp, base: baseOfCommand(commands.get(block.toolUseId)!) });
      }
    }
  }
  return out;
}
