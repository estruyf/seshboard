import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServerStatus, Query } from '@anthropic-ai/claude-agent-sdk';
import type { Capabilities, McpServerInfo, PluginInfo } from '@seshboard/protocol';

const STATUSES = new Set(['connected', 'failed', 'needs-auth', 'pending', 'disabled']);

export function toMcpInfo(server: McpServerStatus): McpServerInfo {
  return {
    name: server.name,
    status: (STATUSES.has(server.status) ? server.status : 'pending') as McpServerInfo['status'],
    scope: server.source ?? server.scope ?? null,
    tools: (server.tools ?? []).map((t) => t.name),
    error: server.error ?? null,
    version: server.serverInfo?.version ?? null,
  };
}

/** Plugins as Claude Code's startup message lists them (only sent once a session has a prompt). */
export function pluginsFromInit(plugins: unknown): PluginInfo[] | null {
  if (!Array.isArray(plugins)) return null;
  return plugins.flatMap((p) => {
    const plugin = p as { name?: unknown; path?: unknown; version?: unknown };
    return typeof plugin.name === 'string'
      ? [{ name: plugin.name, version: typeof plugin.version === 'string' ? plugin.version : null, scope: null, path: typeof plugin.path === 'string' ? plugin.path : null }]
      : [];
  });
}

/**
 * Installed plugins from ~/.claude/plugins/installed_plugins.json, for sessions that aren't
 * running. Best effort: an unknown format just means an empty list.
 */
export function installedPlugins(claudeConfigDir: string): PluginInfo[] {
  try {
    const file = JSON.parse(readFileSync(join(claudeConfigDir, 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: Record<string, unknown> };
    return Object.entries(file.plugins ?? {}).flatMap(([id, installs]) => {
      const latest = (Array.isArray(installs) ? installs.at(-1) : installs) as { version?: unknown; scope?: unknown; installPath?: unknown } | undefined;
      return [
        {
          name: id.split('@')[0] ?? id,
          version: typeof latest?.version === 'string' ? latest.version : null,
          scope: typeof latest?.scope === 'string' ? latest.scope : null,
          path: typeof latest?.installPath === 'string' ? latest.installPath : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** MCP status once the servers have had a moment to connect (a fresh process reports them all as pending). */
async function settledMcp(query: Query, settleMs: number): Promise<McpServerStatus[]> {
  const deadline = Date.now() + settleMs;
  let status = await query.mcpServerStatus();
  while (status.some((s) => s.status === 'pending') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    status = await query.mcpServerStatus();
  }
  return status;
}

/** Asks a Claude Code process (a session's or a helper's) what it can use. */
export async function readCapabilities(query: Query, plugins: PluginInfo[], live: boolean, settleMs = 0): Promise<Capabilities> {
  const [mcp, agents, commands] = await Promise.all([settledMcp(query, settleMs), query.supportedAgents(), query.supportedCommands()]);
  return {
    live,
    mcp: mcp.map(toMcpInfo).sort((a, b) => a.name.localeCompare(b.name)),
    agents: agents.map((a) => ({ name: a.name, description: a.description, model: a.model ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
    commands: commands
      .filter((c) => !c.builtin && !c.name.startsWith('__'))
      .map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    plugins: [...plugins].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
