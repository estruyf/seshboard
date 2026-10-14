/**
 * Removes real paths and names from a hunt's artefacts before anyone else sees them:
 *
 *   node scripts/chaos/scrub.ts [dir]      (default: tests/chaos-hunt-<today>)
 *
 * The checkout becomes <repo>, the real home ~, the user name `you`. Text files only (logs, JSON, JSONL, Markdown);
 * screenshots can't be scrubbed, but the harness checks every window for the real home and user name as it runs.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultOutDir, repoRoot } from './lib/harness.ts';

const repo = repoRoot;
const dir = process.argv[2] ?? dirname(defaultOutDir());
const user = userInfo().username;
const pairs: Array<[string | RegExp, string]> = [
  [repo, '<repo>'],
  [`file://${repo}`, 'file://<repo>'],
  [homedir(), '~'],
  [new RegExp(`\\b${user}\\b`, 'g'), 'you'],
];
let changed = 0;
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(log|json|jsonl|md|txt)$/.test(e)) {
      const before = readFileSync(p, 'utf8');
      let text = before;
      for (const [from, to] of pairs) text = typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to);
      if (text !== before) {
        writeFileSync(p, text);
        changed++;
      }
    }
  }
};
walk(dir);
const left: string[] = [];
const check = (d: string) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) check(p);
    else if (/\.(log|json|jsonl|md|txt)$/.test(e) && (readFileSync(p, 'utf8').includes(homedir()) || new RegExp(`\\b${user}\\b`).test(readFileSync(p, 'utf8')))) left.push(p);
  }
};
check(dir);
console.log(`scrubbed ${changed} files; still mentioning real data: ${left.length ? left.join(', ') : 'none'}`);
