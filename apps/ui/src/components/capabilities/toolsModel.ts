import type { Capabilities } from '@seshboard/protocol/client';

export type ToolsTab = 'mcp' | 'commands' | 'agents' | 'plugins' | 'hooks';

/**
 * Tools' tabs with their counts (null while it is asked): Hooks only for a session whose capabilities list them (Codex);
 * Claude Code's and Copilot's have none, so their tabs stay as they were.
 */
export function toolsTabs(caps: Capabilities | null): Array<{ id: ToolsTab; label: string; count: number | null }> {
  return [
    { id: 'mcp', label: 'MCP servers', count: caps?.mcp.length ?? null },
    { id: 'commands', label: 'Skills & commands', count: caps?.commands.length ?? null },
    { id: 'agents', label: 'Agents', count: caps?.agents.length ?? null },
    { id: 'plugins', label: 'Plugins', count: caps?.plugins.length ?? null },
    ...(caps?.hooks ? [{ id: 'hooks' as const, label: 'Hooks', count: caps.hooks.length }] : []),
  ];
}

/** Whether a server can be turned on or off: not for a provider that says it can't (`mcpToggle: false`, Codex). */
export const canToggleMcp = (caps: Capabilities | null): boolean => caps?.mcpToggle !== false;
