import { connect, type Connection } from './lib/connection.ts';
import { consoleErrors, selectionIn } from './lib/page.ts';
import { badgeText, consoleItem, menuDefault, pageItems, screenshotImage, shortTitle, targetOptions, targetSummary, type PageInfo, type TargetOption } from './lib/payload.ts';
import { DIALOG_MESSAGE, showPageDialog, type DialogChoices, type DialogData, type DialogReply, type DialogRequest } from './lib/pageDialog.ts';

// The background script: the right-click menu, and the badge with the sessions waiting on you. It keeps one
// connection to Seshboard while the browser runs (an open native port also keeps Chrome's service worker alive).

const MENU = {
  sendSelection: 'seshboard-send-selection',
  sendPage: 'seshboard-send-page',
  start: 'seshboard-start',
} as const;

function createMenus(): void {
  void browser.contextMenus.removeAll().then(() => {
    // %s is the selected text, cut by the browser.
    browser.contextMenus.create({ id: MENU.sendSelection, title: 'Send “%s” to Seshboard', contexts: ['selection'] });
    browser.contextMenus.create({ id: MENU.sendPage, title: 'Send page to Seshboard', contexts: ['page'] });
    browser.contextMenus.create({ id: MENU.start, title: 'Start session from this page', contexts: ['selection', 'page'] });
  });
}
browser.runtime.onInstalled.addListener(createMenus);
browser.runtime.onStartup.addListener(createMenus);

let connection: Connection | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

/** The connection, opened again after the host went away (not connected yet in Seshboard, or a browser restart). */
function current(): Connection {
  if (connection && connection.state().kind !== 'no-host') return connection;
  connection?.close();
  const next = connect();
  connection = next;
  next.onState((state) => {
    if (state.kind === 'connected') void watch(next);
    else void setBadge('');
    if (state.kind === 'no-host') {
      clearTimeout(retry);
      // Settings › Browser extension may connect the browser later: look again now and then.
      retry = setTimeout(() => current(), 60_000);
    }
  });
  return next;
}

async function setBadge(text: string): Promise<void> {
  await browser.action.setBadgeText({ text }).catch(() => {});
  if (text) await browser.action.setBadgeBackgroundColor({ color: '#ed217c' }).catch(() => {});
}

/** Keeps the badge on the number of sessions waiting on you. */
async function watch(conn: Connection): Promise<void> {
  try {
    const first = await conn.client.call('sessions.list', { folders: [] });
    await setBadge(badgeText(first.sessions));
    conn.client.on('sessions.changed', (next) => void setBadge(badgeText(next.sessions)));
    await conn.client.call('sessions.watch', { folders: [] });
  } catch {
    // Seshboard went away again: the state change clears the badge.
  }
}

/** What a tab's panel sends, kept until it says where (one panel per tab). */
const waiting = new Map<number, { page: PageInfo; action: 'send' | 'start'; options: TargetOption[] }>();

/** Shows the panel in a tab: through `activeTab`, which the right-click gave for this tab. */
function show(tabId: number, data: DialogData): Promise<unknown> {
  // The polyfill's types take a function without arguments; the browser passes `args` to it.
  return browser.scripting.executeScript({ target: { tabId }, func: showPageDialog as unknown as () => void, args: [data] }).catch(() => setBadge('!'));
}

/** Reaches Seshboard and shows the panel for a page: ready to add, or what stands in the way. */
async function openDialog(tabId: number, page: PageInfo, action: 'send' | 'start'): Promise<void> {
  // Kept first, so Open Seshboard can bring the panel back for this page.
  waiting.set(tabId, { page, action, options: [] });
  const conn = current();
  const state = await conn.ready();
  if (state.kind === 'not-running') return void show(tabId, { kind: 'not-running', canLaunch: state.canLaunch });
  if (state.kind === 'no-host') return void show(tabId, { kind: 'no-host', detail: state.detail });
  if (state.kind !== 'connected') return void show(tabId, { kind: 'error', message: state.kind === 'incompatible' ? state.detail : 'Seshboard did not answer.' });
  try {
    const [list, found, errors] = await Promise.all([conn.client.call('sessions.list', { folders: [] }), conn.client.call('projects.list', { url: page.url }), consoleErrors(tabId)]);
    const options = targetOptions(list.sessions, list.focused, found.projects, found.matched);
    waiting.set(tabId, { page, action, options });
    const selection = page.selection.trim();
    // The popup's choices: the selection when there is one, the address without one (and to start a session).
    const choices: DialogChoices = { selection: selection ? true : null, page: !selection || action === 'start', screenshot: false, console: errors?.length ? { on: true, count: errors.length } : null };
    await show(tabId, { kind: 'ready', title: shortTitle(page.title, 120) || page.url, preview: selection, options, selected: menuDefault(action, options, list.focused, found.matched), choices });
  } catch (error) {
    await show(tabId, { kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !tab.url) return;
  const action = info.menuItemId === MENU.start ? 'start' : info.menuItemId === MENU.sendSelection || info.menuItemId === MENU.sendPage ? 'send' : null;
  if (!action) return;
  const tabId = tab.id;
  void (async () => {
    // The page's own selection keeps its line breaks; the menu's text is one line.
    const selection = info.menuItemId === MENU.sendPage ? '' : (await selectionIn(tabId)) || (info.selectionText ?? '');
    await openDialog(tabId, { url: tab.url!, title: tab.title ?? '', selection }, action);
  })();
});

browser.runtime.onMessage.addListener((message: unknown, sender: { tab?: { id?: number; windowId?: number } }) => {
  const request = message as DialogRequest | null;
  const tabId = sender.tab?.id;
  if (request?.type !== DIALOG_MESSAGE || tabId === undefined) return undefined;
  if (request.action === 'launch') {
    const conn = current();
    conn.launch();
    // Once Seshboard is up, the panel comes back ready, for the same page.
    void conn.ready(20_000).then((state) => {
      const pending = waiting.get(tabId);
      if (state.kind === 'connected' && pending) void openDialog(tabId, pending.page, pending.action);
    });
    return Promise.resolve({ ok: true, label: '' } satisfies DialogReply);
  }
  const pending = waiting.get(tabId);
  const option = pending?.options.find((o) => o.value === request.value);
  if (!pending || !option) return Promise.resolve({ ok: false, error: 'Right-click the page again.' } satisfies DialogReply);
  const { include } = request;
  const windowId = sender.tab?.windowId;
  return (async (): Promise<DialogReply> => {
    try {
      const items = pageItems(pending.page, { selection: include.selection, page: include.page });
      // The errors as they are now, not when the panel opened.
      const errors = include.console ? consoleItem((await consoleErrors(tabId)) ?? [], pending.page) : null;
      if (errors) items.push(errors);
      // The panel hid itself before asking, so the picture is the page alone.
      const shot = include.screenshot ? screenshotImage(await browser.tabs.captureVisibleTab(windowId as number, { format: 'jpeg', quality: 80 }), pending.page) : null;
      if (include.screenshot && !shot) return { ok: false, error: "This page can't be captured." };
      if (items.length === 0 && !shot) return { ok: false, error: 'Pick something to send.' };
      await current().client.call('context.add', { target: option.target, items, ...(shot ? { images: [shot] } : {}), reveal: true });
      waiting.delete(tabId);
      return { ok: true, label: targetSummary(option) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })();
});

current();
