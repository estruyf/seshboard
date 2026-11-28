# Canvases (plan)

Status: phases 1 to 5 are built (2026-11-28, #382). What is left is under Later.

A canvas is a web app from a project that Seshboard shows in a session's rail panel. The canvas does the work you see (a content dashboard, an editor, a media library), and the session beside it helps: the agent reads what you have open, runs the canvas's actions and edits the same files. Every agent Seshboard runs (Claude Code, Copilot, Codex) gets the same canvas.

**Decision: Seshboard has its own canvas format and SDK** (`@seshboard/canvas`). It learns from GitHub Copilot's canvas extensions but takes nothing from them: no `@github/copilot-sdk`, no `.github/extensions`, no Copilot names. Seshboard decides when the API changes.

## What we learn from Copilot

Copilot's canvases (in the SDK the Copilot app ships, `copilot-sdk/canvas.d.ts`, and the docs: [GitHub](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions), [VS Code](https://code.visualstudio.com/docs/agents/run/canvases), [a worked example](https://montemagno.com/building-a-blog-post-workbench-canvas-with-copilot/)):

| Copilot | What Seshboard does |
|---|---|
| A folder per extension in the repo (`.github/extensions/<name>/extension.mjs`), so it follows the branch | The same idea in our own folder: `.seshboard/canvases/<name>/canvas.mjs` |
| The host starts the extension as a Node child process and hands it the SDK, so there is nothing to install | The same: the engine starts it with Electron as Node and resolves `@seshboard/canvas` itself |
| JSON-RPC over stdio, so `console.log` breaks the connection | Node's IPC channel (`fork`) instead: stdout and stderr go to the canvas's log, and `console.log` is fine |
| `open` starts a local web server and returns its URL. The host shows the URL in a panel | The same |
| Actions with a name, a description and a JSON Schema, which the agent calls through three tools | The same shape, through Seshboard's `canvas` MCP server, for every agent |
| The page has no bridge to the host. The extension's Node side puts chips in the message box or sends a prompt | The same split. The Node side can fill the message box but never sends |
| Marked experimental, may change without notice | An `api` version in every canvas. Seshboard keeps old versions working |

## The SDK

`@seshboard/canvas`, a new workspace (`packages/canvas/`). The engine resolves the import for the canvas process, so a canvas has no `package.json` for it. The types are published to npm for editors.

```js
// .seshboard/canvases/frontmatter/canvas.mjs
import { canvas, serve } from '@seshboard/canvas';

serve(canvas({
  api: 1,
  name: 'Front Matter',
  description: 'The posts, media and front matter of this site',
  async open(ctx) {
    // ctx: { instance, folder, input, host }
    const url = await startServer(ctx.folder);
    return { url, title: 'Front Matter' };
  },
  async close(ctx) { await stopServer(ctx.instance); },
  actions: {
    list_content: {
      description: 'List the posts, newest first',
      input: { type: 'object', properties: { drafts: { type: 'boolean' } } },
      run: async (input, ctx) => listContent(ctx.folder, input),
    },
  },
}));
```

A canvas's id is its folder's name (lowercase letters, digits and dashes), so two canvases of a project can't share one. Started by hand (`node canvas.mjs`, with the import resolved some other way) `serve` opens one instance in the current folder and prints the page's address.

What the canvas can call back (`ctx.host` in a handler, `host` from `serve`):

| Call | What it does |
|---|---|
| `host.log(message, level)` | A line in the canvas's log. Built |
| `host.compose({ text, chips })` | Fills the message box of the session that shows the canvas. A chip is a file and lines, or a title with data. It never sends |
| `host.context()` | The session beside it, its folder and branch, light or dark |
| `host.onContext(fn)` | Called when that changes |

## How Seshboard runs a canvas

1. **Discovery.** `.seshboard/canvases/*/canvas.mjs` in the nearest folder up from the session's (`canvasFolder`), so a worktree uses its own. Seshboard reads the folder names and hashes the files, but runs nothing to list them. A canvas shows under its folder's name until it runs. User-wide canvases (`~/.seshboard/canvases/`) come later.
2. **Trust.** The first time, the panel shows the canvas's folder and asks. A changed `canvas.mjs` asks again (its hash). The answer is kept per project in `trusted_commands`, next to the shared actions' (`canvasTrustKey`), so a worktree of a trusted project doesn't ask again.
3. **Start.** The engine forks `canvas.mjs` with Electron as Node (`ELECTRON_RUN_AS_NODE`, as the `browser` server runs) in the session's folder, with the IPC channel. One process per canvas and folder: sessions in the same folder share it, and a worktree gets its own. `serve` registers the canvas and its actions, and the engine checks them against the `api` version.
4. **Open.** The engine calls `open` with one `instance` per canvas and folder, so every session in that folder shows the same page and unsaved edits survive. The `url` must be loopback (`127.0.0.1`, `localhost`).
5. **Stop.** A canvas stops in four ways, each with `close`, then SIGTERM, then SIGKILL after 5 s:
   - **Stop** in the panel's header (`canvases.stop` with `hold`). It then stays stopped, in every session, until **Start**: no panel starts it by itself.
   - **Nobody has it open.** Each window tells the engine which canvases its sessions have open (`canvases.view`, from `useCanvasSync`), and a window that goes away drops its part. A canvas no window has open stops after five minutes (`CANVAS_IDLE_MS`), so opening it again within them is instant. An agent's `open_canvas` or `canvas_action` starts the wait over.
   - Its file changed and you trusted it again: the old process is the old canvas.
   - The app quits.

### The log

Every canvas has a log of its last 200 lines (`CanvasLogLine`: time, level, who wrote it): its stdout (info), its stderr (warn), `host.log(message, level)`, and Seshboard's own lines (Started, Opened, each action with its time, why it stopped). The panel's header has a **Log** button: the log opens under the page and follows new lines (`canvases.logged`, at most four times a second). A canvas that failed shows its log under the reason. The agent reads the same lines with `canvas_log`. A stopped canvas keeps its log until it runs again.

### The code

| Part | Where |
|---|---|
| The SDK (`canvas`, `serve`), the messages, the runner | `packages/canvas/src/` (`index.ts`, `wire.ts`, `runner.ts`) |
| Finding, trusting, starting and stopping canvases | `packages/engine/src/canvas/canvasHost.ts` |
| Requests and the event (`canvases.*`), `CanvasListed` | `packages/protocol/src/contract.ts`, `canvases.ts` |
| How a canvas starts in the app (`canvasRunner`), its bundles (`canvas-runner.js`, `canvas-sdk.js`) | `apps/desktop/src/main/index.ts`, `electron.vite.config.ts` |
| The page's guards: a canvas partition, this computer only | `apps/desktop/src/main/webPreview.ts`, `webPreviewRules.ts` (`isCanvasPartition`) |
| The panel, its states, the list, the pages kept alive | `apps/ui/src/components/canvas/` |
| Which canvases a session has open, and what the window tells the engine | `apps/ui/src/state/canvasPanelStore.ts`, `useCanvasSync.ts` |

## Where it shows

- **The rail panel.** Each canvas gets a button on the rail of tools (a letter in a circle), in a group of its own after the mods' panes. It opens in the side panel with its sizes (Side, Half, Full): at Half the canvas and the conversation sit side by side, which is the layout for writing.
- **Later: apps in the Activity panel**, for canvases that are not about one session.

The page runs in a `<webview>` in a partition of its own per canvas and project, with no Node, no `window.seshboard` and no preload. It stays on this computer: other links open in the browser. Its `prefers-color-scheme` follows Seshboard's light or dark. The page lives outside the panel (`canvasPages.ts`), at the end of the window's body, drawn over the panel's slot and parked off screen while the panel is behind another one or its session is not on screen, as the browser's pages are. So it is as you left it when you come back. A window keeps six pages; the one shown longest ago goes first. A page goes when its canvas is closed in the session, stops or changes.

## The agent and the canvas

The canvas tools are part of Seshboard's `seshboard` MCP server ([seshboard-tools.md](seshboard-tools.md)), which every session that isn't read-only already gets, whatever its agent. They are among the core tools, so a project that gives its sessions only Start sessions has them too. A server of their own was the first plan; one server keeps one place where a session's tools are decided.

| Tool | What it does |
|---|---|
| `list_canvases` | The project's canvases: id, name, description, whether you trusted it, its state, and the actions of the open ones |
| `open_canvas` | Shows a canvas in the session's side panel (`canvases.show`) and starts it. An untrusted one opens its panel on the trust question and the tool says so: the agent asks you, and tries again |
| `canvas_action` | Runs an action of an open canvas and returns its JSON, marked as data, not instructions |
| `canvas_log` | The end of a canvas's log, marked as data |
| `canvas_guide` | How to write a canvas: the folder, the SDK, an example, the rules (`packages/protocol/src/canvasGuide.ts`) |

None of them raises an approval card: the trust question is the gate, and only you answer it, in the panel.

**Writing goes through files.** The agent edits the Markdown with its own tools. The canvas watches its files and reloads, and asks which version wins if you have unsaved edits. Actions are for finding and showing ("open the newest draft"), not for writing.

**Making a canvas.** `canvas_guide` takes the place of a skill: it reaches every agent the same way. The agent writes the folder, calls `open_canvas`, and you trust what it wrote in the panel.

## The canvas and the chat

- **`host.compose({ text, chips })`** goes to the engine, which checks the chips (`composeItems`: a file with lines, or text under a title, at most 10) and tells the windows (`canvases.compose`). The panel whose page has the keyboard takes it, else the one in the active pane (`composeHere`): the chips go into the message box's tray and the text into the box, which takes the focus. Nothing is sent.
- **`host.context()`** is `{ folder, branch, theme, session }`. The panel that shows the canvas tells the engine its session and the look (`canvases.shown`), and again when either changes; the engine passes it on only when it differs. `host.onContext(fn)` hears each change.

## The Front Matter canvas (the first test)

A personal canvas for the blog: `.seshboard/canvases/frontmatter/` in `web-eliostruyf-astro`, so it follows the branch. It is not a copy of the VS Code extension: its dashboard sends about 70 kinds of messages to listeners built on the `vscode` API. A new, smaller app that reads the same configuration:

- **Configuration:** `frontmatter.json` with `frontMatter.extends` and the dynamic config file (`frontMatter.config.dynamicFilePath`), content folders, content types and their fields, the public folder.
- **Dashboard:** the posts as cards (title, date, draft, tags, cover), newest first, with search and filters for drafts and changed (against git).
- **A post:** the front matter as a form from its content type, the Markdown with a preview, autosave, reload on a change from outside.
- **Media:** the media folders as a grid, drop to add, alt text and caption in Front Matter's media data file, insert into the post.
- **Writing help:** select text, then **Ask**: the selection goes to the message box as a chip with its file and lines (`compose`). Suggest a description and Suggest tags fill the message box with a prompt.
- **Actions:** `list_content`, `open_post`, `current_post` (the post and selection you have open), `list_media`.

Test it on a branch: the agent edits real posts.

## Phases

1. **Core (built).** `@seshboard/canvas` with `canvas`, `serve` and `host.log`, discovery, trust, starting per folder, `open`, the rail button and the panel.
2. **The agent's tools (built).** `list_canvases`, `open_canvas` and `canvas_action` in the `seshboard` server.
3. **The canvas and the chat (built).** `host.compose` with chips, `host.context` and `host.onContext`.
4. **Making canvases (built).** `canvas_guide`.
5. **Running them well (built).** Stop and Start, stopping a canvas nobody has open, the page kept alive behind other panels, the log in the panel and `canvas_log`. The packaged app runs canvases (`npm run smoke:packaged -- --demo --only "canvas"`, on an unsigned macOS build).
6. **Later.**
   - User-wide canvases, apps in the Activity panel, phones and other computers.
   - The log in Settings › Diagnostics.
   - `@seshboard/canvas` on npm. A canvas doesn't need it: Seshboard hands the module to the canvas when it starts it. npm would only give an editor the types, so the package stays private until someone asks for them.

The Front Matter canvas is next: it needs nothing more from Seshboard.

## Tests

- `packages/engine/src/canvas/canvasHost.test.ts`: a real canvas process per test. Discovery, the trust hash, one page per folder, Stop that holds, the stop when nobody has it open, the log, a page that is not on this computer, a canvas that throws or is written for another API, a changed file, actions, `host.context` and `host.compose`.
- `packages/engine/src/sessionTools/sessionTools.test.ts`: the four tools against fakes.
- `apps/ui/src/components/canvas/canvasPanel.test.ts`: the panel's states and which panel takes a compose.
- `apps/desktop/src/main/webPreviewRules.test.ts`: a canvas's `<webview>` attaches only in a canvas partition, on this computer.
- Smoke: `npm run smoke:demo -- --only "canvas"` copies `tests/fixtures/smoke-canvas/` into the demo session's folder: the rail button, the trust question, the page in its own partition, an outside link, the page kept behind Changes, the log, Stop and Start, then the tools as the agent calls them, the context and the message box.
