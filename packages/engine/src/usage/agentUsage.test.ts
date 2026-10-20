import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentUsage } from './agentUsage.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-agent-usage-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** An assistant line as Claude Code writes it in a subagent's transcript: one per content block, each with the whole usage. */
const line = (id: string, o: { model?: string; input?: number; output?: number; read?: number; write?: number; call?: string } = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-16T10:00:00Z',
    sessionId: 's1',
    requestId: `req_${id}`,
    message: {
      id,
      model: o.model ?? 'claude-sonnet-5-5',
      content: o.call ? [{ type: 'tool_use', id: o.call, name: 'Agent', input: {} }] : [{ type: 'text', text: 'Done' }],
      usage: { input_tokens: o.input ?? 10, output_tokens: o.output ?? 100, cache_read_input_tokens: o.read ?? 1000, cache_creation_input_tokens: o.write ?? 200 },
    },
  });

function agent(name: string, toolUseId: string, lines: string[]) {
  const sub = join(dir, 's1', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, `agent-${name}.meta.json`), JSON.stringify({ agentType: 'Explore', toolUseId }));
  writeFileSync(join(sub, `agent-${name}.jsonl`), lines.join('\n') + '\n');
}

describe('agentUsage', () => {
  it('sums each subagent once per response, by the tool call that started it', async () => {
    agent('a1', 'toolu_1', [line('m1'), line('m1'), line('m2', { output: 50 })]);
    agent('a2', 'toolu_2', [line('m3', { model: 'claude-haiku-4-5' })]);
    const usage = await agentUsage(join(dir, 's1.jsonl'));
    expect(usage.sort((a, b) => a.toolUseId.localeCompare(b.toolUseId))).toEqual([
      { toolUseId: 'toolu_1', model: 'claude-sonnet-5-5', input: 20, output: 150, cacheRead: 2000, cacheWrite: 400, replies: 2 },
      { toolUseId: 'toolu_2', model: 'claude-haiku-4-5', input: 10, output: 100, cacheRead: 1000, cacheWrite: 200, replies: 1 },
    ]);
  });

  it('counts an agent started by another agent for the one the session started', async () => {
    agent('outer', 'toolu_1', [line('m1', { call: 'toolu_inner' })]);
    agent('inner', 'toolu_inner', [line('m2', { model: 'claude-haiku-4-5', output: 7 })]);
    const usage = await agentUsage(join(dir, 's1.jsonl'));
    expect(usage).toEqual([{ toolUseId: 'toolu_1', model: null, input: 20, output: 107, cacheRead: 2000, cacheWrite: 400, replies: 2 }]);
  });

  it('is empty without subagents or a transcript', async () => {
    expect(await agentUsage(join(dir, 'none.jsonl'))).toEqual([]);
    expect(await agentUsage(null)).toEqual([]);
  });
});
