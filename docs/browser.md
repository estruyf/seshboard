# The browser

How Seshboard shows web pages (the browser, and a session's web preview), why it uses Electron's `<webview>`, the workarounds that choice needs, and when to move to `WebContentsView` instead. Read it before you change the browser, and when a browser bug traces back to `<webview>` itself.

## Decision (2026-11-11): keep `<webview>`

Every browser tab is one `<webview>` element, kept at the end of the window's body and drawn in fixed position over its panel's slot (`apps/ui/src/components/webPreview/webPreviewPages.ts`). Main guards each page (`apps/desktop/src/main/webPreview.ts`, rules in `webPreviewRules.ts`).

We compared it with `WebContentsView`, a native view that main owns and places over the window, the API Electron recommends. We kept `<webview>` because:

- **Things over a page just work.** The command palette, menus, dialogs, toasts and tooltips are DOM and draw over a `<webview>`. A `WebContentsView` is drawn above all of the window's DOM, so each of those would need the page hidden (or swapped for a screenshot) while it is open.
- **Placement is free.** A `<webview>` follows its slot through layout in the same frame, CSS included (the phone width's rounded frame and shadow). A native view lags a frame during animations and loses CSS.
- **Smoke tests** query the page as a DOM element.

Forking Chromium or Firefox (as Helium and Zen do) was ruled out: a rebase every four weeks for security fixes, multi-hour builds, and main's Electron features rewritten in C++ or Firefox's UI.

## What `<webview>` costs us: the workarounds

Each of these exists only because of `<webview>`. If one breaks and can't be fixed in place, that is a reason to move (next section).

| Problem | Workaround | Where |
|---|---|---|
| A key typed in a page that opens the palette (⌘K) leaves the keyboard with the page: the page is a separate web contents inside ours, and the window's document moving its focus isn't a frame change Chromium acts on. | The window reports the focus move (`keysToWindow`); main sends that page's keys to the window (`sendInputEvent`, `keyForWindow`) until the page has the focus again (a click in it). Keys sent this way skip input methods (IME). | `WebPreviewHost.tsx`, `webPreview.ts`, `webPreviewRules.ts` |
| A page parked off screen is likely still "visible" to Chromium: its timers and animations keep running. | At most `LIVE_PAGES` (8) live pages; the rest are dropped and load again when shown. | `browserTabs.ts` (`livePages`) |
| A page's focus can't be read reliably: every page of a focused window reports `isFocused()`. | Read `focusedFrame` (null unless the page holds the keyboard), as T3 Code does; smoke steps skip focus checks while another app is in front. | `webPreviewSmoke.ts` |
| A click in a page gives the `<webview>` the focus but no mouse event, so the app's menus stay open. | The page's `focus` event dispatches `pointerdown` and `mousedown` on it. | `webPreviewPages.ts` |
| A window reload kills every page; a session moved to a pop-out, or its browser to a browser window, loads its pages again. | None: accepted. | |
| Electron's docs advise against `<webview>`, whose base in Chromium keeps changing. | Watch Electron's release notes for `<webview>` changes before each Electron upgrade. | |

## When to move to `WebContentsView`

Recommend the move when any of these happens:

- **Electron deprecates or breaks `<webview>`** (release notes, a regression no workaround fixes).
- **Keyboard or focus bugs keep coming back** in ways the key routing can't cover: input methods (IME) in pages after a forwarded shortcut, accessibility tools, a platform where `sendInputEvent` behaves differently.
- **Background pages cost too much:** CPU or battery from hidden pages that a lower `LIVE_PAGES` doesn't fix (a `WebContentsView` hidden with `setVisible(false)` is slowed by Chromium).
- **Pages must survive a window reload or move to a pop-out without loading again.**
- **The browser becomes the main surface** (tabs and spaces first, sessions beside them), where the native view's focus and lifecycle matter more than drawing over pages.

Don't move for a single overlay or styling problem: those are cheaper to solve in the DOM.

## How others do it

| App | Pages | Things over a page | Focus | Look at |
|---|---|---|---|---|
| T3 Code | `<webview>`, as we do | DOM, as ours | Main calls `host.focus()` before a forwarded shortcut that moves focus; `focusedFrame` says who holds the keyboard | `pingdotgg/t3code`: `apps/desktop/src/preview/Manager.ts` (`beforeInput`), `GuestInput.ts`, `apps/web/src/browser/HostedBrowserWebview.tsx` |
| Claude desktop | `WebContentsView` for everything (`webviewTag: false`, every `will-attach-webview` refused) | Their own small `WebContentsView`s stacked on top (find in page is one) | Native, `focusedFrame` checks | closed source |
| VS Code (integrated browser) | `WebContentsView`, one per tab, owned by main | An overlay manager finds menus, Quick Input, hovers, dialogs and notifications over the page (by class and hit test); the real view hides and a screenshot shows in its place, dimmed with "Paused" for notifications | A container element takes DOM focus and hands it to the native view | `microsoft/vscode`: `src/vs/platform/browserView/electron-main/browserView.ts`, `src/vs/workbench/contrib/browserView/electron-browser/webContentsViewHost.ts`, `overlayManager.ts` |

VS Code's approach is the guide for a move: a page manager in main, a placeholder slot that reports its bounds, an overlay manager that knows the app's overlays (`[role=dialog]`, `[role=menu]`, `[role=listbox]`, the palette, toasts, tooltips), and a screenshot (`capturePage`) shown while one overlaps the page.

## What a move would touch

- Becomes a page manager in main: `webPreviewPages.ts`, the page half of `WebPreviewHost.tsx`, and `webPreview.ts`'s guest guards (they apply to the views main creates instead of attached webviews).
- New: bounds reporting from each slot, an overlay detector over the app's overlay roles, the screenshot placeholder, focus hand-off.
- Goes: the key routing (`keysToWindow`, `keyForWindow`), the `focus` → `pointerdown` relay, parking off screen, `webviewTag` and `will-attach-webview`.
- Stays: the tabs and their store (`browserTabs.ts`, `webPreviewStore.ts`), pins, favourites, the palette commands, `browserActions.ts`, the sidebar.
- Smoke steps query main for views instead of `[data-web-preview-page]` elements.

Start with a spike behind a setting, in the Browser view only, and check three things: typing after ⌘K reaches the palette without key routing, the palette and menus look right over a page with the screenshot swap, and the page keeps up while the sidebar folds.

## Agents in the browser

A session's agent can drive its own Browser panel to check its work: open the dev server, read the page, type and click as a person would. It works for every agent Seshboard runs: Claude Code, Copilot and Codex. Settings › Browser › **Allow Seshboard to control the browser** turns it on (with the browser on); sessions started or resumed after a change get it.

**The server.** Each agent process starts Seshboard's `browser` MCP server over stdio (`apps/desktop/src/browserMcp/`), as Seshboard's own binary run as Node, like `visualize`. Its tools are `open`, `snapshot`, `read`, `click`, `type`, `press`, `screenshot` and `console`, plus `evaluate` and `network` with Settings › Browser › **Allow scripts in pages** on (`BROWSER_TOOL_SPECS` in `packages/protocol/src/browserSites.ts`; main starts the server with `SESHBOARD_BROWSER_SCRIPTS=1` then, and it lists them, `browserToolsFor`). The server's instructions (`browserInstructions`) say to use `read` rather than `snapshot` for a page's full text, and that `evaluate` and `network` may ask the person first. It holds no state: each call goes to the engine's bridge over a local socket (a named pipe on Windows), with a token for its session in its environment (`SESHBOARD_BROWSER_SOCKET`, `SESHBOARD_BROWSER_TOKEN`). The bridge (`packages/engine/src/browser/browserBridge.ts`) reads the token's session when a call comes, so a fork or a pre-warmed process taken over by a session works. A read-only pipeline step gets no server.

**Which sites.** The bridge checks every call, whatever the agent (`browserAccess`, a pure function in `browserSites.ts`). A page on this computer (`localhost`, `*.localhost`, loopback) and a site the project allows (`ProjectDefaults.browserSites`, origins) run at once. Any other site shows the session's permission card, naming the site and saying the agent acts there with your login (`askBrowser`, in `HostManager` for Claude Code and `ProviderHosts` for the others, worded by `browserPromptText`); the session shows as needing you meanwhile. The card has three choices: **Allow** (this call), **Allow for this session** and **Always allow**. Allow for this session is kept by the bridge in memory per session (`sessionAllowed`), so an engine restart forgets it. **Always allow** adds the site to the project (`keep`), whose settings list them under Browser sites; a session outside an added project gets no Always allow. Sites match by origin (`siteAllowed`), so allowing `app.example.com` never allows `admin.example.com`.

**The script guard.** `evaluate` and `network` reach more than the page shows: tokens in its globals, private responses, and the power to change data with the person's login. So:

- Settings › Browser › **Allow scripts in pages** (`Preferences.browserScripts`) is off by default. Like Allow Seshboard to control the browser, it reaches sessions started or resumed after the change: their server lists the two tools. Turning it off counts at once: the bridge (from the server main last sent, `scripts`) and main (`deps.scripts`) refuse both with a message that says where to turn it on (`SCRIPTS_OFF_TEXT`).
- A page on this computer runs them at once. Any other site asks on a card of its own, apart from the site card: "Claude Code wants to run scripts on contoso.sharepoint.com as you", naming the browser profile when it isn't Default (`browserScriptsDescription`). Allowing the site doesn't allow scripts there; allowing scripts covers using the site for those two tools.
- **Always allow** keeps the origin in `ProjectDefaults.browserScriptSites` (like `browserSites`, not in `ProfileDefaults`), listed and removable in the project's settings under **Scripts in pages** (shown with the setting on, or while the list has sites). Allow for this session works as on the site card.
- A read-only pipeline step gets no browser server at all, so neither tool. Claude Code gets the tools in `allowedTools`, and Copilot approves Seshboard's own servers, so the agent's own prompt never asks a second time.

**The path of a call.** Bridge → main (`browser-tool` on the parent port, `apps/desktop/src/engine/index.ts`) → `main/browserAgent.ts`. Main asks the window that shows the session's browser (its browser window, else its pop-out, else the main window) which page to use (`BrowserAgentTargetRequest`, answered by `browserAgentTarget.ts` in the renderer). The agent works in a tab of its own in the session's panel, so your tabs keep their pages; `open` makes it (or loads the address in it) and shows the panel. Main checks the page is one of that window's browser pages, then:

- `snapshot` runs `SNAPSHOT_SCRIPT` in the page: headings, text, and each element you can act on with its role, name, state and a ref (`e12`). Refs live in a map on the page (`__seshboardRefs`), so the DOM never changes. Open shadow roots are read; frames are named, not read.
- `click` scrolls the element into view and sends a real mouse click at its middle (`sendInputEvent`, scaled by the page's zoom). `type` focuses the field, selects what it holds and inserts the text; `press` sends a key.
- `screenshot` is `capturePage`, at most 1280px wide, as JPEG. `console` lists the page's last 100 messages, errors first, collected from the moment the page exists.
- `read` (`READ_SCRIPT`) returns the page's own text, not the snapshot's outline: `document.body.innerText` for a web page, the source for XML (the original nodes under Chromium's tree viewer, `#webkit-xml-viewer-source-xml`; Atom, which SharePoint's REST API sends, shows as text and is named XML too), and the `<pre>` Chromium wraps JSON and text in. Nothing is squashed. Long text comes in parts of 20,000 characters (`PAGE_CHARS`, `pagedText`): the result gives the total and the next `offset`.
- `evaluate` runs the agent's script in the page's main world (`executeJavaScript`), so page globals such as `_spPageContextInfo` and `fetch` with the person's login work. Main parses it first (`evaluateSource`, `node:vm`, never run there): an expression is returned, statements return with `return`; both can `await`. The page describes the value itself (`evaluateScript`): a string as it is, anything else as JSON (Map, Set, BigInt and cycles handled), a function or symbol as unserialisable text, a thrown error as its message, and undefined says so. It answers after 30 seconds anyway (`EVALUATE_MS`), and keeps at most 5,000,000 characters. The last result is kept per page, so `evaluate` with the same script and an `offset` reads on without running it again.
- `network` attaches `webContents.debugger` (Chrome DevTools Protocol, `Network.enable` with buffers for bodies) on its first call on a page, so it lists from then on: the result says to load the page again. It keeps the last 300 requests per page (`NetworkLog` in `main/browserNetwork.ts`): id (`r12`), method, status, type, MIME type, size and address, never request headers or cookies. With `id` it returns that response's body (`Network.getResponseBody`), paged like `read`; a binary body is described, not sent. When attaching fails (another debugger on the page), or the debugger is detached later, it says so and tries again on the next call. The list goes with the page.

Every result says where the page is after the call, and text from a page is marked as data, not instructions.

`open` takes an optional `profile`: the name of a browser profile (next section), matched without case among the session's project's and the ones for everywhere ("Default" or none is the built-in one). The bridge finds it (`BrowserBridgeDeps.profile`, an unknown name fails with the names there are) and hands main its id, so the agent can't name a partition itself. The agent has a tab of its own per profile, so it can drive two accounts at once; the other tools work on the tab it opened last. The site permission card names the profile when it isn't Default (`browserSiteDescription`).

## A session's browser in its own window

A session's Browser panel can move to a window of its own (a browser window, `?browserpopout=<id>`), to put on another display while the session stays where it is: **Open in new window** in the panel's toolbar (in ⋯ when the toolbar is narrow) and **Open browser in new window** in the palette.

- **Tabs move, pages load again.** Every tab goes, with its pin, name, browser profile, zoom, phone width and place, and the one in front (`browserHandoff.ts`, pure). The session's window drops them (`takeOut`), main keeps the last list the browser window reported (`browserPopoutTabs`, in memory) and hands it back when the window goes (`browserReturned`): Move back opens the panel on them, the close button only puts them back, the last tab closing puts back none. Like pop-outs, browser windows close with the main window and don't come back after a restart.
- **While it is out.** Every window knows which sessions' browsers are out and how many tabs each has (`useBrowserPopouts`, `onBrowserPopoutsChanged`): the rail's Browser button keeps its count and brings the window to the front, and so do ⌘⇧B, the palette's Open browser and links in the conversation (`open` and `toggleWebPanel` call `popOutBrowser`, with the address). Quote in message and Add element to message go to the session's window through main (`browserToMessage`).
- **Pinned tabs** are saved by the browser window while they are there (`useBrowserTabsSync` with `browserPopoutSession`, no restore); the main window doesn't take their leaving for a close (`browserElsewhere`).
- **Agents** work in the browser window: main's `windowFor` asks it first.

## Browser profiles

A browser profile is a separate store for pages: cookies, local storage, IndexedDB, service workers, the caches and its own history, so one web app can be used under several accounts side by side. In code, Settings and docs they are always *browser profiles*: *Profiles* (Settings › Profiles) are Claude's logins. Inside the browser's own menus, "profile" alone is fine.

- **Partitions.** Each profile is one Electron partition, `persist:browser-<uuid>` (`browserProfilePartition` in `packages/protocol/src/webPreview.ts`). The built-in **Default** profile has no row and keeps `WEB_PREVIEW_PARTITION`, so logins from before profiles stay. Main accepts exactly those two shapes (`isBrowserPartition`, used by `webviewAllowed`), so it never needs the database, and guards a profile's session (permissions, downloads, certificates: `guardPartition` in `main/webPreview.ts`) the first time one of its pages attaches. `browserAgent.ts` accepts a page in any guarded session (`isBrowserSession`), and the favicon fetch uses the page's own session.
- **Rows.** The engine keeps them in `browser_profiles` (migration v63, kept on a rebuild): name, colour (the Claude profile palette), project root or null for everywhere, position. `browser_tabs.profile_id` keeps a pinned tab's profile (null: Default), and `browser_history` is keyed by (`url`, `profile_id`), with `''` for Default. Requests: `browser.profiles.list/create/update/delete/reset`, and every window hears `browser.profiles.changed`. Names are unique wherever two profiles would both be offered, without case, and "Default" is taken (`browserProfileNameClash`).
- **Tabs.** A tab keeps its profile for life (`BrowserTab.profileId`); its `<webview>` gets the partition when it is made. A tab in a profile shows its colour (`ProfileMark`). The ⌄ next to the new tab button (and a right click on it) opens a tab in a profile; a tab's menu has **Open in other profile** (the same address in a new tab) and **Reset profile…**. The toolbar's switcher (`ProfileSwitch`, right after the address bar, `data-browser-profile-switch`) shows the tab's profile as its dot and name (a person icon for Default; the dot only in a narrow toolbar), and its menu moves the tab to another profile: as a tab keeps its profile, `switchTabProfile` puts a new tab with the same address, name, place, pin and zoom in its place and drops the old one. Its menu also has Reset profile…, and Browser profiles… (New browser profile… while there are none). A session offers its project's profiles and the ones for everywhere; the Browser view offers all of them.
- **Reset and Delete.** Reset asks what to forget (logins and cookies, site data, cache, history), all ticked. The window first holds the profile's pages off (`useWebPreview.suspend`, so none writes back), main clears the partition (`resetBrowserPartition`, `partitionClearing`), the engine forgets the history, and the pages load again. Delete closes the profile's tabs, clears everything and removes its row, pinned tabs and history. The empty partition folder stays on disk: deleting is only ever to the Trash, for session files (`trashGuard.ts`).
- **Clear data.** Clear data for this site… works in the tab's profile; Clear all browsing data… clears every profile.
