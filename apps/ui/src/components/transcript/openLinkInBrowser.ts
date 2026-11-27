import type { MouseEvent as ReactMouseEvent } from 'react';
import { webPageUrl } from '@seshboard/protocol/client';
import { modKey } from '../../lib/shortcuts.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';

/**
 * A web link in a reply, with the browser on: it opens in the session's browser (a tab already on that address comes to
 * the front). ⌘-click (Ctrl-click) leaves it to the system browser. File links keep their own setting. `owner` is the
 * session's id, or a remote session's row id (`remote:<computer>:<session>`), whose browser is on this computer. True when
 * it opened there.
 */
export function openLinkInBrowser(event: ReactMouseEvent<HTMLElement>, owner: string): boolean {
  if (event.defaultPrevented || event.button !== 0 || modKey(event) || event.shiftKey || event.altKey) return false;
  const link = (event.target as HTMLElement).closest('a[href]');
  const url = link ? webPageUrl(link.getAttribute('href') ?? '') : null;
  if (!url) return false;
  event.preventDefault();
  useWebPreview.getState().open(owner, url);
  return true;
}
