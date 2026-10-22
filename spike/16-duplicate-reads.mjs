// Q: How much tool output repeats output already in the same session (the same file printed twice, the same
//    `git status`)? A repeat could be swapped for a pointer to the earlier result without losing anything, as long
//    as no compaction happened in between. Offline over ~/.claude/projects; prints totals only.
// Usage: node 16-duplicate-reads.mjs [number of transcripts, default 300]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = join(homedir(), '.claude', 'projects');
const files = readdirSync(root).flatMap((d) => {
  try { return readdirSync(join(root, d)).filter((f) => f.endsWith('.jsonl')).map((f) => join(root, d, f)); } catch { return []; }
}).map((f) => [f, statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[2] ?? 300)).map(([f]) => f);
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '');
const k = (n) => `${Math.round(n / 4000)}k`;
let all = 0, dup = 0, dupLines = 0, compactions = 0;
const byTool = {};
for (const file of files) {
  const uses = {}; let seen = new Map(); let lineSeen = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    // After a compaction the earlier output is gone from the context, so a repeat is needed again.
    if (j.type === 'system' && j.subtype === 'compact_boundary') { seen = new Map(); lineSeen = new Set(); compactions++; continue; }
    const content = j.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use') uses[b.id] = b.name;
      if (b.type !== 'tool_result') continue;
      const out = text(b.content);
      if (out.length < 500) continue;
      all += out.length;
      const h = createHash('sha1').update(out).digest('hex');
      const tool = uses[b.tool_use_id] ?? '?';
      if (seen.has(h)) { dup += out.length; byTool[tool] = (byTool[tool] ?? 0) + out.length; } else seen.set(h, true);
      // Partial repeats: long lines (code, not blank or brace lines) seen before in this session's tool output.
      for (const l of out.split('\n')) { const t = l.trim(); if (t.length < 40) continue; if (lineSeen.has(t)) dupLines += l.length + 1; else lineSeen.add(t); }
    }
  }
}
console.log(`${files.length} transcripts (${compactions} compactions), ${k(all)} tokens of tool output over 500 chars`);
console.log(`Exact repeats of an earlier result: ${k(dup)} (${Math.round(100 * dup / all)}%)`, JSON.stringify(Object.fromEntries(Object.entries(byTool).map(([a, b]) => [a, k(b)]))));
console.log(`Long lines already seen earlier in the session: ${k(dupLines)} (${Math.round(100 * dupLines / all)}%)`);
