import type { HealthFinding } from '@switchboard/protocol/client';

/** Findings to act on; old memories are only shown, so they don't count. */
export const toLookAt = (findings: readonly HealthFinding[]) => findings.filter((f) => f.kind !== 'old');

/** The memories with something to look at, for the small caution icon on their rows. */
export function flaggedPaths(findings: readonly HealthFinding[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of toLookAt(findings)) for (const path of f.memoryPaths) if (!map.has(path)) map.set(path, f.detail);
  return map;
}

/** The tone of a finding's icon: an index past what loads is an error, old is quiet, the rest caution. */
export const findingTone = (finding: HealthFinding) => (finding.kind === 'overLimit' ? 'error' : finding.kind === 'old' ? 'faint' : 'caution');

/** The prompt Tidy with Claude… puts in New session for you to read before starting it. Switchboard runs nothing. */
export const tidyPrompt = (indexPath: string) =>
  `Tidy ${indexPath}: merge duplicates and shorten lines so it fits in 200 lines; don't drop facts. Keep one line per memory file in the form "- [Title](file.md) — hook".`;

/** Merge into left…: the left memory's text with the right one's after it, under a rule, nothing dropped. */
export const mergedBody = (left: string, right: string) => `${left.trimEnd()}\n\n---\n\n${right.trim()}\n`;

/** Health's one line in What loads here: "2 to look at", or that all is well. */
export const healthSummary = (findings: readonly HealthFinding[]) => {
  const count = toLookAt(findings).length;
  return count ? `${count} to look at` : 'nothing to look at';
};
