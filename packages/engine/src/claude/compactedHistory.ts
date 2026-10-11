import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RawSessionMessage } from './transcript.ts';

/** One line of a transcript file, as the SDK's session store takes it. */
export type TranscriptEntry = { type: string; uuid?: string; timestamp?: string; [key: string]: unknown };

/** Reads the conversation the SDK finds in these entries (its `getSessionMessages` with a session store). */
export type ReadEntries = (entries: TranscriptEntry[]) => Promise<RawSessionMessage[]>;

const isBoundary = (entry: TranscriptEntry) => entry.type === 'system' && entry.subtype === 'compact_boundary';

/**
 * The parts of a compacted conversation before `latest`, oldest first, each followed by a
 * "Conversation compacted" notice. Claude Code's reader starts a compacted conversation at its
 * last compaction (the boundary has no parent, only a `logicalParentUuid`), so the file's entries
 * up to each boundary go back through the same reader, which rebuilds the conversation as it was
 * then. Empty when `latest` doesn't start from a compaction summary or the boundary isn't found.
 */
export async function earlierParts(latest: readonly RawSessionMessage[], entries: readonly TranscriptEntry[], read: ReadEntries): Promise<RawSessionMessage[]> {
  const parts: RawSessionMessage[][] = [];
  let current = latest;
  let end = entries.length;
  for (;;) {
    const summary = current.find((m) => m.isCompactSummary);
    if (!summary) break;
    const at = entries.slice(0, end).findIndex((e) => e.uuid === summary.uuid);
    const boundary = at < 0 ? -1 : entries.slice(0, at).findLastIndex(isBoundary);
    if (boundary < 0) break;
    current = await read(entries.slice(0, boundary));
    if (current.length === 0) break;
    const { uuid, timestamp } = entries[boundary]!;
    const notice: RawSessionMessage = { type: 'system', uuid: uuid ?? `compact:${boundary}`, message: { subtype: 'compact_boundary' }, parent_tool_use_id: null, timestamp };
    parts.unshift([...current, notice]);
    end = boundary;
  }
  return parts.flat();
}

/**
 * The whole conversation: the earlier parts, then the latest. Messages Claude Code kept through a
 * compaction are in both; they stay where they were first said.
 */
export function joinParts(earlier: readonly RawSessionMessage[], latest: readonly RawSessionMessage[]): RawSessionMessage[] {
  if (earlier.length === 0) return [...latest];
  const seen = new Set<string>();
  return [...earlier, ...latest].filter((m) => !seen.has(m.uuid) && seen.add(m.uuid));
}

/**
 * The entries of `<configDir>/projects/<any>/<sessionId>.jsonl`, from the file that holds
 * `containing` (a session can be in more than one project folder). Lines that aren't valid JSON
 * are skipped; null when no file has it.
 */
export async function readTranscriptEntries(configDir: string, sessionId: string, containing: string): Promise<TranscriptEntry[] | null> {
  const projects = join(configDir, 'projects');
  const dirs = await readdir(projects, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const text = await readFile(join(projects, dir.name, `${sessionId}.jsonl`), 'utf8').catch(() => null);
    if (text === null || !text.includes(containing)) continue;
    const entries: TranscriptEntry[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as unknown;
        if (entry && typeof entry === 'object' && typeof (entry as TranscriptEntry).type === 'string') entries.push(entry as TranscriptEntry);
      } catch {
        // A line Claude Code is still writing, or a damaged one: the reader skips it too.
      }
    }
    return entries;
  }
  return null;
}
