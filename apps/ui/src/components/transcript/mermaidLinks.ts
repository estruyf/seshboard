import { linkToOpen } from './visuals.ts';

/** What `Element` offers that a link lookup needs, so tests can use plain objects. */
export interface LinkLookup {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/**
 * The link a click or press landed on inside a diagram (`click A href "…"` makes the node a link), if any: `anchor` says it
 * landed on one, `url` is where it goes when that is an http or https address (a diagram's other links, `javascript:` ones
 * included, are not followed). Mermaid writes the address as `href` or `xlink:href`.
 */
export function diagramLink(target: LinkLookup | null): { anchor: boolean; url: string | null } {
  const anchor = target?.closest('a') ?? null;
  if (!anchor) return { anchor: false, url: null };
  return { anchor: true, url: linkToOpen(anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href')) };
}

/**
 * Follows a click on a link in a diagram: http and https open the way a link in the Markdown does (a new window, which main
 * hands to the browser), and the click does nothing else. True when the click was on a link, so the caller leaves it alone.
 * A link without `target="_blank"` would otherwise try to navigate the app's own window, which main stops.
 */
export function followDiagramLink(event: { target: EventTarget | null; preventDefault(): void }): boolean {
  const link = diagramLink(event.target as LinkLookup | null);
  if (!link.anchor) return false;
  event.preventDefault();
  if (link.url) window.open(link.url, '_blank', 'noopener,noreferrer');
  return true;
}
