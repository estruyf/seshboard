import type { Capabilities, McpServerInfo } from '@seshboard/protocol';

/** One of Copilot's MCP servers, as `session.mcp.list` gives it. */
export interface CopilotMcpServer {
  name: string;
  status: string;
  source?: string;
  displayName?: string;
  error?: string;
  serverMetadata?: { version?: string };
}

/** One of Copilot's skills, as `session.skills.list` gives it. */
export interface CopilotSkill {
  name: string;
  commandName?: string;
  description?: string;
  /** `builtin` skills are Copilot's own, like Claude Code's built-in commands: left out of Tools. */
  source?: string;
  enabled?: boolean;
}

const STATUS: Record<string, McpServerInfo['status']> = { connected: 'connected', failed: 'failed', 'needs-auth': 'needs-auth', pending: 'pending', disabled: 'disabled', stopped: 'disabled' };

/**
 * Copilot's MCP servers, agents and skills as Tools shows Claude Code's. Its built-in skills are left out, as Claude
 * Code's built-in commands are; it has no plugins list to show.
 */
export function copilotCapabilities(lists: { mcp: readonly CopilotMcpServer[]; skills: readonly CopilotSkill[]; agents: ReadonlyArray<{ name: string; description?: string; model?: string }> }): Capabilities {
  return {
    live: true,
    mcp: lists.mcp.map((s) => ({ name: s.displayName ?? s.name, status: STATUS[s.status] ?? 'pending', scope: s.source ?? null, tools: [], error: s.error ?? null, version: s.serverMetadata?.version ?? null })),
    agents: lists.agents.map((a) => ({ name: a.name, description: a.description ?? '', model: a.model ?? null })),
    commands: lists.skills.filter((s) => s.source !== 'builtin' && s.enabled !== false).map((s) => ({ name: s.commandName ?? s.name, description: s.description ?? '', argumentHint: '' })),
    plugins: [],
  };
}
