// Q: Where does a session's token spend go: fresh input, cache writes, cache reads or output? And how much of each
//    API call is the fixed part (system prompt and tools) against the conversation? Weighted by the API's price
//    ratios (input 1, 5-minute cache write 1.25, 1-hour cache write 2, cache read 0.1, output 5), which is also
//    roughly how plan limits weigh them. Offline over ~/.claude/projects; prints totals only.
// Usage: node 17-where-tokens-go.mjs [number of transcripts, default 300]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = join(homedir(), '.claude', 'projects');
const files = readdirSync(root).flatMap((d) => {
  try { return readdirSync(join(root, d)).filter((f) => f.endsWith('.jsonl')).map((f) => join(root, d, f)); } catch { return []; }
}).map((f) => [f, statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[2] ?? 300)).map(([f]) => f);
const t = { calls: 0, input: 0, w5: 0, w1h: 0, read: 0, output: 0, firstCtx: [], ctx: [] };
for (const file of files) {
  const ids = new Set(); let first = true;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const m = j.message; const u = m?.usage;
    if (j.type !== 'assistant' || !u || ids.has(m.id) || j.isSidechain) continue;
    ids.add(m.id); t.calls++;
    const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    t.input += u.input_tokens ?? 0; t.read += u.cache_read_input_tokens ?? 0; t.output += u.output_tokens ?? 0;
    t.w1h += w1h; t.w5 += (u.cache_creation_input_tokens ?? 0) - w1h;
    const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    if (first) { t.firstCtx.push(ctx); first = false; }
    t.ctx.push(ctx);
  }
}
const w = { input: t.input, 'cache write 5m': t.w5 * 1.25, 'cache write 1h': t.w1h * 2, 'cache read': t.read * 0.1, output: t.output * 5 };
const total = Object.values(w).reduce((a, b) => a + b, 0);
const M = (n) => `${(n / 1e6).toFixed(1)}M`;
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log(`${files.length} transcripts, ${t.calls} API calls (${Math.round(t.calls / files.length)} per session)`);
console.log(`Raw tokens: input ${M(t.input)}, cache write ${M(t.w5 + t.w1h)} (1h: ${M(t.w1h)}), cache read ${M(t.read)}, output ${M(t.output)}`);
console.log('Share of weighted cost:', Object.entries(w).map(([a, b]) => `${a} ${Math.round(100 * b / total)}%`).join(', '));
console.log(`Context per call: median ${Math.round(med(t.ctx) / 1000)}k; first call of a session (system prompt, tools, CLAUDE.md, first prompt): median ${Math.round(med(t.firstCtx) / 1000)}k`);
console.log(`Fixed part as a share of all context read: ~${Math.round(100 * med(t.firstCtx) * t.calls / t.ctx.reduce((a, b) => a + b, 0))}%`);
// How much of the cache reading happens in calls past a context size: what compacting sooner could touch.
const read = t.ctx.reduce((a, b) => a + b, 0);
for (const limit of [100e3, 200e3, 400e3, 600e3]) {
  const over = t.ctx.filter((c) => c > limit);
  console.log(`Calls over ${limit / 1000}k context: ${Math.round(100 * over.length / t.ctx.length)}% of calls, ${Math.round(100 * over.reduce((a, b) => a + b, 0) / read)}% of context read, ${Math.round(100 * over.reduce((a, b) => a + b - limit, 0) / read)}% is the part above ${limit / 1000}k`);
}
console.log(`Largest context: ${Math.round(Math.max(...t.ctx) / 1000)}k`);
