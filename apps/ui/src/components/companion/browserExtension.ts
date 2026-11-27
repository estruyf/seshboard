import type { BrowserExtensionHostStatus } from '@seshboard/protocol/bridge';

/** The line in Settings › Browser extension: connected browsers first, then what is left to do. */
export function browserExtensionLabel(host: BrowserExtensionHostStatus, connected: number): string {
  if (connected > 0) return `Connected to ${connected} ${connected === 1 ? 'browser' : 'browsers'}`;
  if (host.installed) return 'Seshboard waits for the extension. Install it, then open a page.';
  if (host.browsers.length === 0) return 'No supported browser found on this computer.';
  return 'Connect your browsers so the extension can reach Seshboard.';
}
