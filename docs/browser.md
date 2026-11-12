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
| A window reload kills every page; a session moved to a pop-out loads its page again. | None: accepted. | |
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

## Claude in the browser

A session's agent can drive its own Browser panel to check its work: open the dev server, read the page, type and click as a person would. Settings › General › Browser › **Let Claude use the browser** turns it on (with the browser on); sessions started or resumed after a change get it.

**The tools.** Each Claude Code process gets Seshboard's in-process `browser` MCP server (`packages/engine/src/browser/browserTools.ts`, made with the SDK's `createSdkMcpServer`): `open`, `snapshot`, `click`, `type`, `press`, `screenshot` and `console`, named `mcp__browser__<tool>`. A pre-warmed process gets them too and learns its session when one takes it over. A read-only pipeline step gets none.

**The path of a call.** The engine has no Electron, so a call goes engine → main (`browser-tool` on the parent port, `apps/desktop/src/engine/index.ts`) → `main/browserAgent.ts`. Main asks the window that shows the session (its pop-out, else the main window) which page to use (`BrowserAgentTargetRequest`, answered by `browserAgentTarget.ts` in the renderer). The agent works in a tab of its own in the session's panel, so your tabs keep their pages; `open` makes it (or loads the address in it) and shows the panel. Main checks the page is one of that window's browser pages, then:

- `snapshot` runs `SNAPSHOT_SCRIPT` in the page: headings, text, and each element you can act on with its role, name, state and a ref (`e12`). Refs live in a map on the page (`__seshboardRefs`), so the DOM never changes. Open shadow roots are read; frames are named, not read.
- `click` scrolls the element into view and sends a real mouse click at its middle (`sendInputEvent`, scaled by the page's zoom). `type` focuses the field, selects what it holds and inserts the text; `press` sends a key.
- `screenshot` is `capturePage`, at most 1280px wide, as JPEG. `console` lists the page's last 100 messages, errors first, collected from the moment the page exists.

Every result says where the page is after the call, and text from a page is marked as data, not instructions.

**Which sites.** Every call goes through the engine's permission check (the tools are not in `allowedTools`). A page on this computer (`localhost`, `*.localhost`, loopback) and a site the project allows (`ProjectDefaults.browserSites`, origins) run without asking; any other site shows the permission card, naming the site and saying Claude acts there with your login. **Always allow** adds the site to the project (the project's settings list them, under Browser sites). Sites match by origin (`siteAllowed` in `packages/protocol/src/browserSites.ts`), so allowing `contoso.sharepoint.com` never allows `contoso-admin.sharepoint.com`. A session outside an added project can only allow once.
