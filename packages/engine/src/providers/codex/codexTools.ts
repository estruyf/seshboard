import type { Capabilities, HookInfo, McpServerInfo, SlashCommand } from '@seshboard/protocol';
import type { HookMetadata, McpServerConnectionStatus, McpServerStatus, SkillMetadata } from './protocol.ts';

const STATUS: Record<McpServerConnectionStatus, McpServerInfo['status']> = {
  connected: 'connected',
  starting: 'pending',
  notStarted: 'pending',
  authenticationRequired: 'needs-auth',
  failed: 'failed',
  cancelled: 'failed',
  disabled: 'disabled',
};

/** One of Codex's MCP servers as Tools shows it. Without a thread (not running here) only a failed discovery says much. */
export function codexMcpServer(server: McpServerStatus): McpServerInfo {
  const status = server.runtimeStatus ? (STATUS[server.runtimeStatus] ?? 'pending') : server.toolsError ? 'failed' : 'pending';
  return {
    name: server.name,
    status,
    scope: server.pluginId ? 'plugin' : null,
    tools: Object.keys(server.tools ?? {}).sort(),
    error: server.toolsError ?? null,
    version: server.serverInfo?.version || null,
  };
}

/** Codex's skills for Tools, each once: its own (`system`) and turned-off ones left out, as Claude Code's built-ins are. */
export function codexSkills(skills: readonly SkillMetadata[]): SlashCommand[] {
  const seen = new Set<string>();
  const out: SlashCommand[] = [];
  for (const skill of skills) {
    if (skill.scope === 'system' || !skill.enabled || seen.has(skill.name)) continue;
    seen.add(skill.name);
    out.push({ name: skill.name, description: skill.shortDescription || skill.description || '', argumentHint: '' });
  }
  return out;
}

/** What a hook runs, in one line. */
const hookCommand = (hook: HookMetadata) =>
  hook.handlerType === 'command' ? (hook.command ?? '') : hook.handlerType === 'mcpTool' ? `${hook.server ?? '?'}/${hook.tool ?? '?'}` : hook.statusMessage || hook.handlerType;

export function codexHooks(hooks: readonly HookMetadata[]): HookInfo[] {
  return hooks.map((hook) => ({ event: hook.eventName, matcher: hook.matcher ?? null, command: hookCommand(hook), scope: hook.pluginId ? 'plugin' : hook.source || null, enabled: hook.enabled }));
}

/**
 * Codex's MCP servers, skills and hooks as Tools shows Claude Code's. `live`: from the session running here (its own
 * connections, which a reconnect reaches). Codex has no agents list to show, and its plugins come with their servers
 * and skills.
 */
export function codexCapabilities(lists: { live: boolean; mcp: readonly McpServerStatus[]; skills: readonly SkillMetadata[]; hooks: readonly HookMetadata[] }): Capabilities {
  return {
    live: lists.live,
    mcp: lists.mcp.map(codexMcpServer),
    agents: [],
    commands: codexSkills(lists.skills),
    plugins: [],
    hooks: codexHooks(lists.hooks),
    // No switch: Codex turns a server on or off only in its config, which Seshboard doesn't write. Reconnect reaches
    // every session's servers, which the note says.
    mcpToggle: false,
    reconnectNote: MCP_RECONNECT,
  };
}

/** Why a server can't be turned on or off here: Codex keeps that in its config, which Seshboard doesn't write. */
export const MCP_TOGGLE_REFUSED =
  "Codex turns an MCP server on or off in its config.toml (`enabled` under `[mcp_servers.<name>]`), not for one session, and Seshboard doesn't change Codex's config. Change it there, then Reconnect.";

/** Compact: Seshboard's Compact sends `/compact`, which Codex's driver runs as `thread/compact/start`. */
export const COMPACT_COMMAND: SlashCommand = { name: 'compact', description: 'Summarise the conversation so far, so each message carries less', argumentHint: '' };

/** Whether a message is `/compact` (nothing after it: Codex's compaction takes no instructions). */
export const isCompact = (text: string) => /^\/compact\s*$/i.test(text.trim());

/** `/compact` with words after it, which Codex's compaction can't take. */
export const isCompactWithMore = (text: string) => /^\/compact\s+\S/i.test(text.trim());

export const COMPACT_NO_INSTRUCTIONS = "Codex's compaction takes no instructions. Send /compact on its own.";

export const COMPACT_NOT_STEERED = 'Codex compacts between turns: send /compact when this turn ends, or add it to Up next.';

/** What Reconnect does for Codex, for the button's tooltip (the UI) and its refusals. */
export const MCP_RECONNECT = 'Reconnects the MCP servers of every Codex session running here';

export const MCP_RECONNECT_BUSY = `${MCP_RECONNECT}, and another of them is working now, so a tool call in its turn could fail. Try again when it's done.`;

export const MCP_RECONNECT_NOT_LOADED = "Codex isn't running this session right now. Its MCP servers start again with your next message.";

/**
 * The MCP servers in Codex's config (`config/read`), for a session not running here: listing them without a thread
 * starts every one of them (checked against codex-cli 0.167). A server turned off there shows as off; the others as not
 * started. Plugins' servers aren't in it. Only names and `enabled` are read: the rest (commands, env, headers) can
 * hold secrets.
 */
export function configuredMcp(config: { mcp_servers?: unknown } | null | undefined): McpServerStatus[] {
  const servers = config?.mcp_servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  return Object.entries(servers as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => ({ name, runtimeStatus: (entry as { enabled?: unknown } | null)?.enabled === false ? 'disabled' : null, pluginId: null, tools: {}, toolsError: null }));
}
