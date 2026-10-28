/**
 * Groups every signal in a runs folder by kind and normalised text (one group per likely root cause), oldest run
 * first:
 *
 *   node scripts/chaos/triage.ts [runs-dir] [--kind rpc-error] [--first 'monkey-12|mix-'] [--quiet]
 *
 * `--first` keeps the groups first seen in runs whose name matches (what a round found that earlier ones didn't);
 * `--quiet` leaves out what the sandbox always produces (no Claude Code login, the demo's stand-in processes, news
 * toasts).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultOutDir, normalise, type Signal } from './lib/harness.ts';

/** What the sandbox always produces, not a finding. */
const EXPECTED = /Not logged in|NOT_RUNNING|not running in Seshboard|SESSION_BUSY_ELSEWHERE|open in another Claude Code window|^Switched to|^Copied|^Exported|^Added to|Prompt copied/;

export interface SignalGroup {
  kind: string;
  detail: string;
  runs: string[];
  first: { run: string; action: number; screenshot?: string };
}

export function groupSignals(dir: string, options: { kind?: string; firstIn?: RegExp; quiet?: boolean } = {}): SignalGroup[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.signals.jsonl'))
    .sort((a, b) => statSync(join(dir, a)).mtimeMs - statSync(join(dir, b)).mtimeMs);
  const groups = new Map<string, SignalGroup>();
  for (const f of files) {
    const run = f.replace('.signals.jsonl', '');
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)) {
      const s = JSON.parse(line) as Signal & { repeated?: number };
      if (s.repeated) continue;
      if (options.kind && s.kind !== options.kind) continue;
      if (options.quiet && EXPECTED.test(s.detail)) continue;
      const key = `${s.kind}:${normalise(s.detail)}`;
      const g = groups.get(key) ?? { kind: s.kind, detail: s.detail, runs: [], first: { run, action: s.action, screenshot: s.screenshot } };
      if (!g.runs.includes(run)) g.runs.push(run);
      groups.set(key, g);
    }
  }
  return [...groups.values()].filter((g) => !options.firstIn || options.firstIn.test(g.first.run)).sort((a, b) => a.kind.localeCompare(b.kind) || b.runs.length - a.runs.length);
}

export function printGroups(groups: SignalGroup[]): void {
  for (const g of groups) {
    console.log(`[${g.kind}] ×${g.runs.length} ${g.runs.join(',')}  first ${g.first.run}#${g.first.action} ${g.first.screenshot ?? ''}`);
    console.log(`    ${g.detail.replace(/\S*\/sbc-\w+/g, '<sandbox>').split('\n')[0]!.slice(0, 400)}`);
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const dir = argv[0] && !argv[0].startsWith('--') ? argv[0] : defaultOutDir();
  const first = opt('--first');
  printGroups(groupSignals(dir, { kind: opt('--kind'), firstIn: first ? new RegExp(first) : undefined, quiet: argv.includes('--quiet') }));
}
