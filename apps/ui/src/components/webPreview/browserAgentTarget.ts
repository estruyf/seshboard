import type { BrowserAgentTarget, BrowserAgentTargetRequest } from '@seshboard/protocol/bridge';
import { previewAllowed, useWebPreview } from '../../state/webPreviewStore.ts';
import { frontTab } from './browserTabs.ts';
import { previewPage } from './webPreviewPages.ts';

/*
 * The browser tools, this window's side (docs/browser.md): main asks which page a session's tools work on, and to
 * open an address there. The agent works in a tab of its own in the session's Browser panel, so your own tabs (a pinned
 * pull request) keep their pages; it uses the tab in front when it has none yet and isn't opening anything. It has one
 * tab per browser profile it opened something in (another account), and the other tools work on the one it used last.
 */

/** The tab each session's agent opened, by session and browser profile (`agentKey`). */
const agentTabs = new Map<string, string>();
/** The agent tab each session's tools work on now: the one it opened last. */
const currentTabs = new Map<string, string>();
const agentKey = (sessionId: string, profileId: string | null) => `${sessionId}\0${profileId ?? ''}`;

/** How long a new tab's page may take to attach. */
const ATTACH_MS = 5_000;

const tabExists = (id: string | undefined) => (id ? useWebPreview.getState().tabs.some((t) => t.id === id) : false);

async function contentsOf(tabId: string): Promise<number | null> {
  const until = Date.now() + ATTACH_MS;
  for (;;) {
    const id = previewPage(tabId)?.contentsId() ?? null;
    if (id !== null || Date.now() > until) return id;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Answers one of main's questions (see `BrowserAgentTargetRequest`). */
export async function browserAgentTarget(request: BrowserAgentTargetRequest): Promise<BrowserAgentTarget> {
  const store = useWebPreview.getState();
  const { sessionId } = request;
  if (request.open) {
    if (!previewAllowed()) return { contentsId: null, url: null, error: 'The browser is off in Seshboard (Settings › General).' };
    const profileId = request.profileId ?? null;
    const key = agentKey(sessionId, profileId);
    const own = agentTabs.get(key);
    if (tabExists(own)) store.navigate(own!, request.open);
    else agentTabs.set(key, store.openTab(sessionId, request.open, { profileId }));
    currentTabs.set(sessionId, agentTabs.get(key)!);
    // The panel shows the agent's tab in front, so you can watch it.
    useWebPreview.getState().open(sessionId);
  }
  const own = currentTabs.get(sessionId);
  const tab = tabExists(own) ? useWebPreview.getState().tabs.find((t) => t.id === own) : frontTab(useWebPreview.getState(), sessionId);
  if (!tab) return { contentsId: null, url: null };
  let contentsId = previewPage(tab.id)?.contentsId() ?? null;
  // A page dropped to save memory (`livePages`) comes back when its tab is shown.
  if (contentsId === null && request.ensure) {
    useWebPreview.getState().selectTab(tab.id);
    useWebPreview.getState().open(sessionId);
    contentsId = await contentsOf(tab.id);
  } else if (contentsId === null && request.open) contentsId = await contentsOf(tab.id);
  return { contentsId, url: tab.url, profileId: tab.profileId };
}

/** Listens for main's questions in this window. Returns the way to stop. */
export const listenForBrowserAgent = (): (() => void) | undefined => window.seshboard?.onBrowserAgentTarget(browserAgentTarget);
