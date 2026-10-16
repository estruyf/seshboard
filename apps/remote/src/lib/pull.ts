/**
 * Pull to refresh on the first screen: a Home Screen app has no reload button. Pure, with tests; `PullToRefresh.tsx`
 * follows the finger.
 */

/** Pulled down past this far, letting go refreshes. */
export const PULL_THRESHOLD = 64;
/** The indicator follows the finger at this share of the distance, so the pull feels heavy. */
export const RESISTANCE = 0.6;
/** The indicator stops here. */
export const MAX_OFFSET = 96;
/** Where the list sits while it refreshes: room for the spinner. */
export const REFRESHING_OFFSET = 44;

export type PullPhase = 'idle' | 'pull' | 'release' | 'refreshing';

/** How far the list moves down for a finger `dy` px below where it started. */
export function pullOffset(dy: number): number {
  return dy <= 0 ? 0 : Math.min(MAX_OFFSET, dy * RESISTANCE);
}

/** What the indicator says, from how far the finger moved down. */
export function pullPhase(dy: number, refreshing: boolean): PullPhase {
  if (refreshing) return 'refreshing';
  if (dy <= 0) return 'idle';
  return dy > PULL_THRESHOLD ? 'release' : 'pull';
}

/** A pull only starts with the list at its top, and going down: anything else is a scroll. */
export const pullStarts = (scrollTop: number, dy: number, dx: number) => scrollTop <= 0 && dy > 0 && dy > Math.abs(dx);

export const PULL_LABEL: Record<Exclude<PullPhase, 'idle'>, string> = {
  pull: 'Pull to refresh',
  release: 'Release to refresh',
  refreshing: 'Refreshing…',
};

/** What the indicator says; with a newer remote app on the site, letting go reloads the app with it. */
export function pullLabel(phase: Exclude<PullPhase, 'idle'>, update: boolean): string {
  if (!update) return PULL_LABEL[phase];
  return phase === 'release' ? 'Release to update' : phase === 'refreshing' ? 'Updating…' : PULL_LABEL.pull;
}
