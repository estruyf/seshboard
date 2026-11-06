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
  return { live: lists.live, mcp: lists.mcp.map(codexMcpServer), agents: [], commands: codexSkills(lists.skills), plugins: [], hooks: codexHooks(lists.hooks) };
}

/** Why a server can't be turned on or off here: Codex keeps that in its config, which Seshboard doesn't write. */
export const MCP_TOGGLE_REFUSED =
  "Codex turns an MCP server on or off in its config.toml (`enabled` under `[mcp_servers.<name>]`), not for one session, and Seshboard doesn't change Codex's config. Change it there, then Reconnect.";

/** Compact: Seshboard's Compact sends `/compact`, which Codex's driver runs as `thread/compact/start`. */
export const COMPACT_COMMAND: SlashCommand = { name: 'compact', description: 'Summarise the conversation so far, so each message carries less', argumentHint: '' };

/** Whether a message is `/compact` (nothing after it: Codex's compaction takes no instructions). */
export const isCompact = (text: string) => /^\/compact\s*$/i.test(text.trim());
