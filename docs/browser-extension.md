# Browser extension

The browser extension (`apps/browser-extension`) sends what you look at in Chrome, Edge, Brave or Firefox to a Seshboard session: the text you select, with the page it came from, or the page itself. It arrives as chips in the session's message box (the context tray), as the [VS Code companion](vscode-companion.md)'s context does. Nothing goes to Claude until you press send in Seshboard.

[← Back to the README](../README.md)

## The connection

A browser extension can't open the engine's Unix socket, and a port on `localhost` would be open to every page. So the extension talks to a **native messaging host**: a small program the browser starts for it, and only for it, over stdin and stdout.

1. **Settings › Browser extension › Connect browsers** (`browserExtensionHost` in the bridge, `main/browserExtensionHost.ts`) writes the host to `<app data>/browser-extension/`:
   - `host.mjs`: the host (`src/browserHost/`, built as `out/main/browser-host.js`). It imports nothing but Node, so the copy runs on its own, also after an AppImage's mount is gone.
   - `host.json`: the `engine.json` files to try (this app's first, then the installed app and a dev build) and how to open Seshboard (`open` on the bundle, or the binary; none for a dev build).
   - `seshboard-host.sh` (`.bat` on Windows): runs `host.mjs` with Seshboard's own binary as Node (`ELECTRON_RUN_AS_NODE`).
   - `chromium.json` and `firefox.json`: the manifests, named `app.seshboard.companion`, which let in only the extension's ids (`BROWSER_EXTENSION_IDS` in `companionConstants.ts`).
2. Each browser found on the computer gets the manifest in its own folder (`~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, `~/.mozilla/native-messaging-hosts` and the others in `browserTargets`). On Windows a key under `HKCU\Software\…\NativeMessagingHosts` points at it instead. Once installed, the files are written again at each start, since the app may have moved.
3. The extension calls `runtime.connectNative('app.seshboard.companion')`. The host reads `engine.json`, connects to the socket and says `hello` with the token and `client.name: 'browser'`. The token never reaches the browser.
4. Then it passes companion messages both ways, each in a native messaging frame: `{ type: 'wire', message }`. It reports its own state as `{ type: 'status', state }` (`connecting`, `connected`, `not-running`, `incompatible`), and takes `{ type: 'launch' }` to open Seshboard. While Seshboard isn't running it answers requests with `NOT_RUNNING` and looks again every 2 seconds.

Chrome drops a host that sends a message over 1 MB, so the host never does: a response that large becomes a `TOO_LARGE` error.

**Disconnect** removes the manifests that point at this app's host, the registry keys on Windows, and the folder.

## Messages

The extension uses the companion contract (`packages/protocol/src/companion.ts`), through `@seshboard/protocol/companion-client`:

| Request | What the extension uses it for |
|---|---|
| `sessions.list` / `sessions.watch` with no folders | Every session the sidebar lists: the badge (sessions waiting for you), the popup's list, and the session on screen in Seshboard (`focused`). |
| `projects.list { url }` | The projects, most recently active first, and `matched`: the project whose GitHub remote that page is on (`github.com/owner/name/…`, through `findCheckout`). |
| `context.add` | The selection and the page as `text` items with `source: 'page'`, console errors with `source: 'console'`, and a screenshot in `images` (added to the message box as Attach images adds them), to a session or to New session on a project. |
| `session.reveal` | A click on a waiting session in the popup. |

`companion.status` counts browsers (`browsers`) apart from editor windows (`clients`), by the name each client said in `hello`.

## The extension

Built with [Extension.js](https://extension.js.org/), React and Tailwind, from one source for Chromium (Manifest V3, a service worker) and Firefox (Manifest V3, a background script). Pure logic (the items, the targets, the badge) is in `src/lib/payload.ts`, with tests next to it.

- **Right-click › Send “…” to Seshboard** (on a selection), **Send page to Seshboard** and **Start session from this page** show a panel on the page (`lib/pageDialog.ts`): what goes, and a search over where it goes, starting on the session on screen in Seshboard (Send) or New session in the page's project. Enter or **Add to Seshboard** adds it, Esc closes it. When Seshboard isn't running or the browser isn't connected, the panel says so (with **Open Seshboard** when it can).
- The panel is injected with `scripting.executeScript({ func, args })` through the `activeTab` the right-click gives, so it needs no access to other sites. The function is copied into the page on its own: it uses nothing from outside its body, draws in a shadow root, and asks the background script with `runtime.sendMessage` (`DIALOG_MESSAGE`). Extension.js bundles a file injected with `files` as a classic script without calling it, so the panel is not one.
- **The popup** lists the sessions waiting for you, then what to send (Selection, Page address, Screenshot, Console errors) and where: a picker with a search field over the sessions, then New session in each project, the page's own first.
- **Screenshot**: `tabs.captureVisibleTab` as a JPEG when you tick it (through `activeTab`), sent in `images`.
- **Console errors**: on `localhost` and `127.0.0.1` only, two content scripts run from the start of the page. `content/console-main.ts` runs in the page's own world and records `console.error`, uncaught errors, unhandled rejections and failed `fetch` calls. `content/console-bridge.ts`, in the extension's world, keeps the last 50 and gives them to the popup. The browser's own network errors (`net::ERR_…`) are not seen: only the debugger API reaches those.

It asks for `nativeMessaging`, `contextMenus`, `activeTab` (the tab you invoked it on: its selection and screenshot) and `scripting` (to read that selection and show the panel). Its content scripts run on local pages only; it reads no other page you didn't invoke it on.

## Developing the extension

```bash
npm run dev -w @seshboard/browser-extension          # Chrome, with a profile of its own
npm run dev:firefox -w @seshboard/browser-extension  # Firefox
npm run build -w @seshboard/browser-extension        # dist/chrome and dist/firefox
```

First press **Connect browsers** in Settings › Browser extension of the Seshboard you run (`npm run dev` writes to `Seshboard Dev`). Chrome reads a user's native messaging hosts from its profile folder, and Extension.js runs Chrome with a profile of its own, so `npm run dev` copies the manifest there first (`scripts/dev-host.mjs`). Firefox reads one folder for every profile.

The Chromium id comes from the `key` in `src/manifest.json`, so a build loaded unpacked keeps it. The store gives the published extension an id of its own: add it to `BROWSER_EXTENSION_IDS.chromium` before the first store release, and leave `key` out of the store's build.
