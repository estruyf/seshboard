/**
 * Claude's browser tools (docs/browser.md, Claude in the browser): what a session's agent may do in its Browser panel,
 * and on which sites it may do it without asking. Plain TypeScript, shared by the engine (the tools and their
 * permission), main (the pages) and the UI (a project's allowed sites).
 */

/** The tools, as Claude Code names them: `mcp__browser__<tool>`. */
export const BROWSER_TOOLS = ['open', 'snapshot', 'click', 'type', 'press', 'screenshot', 'console'] as const;
export type BrowserTool = (typeof BROWSER_TOOLS)[number];
export const BROWSER_SERVER = 'browser';
export const BROWSER_TOOL_PREFIX = `mcp__${BROWSER_SERVER}__`;

/** The browser tool a Claude Code tool name stands for, or null for any other tool. */
export function browserToolOf(toolName: string): BrowserTool | null {
  if (!toolName.startsWith(BROWSER_TOOL_PREFIX)) return null;
  const tool = toolName.slice(BROWSER_TOOL_PREFIX.length);
  return (BROWSER_TOOLS as readonly string[]).includes(tool) ? (tool as BrowserTool) : null;
}

/**
 * One call from the engine to main, which drives the session's page. `where` only asks for the address of the page the
 * session's tools work on (for the permission check), and opens nothing.
 */
export interface BrowserToolRequest {
  sessionId: string;
  tool: BrowserTool | 'where';
  args: Record<string, unknown>;
}

/** What main answers: text for Claude, a picture for `screenshot`, and the page's address after the call. */
export interface BrowserToolResult {
  text: string;
  image?: { data: string; mimeType: string } | null;
  url?: string | null;
  /** The call failed (no page, an element that isn't there): Claude reads `text` as the reason. */
  error?: boolean;
}

/** The most sites a project keeps. */
export const MAX_BROWSER_SITES = 50;

/** A web address's site, as the browser tools match it: its origin (`https://contoso.sharepoint.com`), or null. */
export function siteOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** A site written by hand ("contoso.sharepoint.com", or a whole address) as an origin; https when no scheme is given. */
export function normaliseSite(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  return siteOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
}

/** The host a site's label names: "contoso.sharepoint.com", "localhost:4321". */
export const siteLabel = (site: string): string => {
  try {
    return new URL(site).host;
  } catch {
    return site;
  }
};

/** This computer: `localhost`, a `.localhost` name and loopback addresses, on any port. */
export function isLocalSite(url: string): boolean {
  const site = siteOf(url);
  if (!site) return false;
  const host = new URL(site).hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * Whether the tools may work on `url` without asking: a page on this computer, or a site the project allows. Sites
 * match by origin, so allowing `contoso.sharepoint.com` never allows `contoso-admin.sharepoint.com`.
 */
export function siteAllowed(url: string, allowed: readonly string[]): boolean {
  if (isLocalSite(url)) return true;
  const site = siteOf(url);
  return site !== null && allowed.some((entry) => normaliseSite(entry) === site);
}

/** A project's sites with one more, once, in the order added (oldest dropped past the limit). */
export function withSite(sites: readonly string[], site: string): string[] {
  const origin = normaliseSite(site);
  if (!origin) return [...sites];
  return [...sites.filter((s) => normaliseSite(s) !== origin), origin].slice(-MAX_BROWSER_SITES);
}
