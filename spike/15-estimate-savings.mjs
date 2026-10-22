// Q: What would compress-prototype.mjs save on real sessions? Runs offline over the newest transcripts in
//    ~/.claude/projects (no Claude calls), and prints totals only: no command or output is printed.
//    Tokens are estimated at 4 characters each. Failed commands are counted apart: PostToolUse can't rewrite them.
// Usage: node 15-estimate-savings.mjs [number of transcripts, default 300]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { compressOutput, outputKind, segments } from './compress-prototype.mjs';

const root = join(homedir(), '.claude', 'projects');
const files = readdirSync(root).flatMap((d) => {
  try { return readdirSync(join(root, d)).filter((f) => f.endsWith('.jsonl')).map((f) => join(root, d, f)); } catch { return []; }
}).map((f) => [f, statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[2] ?? 300)).map(([f]) => f);

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '');
const tok = (n) => Math.round(n / 4);
const k = (n) => `${(tok(n) / 1000).toFixed(0)}k`;
const s = { small: 0, skipped: 0, skippedKind: {}, byKind: {}, allTool: 0, bashOk: 0, bashFail: 0, verbatim: 0, eligible: 0, compressed: 0, after: 0, count: 0, mcp: 0, mcpAfter: 0, mcpCount: 0 };
const byCmd = {};
const verb = {};

for (const file of files) {
  const uses = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const content = j.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use') uses[b.id] = b;
      if (b.type !== 'tool_result') continue;
      const out = text(b.content);
      s.allTool += out.length;
      const use = uses[b.tool_use_id];
      if (use?.name?.startsWith('mcp__')) {
        const c = compressOutput(out);
        if (c !== null) { s.mcp += out.length; s.mcpAfter += c.length; s.mcpCount++; }
        continue;
      }
      if (use?.name !== 'Bash') continue;
      if (b.is_error) { s.bashFail += out.length; continue; }
      s.bashOk += out.length;
      const cmd = String(use.input?.command ?? '');
      const kind = outputKind(cmd);
      if (kind === 'verbatim') { s.verbatim += out.length; const w = (segments(cmd)[0] ?? '?').split(/\s+/).slice(0, /^git\b/.test(segments(cmd)[0] ?? '') ? 2 : 1).join(' '); verb[w] = (verb[w] ?? 0) + out.length; continue; }
      s.eligible += out.length;
      const c = compressOutput(out, { kind });
      if (c === null) { if (out.length < 2000) s.small += out.length; else { s.skipped += out.length; s.skippedKind[kind] = (s.skippedKind[kind] ?? 0) + out.length; } continue; }
      s.byKind[kind] = (s.byKind[kind] ?? 0) + out.length - c.length;
      s.compressed += out.length; s.after += c.length; s.count++;
      const first = cmd.split(/&&|;|\|/).map((x) => x.trim()).find((x) => x && !/^(cd|export)\b/.test(x) && !/^\w+=/.test(x)) ?? cmd;
      const word = first.trim().split(/\s+/).slice(0, /^(npm|git|npx|gh)\b/.test(first.trim()) ? 2 : 1).join(' ');
      byCmd[word] ??= { before: 0, after: 0, n: 0 };
      byCmd[word].before += out.length; byCmd[word].after += c.length; byCmd[word].n++;
    }
  }
}

const pct = (a, b) => `${((100 * a) / b).toFixed(0)}%`;
console.log(`${files.length} transcripts, ~${k(s.allTool)} tokens of text tool output`);
console.log(`Bash ok: ${k(s.bashOk)} | Bash failed (can't rewrite): ${k(s.bashFail)} | file-printing commands left alone: ${k(s.verbatim)}`);
console.log(`Compressed ${s.count} Bash outputs: ${k(s.compressed)} → ${k(s.after)} (−${pct(s.compressed - s.after, s.compressed)})`);
console.log(`Not compressed: under 2k chars ${k(s.small)}; over 2k but < 30% to gain ${k(s.skipped)} ${JSON.stringify(Object.fromEntries(Object.entries(s.skippedKind).map(([a, b]) => [a, k(b)])))}; saved by kind ${JSON.stringify(Object.fromEntries(Object.entries(s.byKind).map(([a, b]) => [a, k(b)])))}`);
console.log(`MCP text, same compressor: ${s.mcpCount} outputs, ${k(s.mcp)} → ${k(s.mcpAfter)}`);
const saved = s.compressed - s.after + s.mcp - s.mcpAfter;
console.log(`Saved: ~${k(saved)} tokens = ${pct(saved, s.allTool)} of all text tool output, ${pct(s.compressed - s.after, s.bashOk + s.bashFail)} of Bash output`);
console.log('\nBy command (top 12 by tokens saved):');
for (const [w, v] of Object.entries(byCmd).sort((a, b) => (b[1].before - b[1].after) - (a[1].before - a[1].after)).slice(0, 12)) {
  console.log(`  ${w.slice(0, 22).padEnd(22)} ${String(v.n).padStart(4)}×  ${k(v.before).padStart(5)} → ${k(v.after).padStart(5)}  (−${pct(v.before - v.after, v.before)})`);
}
console.log('\nLeft alone as file contents, by command:', Object.entries(verb).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, v]) => `${w} ${k(v)}`).join(', '));
