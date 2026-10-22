/**
 * The fenced blocks the message box adds to a message for the engine to fill in right before Claude reads it: a
 * linked session's brief (`switchboard-session`, sessionLinks.ts) and an attached GitHub issue or pull request
 * (`switchboard-github`, githubContext.ts). Plain TypeScript, no zod: the renderer, the engine and the remote app
 * share it.
 */

/** The fence's info string of a linked session's brief. */
export const SESSION_FENCE = 'switchboard-session';
/** The fence's info string of an attached issue or pull request. */
export const GITHUB_FENCE = 'switchboard-github';
/** The fence of a pipeline run's brief in its parent's messages (`pipelines.ts`). */
export const RUN_FENCE = 'switchboard-run';

/** A code fence longer than any run of backticks in the text, so the text can't close it early. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const FENCE_OPEN = /^(`{3,})(.*)$/;

export interface FencedBlock {
  /** Where the block starts (its label line when `labelPrefix` found one, else the fence), and where it ends. */
  start: number;
  end: number;
  /** The text after `labelPrefix` on the line right before the fence; null without one. */
  label: string | null;
  info: string;
  inner: string;
  /** Where the info string starts, in the text (for `defuseFences`). */
  infoAt: number;
}

/**
 * The top-level fenced blocks of a text: a fence inside another one (a text chip's own block) is skipped. With
 * `labelPrefix`, a line right before the fence that starts with it is part of the block.
 */
export function fencedBlocks(text: string, labelPrefix?: string): FencedBlock[] {
  const out: FencedBlock[] = [];
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]!);
    if (!open) continue;
    const fence = open[1]!;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === fence) {
        close = j;
        break;
      }
    }
    if (close < 0) break;
    const prev = i > 0 ? lines[i - 1]! : '';
    const label = labelPrefix && prev.startsWith(labelPrefix) ? prev.slice(labelPrefix.length).trim() : null;
    out.push({
      start: label !== null ? starts[i - 1]! : starts[i]!,
      end: starts[close]! + lines[close]!.length,
      label,
      info: open[2]!.trim(),
      inner: lines.slice(i + 1, close).join('\n'),
      infoAt: starts[i]! + lines[i]!.indexOf(open[2]!.trim(), fence.length),
    });
    i = close;
  }
  return out;
}

/**
 * Turns every block fenced with one of `infos` into a plain `text` code block, so it reads the same and never
 * expands: for text from places that may not add these (a paired phone).
 */
export function defuseFences(text: string, infos: readonly string[]): string {
  const found = fencedBlocks(text).filter((b) => infos.includes(b.info));
  let out = text;
  // From the end, so earlier positions stay right.
  for (const block of found.reverse()) out = `${out.slice(0, block.infoAt)}text${out.slice(block.infoAt + block.info.length)}`;
  return out;
}
