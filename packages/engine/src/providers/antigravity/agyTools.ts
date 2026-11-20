import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Capabilities, McpServerInfo, SlashCommand } from '@seshboard/protocol';

/** Antigravity's MCP servers, as `agy mcp add` writes them: `<gemini-dir>/config/mcp_config.json`. */
export const agyMcpConfig = (geminiDir: string) => join(geminiDir, 'config', 'mcp_config.json');

/**
 * The MCP servers in Antigravity's config, by name, on or off (`disabled`). Read only: Seshboard never writes it, and
 * `agy acp` doesn't say how a server is doing. A file that is missing, empty or of another shape lists none.
 */
export function agyMcpServers(geminiDir: string): McpServerInfo[] {
  let config: unknown;
  try {
    const text = readFileSync(agyMcpConfig(geminiDir), 'utf8');
    config = text.trim() ? JSON.parse(text) : null;
  } catch {
    return [];
  }
  const servers = (config as { mcpServers?: unknown } | null)?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  return Object.entries(servers as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => ({
      name,
      // `agy acp` doesn't say which started: one that is on shows as waiting, never as connected.
      status: (entry as { disabled?: unknown } | null)?.disabled === true ? ('disabled' as const) : ('pending' as const),
      scope: 'user',
      tools: [],
      error: null,
      version: null,
    }));
}

/** Turning a server on or off, or connecting it again, is Antigravity's own: `agy mcp` writes its config. */
export const AGY_MCP_REFUSED = 'Antigravity keeps its MCP servers in its own config. Use `agy mcp enable` or `agy mcp disable`, then start the session again.';

/** Antigravity's commands as the message box lists them (`available_commands_update`). */
export function agyCommands(update: unknown): SlashCommand[] {
  const list = (update as { availableCommands?: unknown } | null)?.availableCommands;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const command = (raw ?? {}) as { name?: unknown; description?: unknown; input?: { hint?: unknown } | null };
    if (typeof command.name !== 'string' || !command.name.trim()) return [];
    return [{ name: command.name.replace(/^\//, ''), description: typeof command.description === 'string' ? command.description : '', argumentHint: typeof command.input?.hint === 'string' ? command.input.hint : '' }];
  });
}

/** What a session can use (Tools): the MCP servers in Antigravity's config, and its commands and skills. */
export function agyCapabilities(geminiDir: string, commands: readonly SlashCommand[], live: boolean): Capabilities {
  return { live, mcp: agyMcpServers(geminiDir), agents: [], commands: [...commands], plugins: [], mcpToggle: false };
}
