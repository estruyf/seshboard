import { CONSOLE_MESSAGE, type ConsoleEntry, type PageInfo } from './payload.ts';

/** The selected text in a tab, through `activeTab`; empty on pages an extension can't read (the browser's own). */
export async function selectionIn(tabId: number): Promise<string> {
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId }, func: () => globalThis.getSelection?.()?.toString() ?? '' });
    return typeof result?.result === 'string' ? result.result : '';
  } catch {
    return '';
  }
}

/** The tab on screen in this window, with its selection. */
export async function activePage(): Promise<(PageInfo & { tabId: number }) | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  return { tabId: tab.id, url: tab.url, title: tab.title ?? '', selection: await selectionIn(tab.id) };
}

/** The errors a local page's content script recorded; null on other pages, where it doesn't run. */
export async function consoleErrors(tabId: number): Promise<ConsoleEntry[] | null> {
  try {
    const entries = (await browser.tabs.sendMessage(tabId, { type: CONSOLE_MESSAGE })) as ConsoleEntry[] | undefined;
    return Array.isArray(entries) ? entries : null;
  } catch {
    return null;
  }
}
