import { z } from 'zod';
import { SlashCommand } from './host.ts';

export const McpServerInfo = z.object({
  name: z.string(),
  status: z.enum(['connected', 'failed', 'needs-auth', 'pending', 'disabled']),
  /** Where it's configured: user, project, local, plugin, claudeai, … */
  scope: z.string().nullable(),
  tools: z.array(z.string()),
  error: z.string().nullable(),
  version: z.string().nullable(),
});
export type McpServerInfo = z.infer<typeof McpServerInfo>;

export const AgentSummary = z.object({ name: z.string(), description: z.string(), model: z.string().nullable() });
export type AgentSummary = z.infer<typeof AgentSummary>;

export const PluginInfo = z.object({ name: z.string(), version: z.string().nullable(), scope: z.string().nullable(), path: z.string().nullable() });
export type PluginInfo = z.infer<typeof PluginInfo>;

/** A hook that runs at one of the agent's events (another provider's: Codex's), shown read-only in Tools. */
export const HookInfo = z.object({
  /** The event it runs at (`preToolUse`, `stop`, …). */
  event: z.string(),
  matcher: z.string().nullable(),
  /** What it runs: a command line, or an MCP tool (`server/tool`). */
  command: z.string(),
  /** Where it's configured: user, project, plugin, … */
  scope: z.string().nullable(),
  enabled: z.boolean(),
});
export type HookInfo = z.infer<typeof HookInfo>;

/** What Claude Code can use in a session (or a folder): MCP servers, agents, skills and commands, plugins. */
export const Capabilities = z.object({
  /** From the session running in this app (toggles apply to it), or a short-lived helper process (read-only). */
  live: z.boolean(),
  mcp: z.array(McpServerInfo),
  agents: z.array(AgentSummary),
  /** Skills and custom, project and plugin commands (Claude Code's built-ins are left out). */
  commands: z.array(SlashCommand),
  plugins: z.array(PluginInfo),
  /** Hooks, for a provider that lists them (Codex). */
  hooks: z.array(HookInfo).optional(),
});
export type Capabilities = z.infer<typeof Capabilities>;
