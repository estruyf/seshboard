import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentUsage } from '@seshboard/protocol';
import { parseUsageLine } from './transcriptUsage.ts';

const TOOL_USE_ID = /"type":"tool_use","id":"([^"]+)"/g;

/**
 * The tokens each subagent of a session used, by the tool call that started it. Claude Code keeps a subagent's
 * conversation in `<session>/subagents/agent-<id>.jsonl`, with `agent-<id>.meta.json` naming that tool call; the
 * session's own transcript has none of it. Lines go through the Usage scanner's parser and count once per response,
 * as there. A subagent started by another subagent counts for the one the session started, so every token lands on a
 * tool call the conversation shows. Files that can't be read are left out.
 */
export async function agentUsage(transcriptPath: string | null): Promise<AgentUsage[]> {
  const dir = transcriptPath ? join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents') : null;
  if (!dir || !existsSync(dir)) return [];
  const files = await readdir(dir).catch(() => [] as string[]);
  const agents: Array<{ toolUseId: string; usage: AgentUsage; calls: Set<string> }> = [];
  for (const file of files.filter((f) => f.endsWith('.meta.json'))) {
    let toolUseId: unknown;
    try {
      toolUseId = (JSON.parse(await readFile(join(dir, file), 'utf8')) as { toolUseId?: unknown }).toolUseId;
    } catch {
      continue; // half written: the next read sees it
    }
    if (typeof toolUseId !== 'string' || !toolUseId) continue;
    const text = await readFile(join(dir, file.replace(/\.meta\.json$/, '.jsonl')), 'utf8').catch(() => '');
    const usage: AgentUsage = { toolUseId, model: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, replies: 0 };
    const seen = new Set<string>();
    const models = new Set<string>();
    const calls = new Set<string>();
    for (const line of text.split('\n')) {
      // The tool calls it made, so an agent it started can be counted for it.
      if (line.includes('"tool_use"')) for (const match of line.matchAll(TOOL_USE_ID)) calls.add(match[1]!);
      const parsed = parseUsageLine(line);
      if (!parsed || seen.has(parsed.key)) continue;
      seen.add(parsed.key);
      models.add(parsed.model);
      usage.input += parsed.input;
      usage.output += parsed.output;
      usage.cacheRead += parsed.cacheRead;
      usage.cacheWrite += parsed.cacheWrite;
      usage.replies += 1;
    }
    usage.model = models.size === 1 ? [...models][0]! : null;
    agents.push({ toolUseId, usage, calls });
  }

  // Roll each nested agent up to the agent whose call started it, until it reaches one the session started.
  const parentOf = (toolUseId: string) => agents.find((a) => a.calls.has(toolUseId));
  const roots = new Map<string, AgentUsage>();
  for (const agent of agents) {
    let root = agent;
    for (let depth = 0, parent = parentOf(root.toolUseId); parent && depth < 10; depth++, parent = parentOf(root.toolUseId)) root = parent;
    const total = roots.get(root.toolUseId);
    if (!total) {
      roots.set(root.toolUseId, { ...agent.usage, toolUseId: root.toolUseId });
      continue;
    }
    total.model = total.model === agent.usage.model ? total.model : null;
    total.input += agent.usage.input;
    total.output += agent.usage.output;
    total.cacheRead += agent.usage.cacheRead;
    total.cacheWrite += agent.usage.cacheWrite;
    total.replies += agent.usage.replies;
  }
  return [...roots.values()];
}
