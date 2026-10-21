// Q: Can a PostToolUse hook replace a tool's output before Claude sees it (`updatedToolOutput`), for built-in tools
//    (Bash, Grep) and MCP tools alike? What shape does each tool's `tool_response` have, and what shape must the
//    replacement have? Does the hook see the full output of a long Bash command, or the preview Claude Code keeps
//    once it passes `bashOutputMaxChars`? What lands in the session file and in the streamed messages: the
//    original or the replacement?
//    Each case swaps the real output for a decoy with a wrong answer in it, so Claude's reply tells which one it saw.
// Usage: SPIKE_SANDBOX=/tmp/x node 14-compress-tool-output.mjs
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { baseOptions, log, SANDBOX } from './lib.mjs';

const projectDir = join(homedir(), '.claude', 'projects', realpathSync(SANDBOX).replace(/[^a-zA-Z0-9]/g, '-'));
writeFileSync(join(SANDBOX, 'haystack.txt'), Array.from({ length: 400 }, (_, i) => `line ${i} ${i === 271 ? 'NEEDLE-REAL' : 'hay'}`).join('\n'));

const shape = (v, depth = 0) => {
  if (typeof v === 'string') return `string(${v.length})`;
  if (Array.isArray(v)) return `[${v.slice(0, 3).map((x) => shape(x, depth + 1)).join(', ')}${v.length > 3 ? ', …' : ''}]`;
  if (v && typeof v === 'object') return depth > 2 ? '{…}' : `{${Object.entries(v).map(([k, x]) => `${k}: ${shape(x, depth + 1)}`).join(', ')}}`;
  return String(v);
};

// An in-process MCP tool that returns a big JSON list.
const mcp = createSdkMcpServer({
  name: 'spike',
  version: '1.0.0',
  tools: [tool('list_orders', 'List the orders', {}, async () => ({
    content: [{ type: 'text', text: JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ id: i, status: i === 123 ? 'FAILED-REAL' : 'ok' }))) }],
  }))],
});

const CASES = [
  {
    name: 'bash-object',
    prompt: 'Run the Bash command `seq 1 3000` and reply with only the last number it printed. Run nothing else.',
    expectReal: '3000', decoy: '4242',
    rewrite: (r) => ({ ...r, stdout: '1\n2\n… 2995 lines folded …\n4242' }),
  },
  {
    name: 'bash-string',
    prompt: 'Run the Bash command `seq 1 3000` and reply with only the last number it printed. Run nothing else.',
    expectReal: '3000', decoy: '5151',
    rewrite: () => '1\n2\n… 2995 lines folded …\n5151',
  },
  {
    name: 'bash-long',
    // ~109k characters, past the default bashOutputMaxChars of 30000.
    prompt: 'Run the Bash command `seq 1 20000` and reply with only the last number it printed. Run nothing else, and don\'t read any file.',
    expectReal: '20000', decoy: '6363',
    rewrite: (r) => ({ ...r, stdout: '1\n2\n… 19995 lines folded …\n6363' }),
  },
  {
    name: 'bash-fail',
    // A failing command: does PostToolUse fire at all, or only PostToolUseFailure (which can't rewrite)?
    prompt: 'Run the Bash command `seq 1 3000; exit 1` once and reply with only the last number it printed. Run nothing else.',
    expectReal: '3000', decoy: '7474',
    rewrite: (r) => ({ ...r, stdout: '1\n2\n… 2995 lines folded …\n7474' }),
  },
  {
    name: 'read',
    prompt: 'Read haystack.txt with the Read tool and reply with only the number of the line that contains NEEDLE (the number shown in the left column). Use no other tool.',
    expectReal: '272', decoy: '999',
    rewrite: (r) => (r?.file ? { ...r, file: { ...r.file, content: 'line 998 NEEDLE-DECOY', numLines: 1, startLine: 999, totalLines: 1 } } : r),
  },
  {
    name: 'grep',
    prompt: 'Use the Grep tool (content mode, with line numbers) to find NEEDLE in haystack.txt, and reply with only the line number it is on. Use no other tool.',
    expectReal: '272', decoy: '999',
    rewrite: (r) => (typeof r === 'object' && r && 'content' in r ? { ...r, content: 'haystack.txt:999:line 998 NEEDLE-DECOY' } : 'haystack.txt:999:line 998 NEEDLE-DECOY'),
  },
  {
    name: 'mcp',
    prompt: 'Call the list_orders tool and reply with only the id of the order whose status is not ok.',
    expectReal: '123', decoy: '77',
    rewrite: () => [{ type: 'text', text: '[{"id":0,"status":"ok"},"… 298 more ok …",{"id":77,"status":"FAILED-DECOY"}]' }],
  },
];

const only = process.argv[2];
let toolsLogged = false;
for (const c of CASES.filter((x) => !only || x.name === only)) {
  log(`=== ${c.name}`);
  const seen = [];
  const hook = async (input) => {
    const original = JSON.stringify(input.tool_response);
    seen.push({ tool: input.tool_name, shape: shape(input.tool_response), chars: original.length, hasEnd: original.includes(c.expectReal) });
    log('   hook', input.tool_name, shape(input.tool_response), `${original.length} chars`);
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: c.rewrite(input.tool_response) } };
  };
  const q = query({
    prompt: c.prompt,
    options: baseOptions({
      maxTurns: 4,
      persistSession: true,
      hooks: {
        PostToolUse: [{ hooks: [hook] }],
        PostToolUseFailure: [{ hooks: [async (i) => { log('   failure hook', i.tool_name, `error ${i.error.length} chars`, JSON.stringify(i.error.slice(-80))); seen.push({ tool: i.tool_name, failure: true, chars: i.error.length }); return {}; }] }],
      },
      mcpServers: { spike: mcp },
      allowedTools: ['mcp__spike__list_orders'],
      canUseTool: async (_t, i) => ({ behavior: 'allow', updatedInput: i }),
    }),
  });
  let sessionId; let answer = ''; let streamedResult = '';
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') { sessionId = m.session_id; if (!toolsLogged) { toolsLogged = true; log('   built-in tools', m.tools.filter((t) => !t.startsWith('mcp__')).join(' ')); } }
    if (m.type === 'user' && Array.isArray(m.message.content)) {
      for (const b of m.message.content) if (b.type === 'tool_result') streamedResult += JSON.stringify(b.content);
      if (m.tool_use_result !== undefined) streamedResult += `|tool_use_result:${JSON.stringify(m.tool_use_result)}`;
    }
    if (m.type === 'result') { answer = m.result ?? ''; log('   usage', JSON.stringify(m.usage)); }
  }
  const verdict = answer.includes(c.decoy) ? 'SAW REPLACEMENT' : answer.includes(c.expectReal) ? 'SAW ORIGINAL' : 'UNCLEAR';
  log('   answer', JSON.stringify(answer.slice(0, 200)), '→', verdict);
  log('   hook calls', JSON.stringify(seen));
  log('   streamed tool_result has decoy:', streamedResult.includes(c.decoy), '| has real:', streamedResult.includes(c.expectReal));
  try {
    const lines = readFileSync(join(projectDir, `${sessionId}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const results = lines.filter((l) => Array.isArray(l.message?.content) && l.message.content.some((b) => b.type === 'tool_result'));
    for (const l of results) {
      const content = JSON.stringify(l.message.content);
      const raw = JSON.stringify(l.toolUseResult ?? null);
      log('   file tool_result: decoy', content.includes(c.decoy), 'real', content.includes(c.expectReal), '| toolUseResult: decoy', raw.includes(c.decoy), 'real', raw.includes(c.expectReal));
    }
  } catch (e) { log('   no session file', e.message); }
}
