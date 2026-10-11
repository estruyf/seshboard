import { MEMORY_INDEX_LIMIT, type LoadEntry } from '@switchboard/protocol/client';
import type { Level } from '../../lib/levels.ts';

/** MEMORY.md's lines as a level: fine under 180, caution up to 200, past what loads above 200. */
export function indexLevel(lines: number): Level {
  if (lines > MEMORY_INDEX_LIMIT) return 'high';
  return lines >= 180 ? 'caution' : 'ok';
}

/** "0.9 KB", "84 B", "1.2 MB": kilobytes from 100 bytes, as the design writes them. */
export function formatSize(bytes: number): string {
  if (bytes < 100) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** What loads in the context at launch: everything but on-demand rules, and of MEMORY.md only what is read. */
export const loadedBytes = (entry: LoadEntry) => (entry.when === 'on-demand' ? 0 : (entry.loaded?.bytes ?? entry.bytes));

/** The one-line form of the card: "Loads 5 files · 6.4 KB · MEMORY.md 186/200". */
export function loadSummary(entries: readonly LoadEntry[]): string {
  const launch = entries.filter((e) => e.when === 'launch');
  const bytes = launch.reduce((n, e) => n + loadedBytes(e), 0);
  const memory = launch.find((e) => e.kind === 'memory');
  const parts = [`Loads ${launch.length} ${launch.length === 1 ? 'file' : 'files'}`, formatSize(bytes)];
  if (memory) parts.push(`MEMORY.md ${memory.lines}/${MEMORY_INDEX_LIMIT}`);
  return parts.join(' · ');
}

/** A part of the stacked bar: a kind of file, its bytes, and whether it is MEMORY.md past what loads. */
export interface BarSegment {
  key: string;
  kind: LoadEntry['kind'];
  bytes: number;
  overflow: boolean;
}

/** The bar's parts, by size, in load order; MEMORY.md is split into what loads and what doesn't. */
export function barSegments(entries: readonly LoadEntry[]): BarSegment[] {
  return entries
    .filter((e) => e.when === 'launch')
    .flatMap((e): BarSegment[] => {
      if (e.kind !== 'memory' || !e.loaded) return [{ key: e.path, kind: e.kind, bytes: e.bytes, overflow: false }];
      const rest = e.bytes - e.loaded.bytes;
      return [{ key: e.path, kind: e.kind, bytes: e.loaded.bytes, overflow: false }, ...(rest > 0 ? [{ key: `${e.path}#rest`, kind: e.kind, bytes: rest, overflow: true }] : [])];
    });
}

/** A legend entry: what it is, its size, and the files it stands for (clicking selects the first). */
export interface LegendItem {
  key: string;
  kind: LoadEntry['kind'];
  label: string;
  detail: string;
  paths: string[];
  /** Part of MEMORY.md that doesn't load. */
  overflow?: boolean;
  onDemand?: boolean;
}

/**
 * The legend under the bar: one item per file, rules side by side grouped ("2 rules · 0.9 KB"), MEMORY.md with its
 * loaded and total lines and, past the limit, an item for what doesn't load. On-demand rules come last.
 */
export function legendItems(entries: readonly LoadEntry[], labelOf: (path: string) => string): LegendItem[] {
  const items: LegendItem[] = [];
  for (const entry of entries) {
    const last = items.at(-1);
    const rule = entry.kind === 'rule' || entry.kind === 'user-rule';
    if (entry.when === 'on-demand') {
      items.push({ key: entry.path, kind: entry.kind, label: labelOf(entry.path), detail: `on demand: ${(entry.paths ?? []).join(', ')}`, paths: [entry.path], onDemand: true });
    } else if (rule && last && last.kind === entry.kind && !last.onDemand) {
      last.paths.push(entry.path);
      const bytes = entries.filter((e) => last.paths.includes(e.path)).reduce((n, e) => n + e.bytes, 0);
      last.label = `${last.paths.length} ${entry.kind === 'user-rule' ? 'personal rules' : 'rules'}`;
      last.detail = formatSize(bytes);
    } else if (entry.kind === 'memory' && entry.loaded) {
      items.push({ key: entry.path, kind: 'memory', label: 'MEMORY.md', detail: `${entry.loaded.lines} of ${entry.lines} lines`, paths: [entry.path] });
      const missing = entry.lines - entry.loaded.lines;
      if (missing > 0) items.push({ key: `${entry.path}#rest`, kind: 'memory', label: `${missing} ${missing === 1 ? 'line' : 'lines'} not loaded`, detail: '', paths: [entry.path], overflow: true });
    } else {
      items.push({ key: entry.path, kind: entry.kind, label: rule ? '1 rule' : labelOf(entry.path), detail: formatSize(entry.bytes), paths: [entry.path] });
      if (rule) items.at(-1)!.label = entry.kind === 'user-rule' ? '1 personal rule' : '1 rule';
    }
  }
  return items;
}

/** The colour of each kind of file in the bar and the legend (theme tokens only). */
export const KIND_FILL: Record<LoadEntry['kind'], string> = {
  user: 'bg-faint',
  'user-rule': 'bg-faint/60',
  import: 'bg-muted/50',
  project: 'bg-muted',
  local: 'bg-unread/60',
  rule: 'bg-link',
  memory: 'bg-memory',
};
