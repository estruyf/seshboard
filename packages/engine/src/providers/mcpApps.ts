/**
 * MCP Apps (pages an MCP server draws for its tool calls, `ui://…`): what a page may do on its server. Pure, for the
 * providers that show them (Codex's) and their tests.
 */

/** What an app may do with one of its server's tools. */
export interface McpAppToolPolicy {
  /** The server lets apps call it: its `_meta.ui.visibility` has `app`, or says nothing (both by default). */
  callable: boolean;
  /** It says it changes nothing (`annotations.readOnlyHint`): it runs without asking you. */
  readOnly: boolean;
  /** Its name for people: `annotations.title` or `title`, else its name. */
  title: string;
}

/** A tool as the server lists it, or null when it isn't one of its tools. */
export function mcpAppToolPolicy(name: string, tool: unknown): McpAppToolPolicy | null {
  if (!tool || typeof tool !== 'object') return null;
  const t = tool as { title?: unknown; annotations?: { title?: unknown; readOnlyHint?: unknown } | null; _meta?: { ui?: { visibility?: unknown } | null } | null };
  const visibility = t._meta?.ui?.visibility;
  const callable = !Array.isArray(visibility) || visibility.includes('app');
  const title = [t.annotations?.title, t.title].find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? name;
  return { callable, readOnly: t.annotations?.readOnlyHint === true, title };
}
