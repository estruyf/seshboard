import type { DrawOutcome } from './mermaidRender.ts';

/** What was last drawn for a block, tagged with the source it was drawn from. */
export interface Drawn {
  code: string;
  outcome: DrawOutcome;
}

/**
 * What a diagram block shows now: the drawing for this source and theme if there is one, else the last one drawn or shown
 * for this same source, so a new theme keeps the old drawing until the new one is ready instead of falling back to the
 * source (a block that came out of the cache has no `drawn` of its own, so `shown` is what it showed last). A changed source starts over.
 */
export function pickOutcome(code: string, cached: DrawOutcome | undefined, drawn: Drawn | null, shown: Drawn | null): DrawOutcome | null {
  if (cached) return cached;
  if (drawn?.code === code) return drawn.outcome;
  if (shown?.code === code) return shown.outcome;
  return null;
}

/** Whether to ask for a drawing now: not while the reply holding the block is still being written, and not when there is one. */
export function shouldDraw(writing: boolean, cached: DrawOutcome | undefined): boolean {
  return !writing && !cached;
}

/** The line under a block's source when it couldn't be drawn: Mermaid failing to load is not the diagram's fault. */
export function failureLine(outcome: Extract<DrawOutcome, { ok: false }>): string {
  return outcome.load ? "Couldn't load the diagram viewer." : "Couldn't draw this diagram.";
}
