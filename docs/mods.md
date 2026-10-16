# Claude Code mods

Mods are Claude Code plugins that draw UI: a band above the prompt, panes, statuses, toasts, and their own drawing of built-in parts of a session (tool calls, messages, the spinner). A mod is a plugin whose `hooks/hooks.json` names one ES module under `modules`. Claude Code finds it in the enabled plugins (`enabledPlugins`, `CLAUDE_CODE_PLUGIN_DIRS`, managed settings), loads it and runs it. **Switchboard never reads or runs a mod's module.** It relays requests to Claude Code and draws the tree Claude Code sends back. Settings › Mods reads `hooks/hooks.json` only, to list which plugins are mods.

People's docs are on the website ([Claude Code mods](https://switchboard.struyfconsulting.com/sessions/mods/)). This note is about how it works.

## The bridge

Switchboard is a remote surface to Claude Code, like the VS Code extension: surface `desktop`, client id `switchboard-<sessionId>`, one surface per session.

| Part | Where |
|---|---|
| Types, events and requests (`mods.*`), limits | `packages/protocol/src/mods.ts`, `modsConstants.ts`, `contract.ts` |
| The SDK calls | `packages/engine/src/host/modsBridge.ts` |
| One session's surface: attach, relay, system messages | `packages/engine/src/host/modsSurface.ts` |
| Which plugins are mods, the hooked cache key | `packages/engine/src/host/modsCatalog.ts` |
| Tree checks, layout, colours, the renderer | `apps/ui/src/components/mods/` |
| What the windows know (`mods.*` events) | `apps/ui/src/state/modsStore.ts`, `useModsSync.ts` |

1. `SessionHost` reads `capabilities` from the initialize result and from each turn's `system/init`: `ui_surface_v1` (mods can draw), `ui_hooked_v1` with `ui_hooked_v1:<Component>` (what a mod replaces) and `prompts_screened_v1` (a mod checks prompts).
2. With `ui_surface_v1` and **Show mods** on, the surface registers the host answers with `setUiHost` (`copy`, `promptRead`, `promptFill`, `promptSuggest`), then sends `ui_attach` naming them under `answers`. It then reads the pane roster once with `ui_panes`. An "Unsupported control request subtype" error on `ui_attach` or `ui_render` means the session has no mods: it detaches quietly.
3. The windows' requests (`mods.render`, `mods.press`, `mods.input`, `mods.select`, `mods.scroll`, `mods.focus`, `mods.panes`, `mods.pane`) become `ui_render`, `ui_press`, `ui_input`, `ui_select`, `ui_scroll`, `ui_focus`, `ui_panes`, `ui_pane_show`, `ui_pane_focus` and `ui_close`, each with a 30 s limit (`MOD_TIMEOUT`).
4. `system` messages with a `ui_` subtype never reach the transcript. `ui_status` and `ui_panes` are the session's state: Claude Code sends them as the session starts, before the attach, so the surface keeps them either way and the windows show them only while attached. `ui_toast` (4,000 ms by default, the last 20 kept), `ui_invalidate`, and `ui_scroll` and `ui_focus` for this client need an attached surface. `ui_log` goes to the engine's debug log and Settings › Diagnostics › Mod logs.
5. Losing the capability detaches and clears statuses, toasts and panes. **Show mods** off (`showMods` in the preferences, sent to the engine as the `mods` standing message) detaches every session; on attaches every session that supports mods. Statuses and panes stay for when it comes back; prompt screening is reported either way.

### Host answers

The engine has no clipboard and no message box, so `ui_copy`, `ui_prompt_read`, `ui_prompt_fill` and `ui_prompt_suggest` go to the windows as `mods.promptAsk`. The window that shows the session answers with `mods.promptAnswer`, and the first answer wins. Unanswered after 5 s, the engine gives Claude Code an empty box (as Claude Code itself does). Fill and suggest only change the message box (`registerModComposer` in `components/mods/modComposer.ts`); they never send.

### The SDK cast

`Query.setUiHost()` and `Query.request()` are in the SDK's code (0.3.288) but not in its `.d.ts`: they are internal and may change without notice. They are called only in `modsBridge.ts`, through one small typed wrapper. When the SDK has neither, `modsBridge()` returns null and sessions never attach. `request()` resolves with the control response; the bridge hands back its `response` and aborts the request after the limit.

## Drawing

`ui_render` returns an Ink-style JSON tree. Claude Code validated it, but the window checks it again (`prepareTree` in `components/mods/modTree.ts`) before `ModTree.tsx` draws it:

- Nodes: `Box`/`div`, `Text`/`span`/`b`, `Link`, `Code`, `Markdown`, `Svg`, `Button`, `Input`, `Select` and `engine { ref }` (at most one; where the built-in component goes). `Client` is skipped, and an unknown type is drawn as its children.
- Only strings, numbers and booleans reach a style. Layout is Ink's flexbox, in cells: a column is the mono font's advance and a row its line height, measured in the window (`modLayout.ts`).
- Named Ink colours become theme tokens: red `error`, green `ok`, yellow `caution`, blue and cyan `link` (the app's info colour), magenta `remote`, gray and dim `muted`, white `text`. Hex and `rgb()` values are kept, lifted in OKLCH lightness until they reach 4.5:1 on the frame (`modColor.ts`).
- `Markdown` uses the conversation's renderer, which draws no raw HTML. `Link` keeps only `http` and `https` (main opens them in the browser and refuses the rest). `Svg` is stripped of scripts, `foreignObject`, event handlers and references outside the picture, and drawn as an `<img>` data URL, where the browser runs nothing and loads nothing (`modSvg.ts`).
- Limits: 2,000 nodes (10,000 in a pane), depth 32, 256 KB of text, 250 SVG pictures. A tree over one is cut, with a quiet line such as "This pane hit its 10,000 node limit. The rest isn't shown."

A band's tree holds every mod hooked on `AbovePrompt`. Claude Code marks the root of each mod's drawing with `part.plugin`; `splitParts` gives each mod its own frame, in `drawn_by` order. `drawn_by` names the mods that drew a replaced item, for its frame's header.

Renders are cached per instance (`useModRender.ts`) and asked again only when `ui_invalidate` names the instance (or all of them) or the props change. The props each component sends are in `ModBands.tsx` (`AbovePrompt`), `ModPanePanel.tsx` (`Pane`) and `modReplace.ts` (the replaced components).

`AskUserQuestion` drawn by a mod is only a drawing: the question is still answered through Switchboard's own permission card.

### The hooked cache

The engine keeps the last `ui_hooked` list per profile in app state, under a hash of the profile's and the managed `enabledPlugins`, the plugin folders and the managed settings' mtime (`hookedCacheKey`). While a session is starting, the transcript holds back the built-in view of what was replaced last time for up to 3 s, so it doesn't flash before the mod's drawing. Any change to the plugins or settings gives another key, so a stale list is never used.

## Testing

- Engine tests (`packages/engine/src/host/mods.test.ts`) fake the SDK: attaching after the capability, none without it, the unsupported subtype error, the 30 s timeout, clearing on capability loss, a `null` status, the toast cap and the hooked cache key.
- UI tests (`apps/ui/src/components/mods/*.test.ts`) cover every node type, colours and contrast, cells, each tree limit and its note, the footer folding into "+N", band order, Show mods off and the replaced components.
- The smoke run's **Claude Code mods** step loads `tests/fixtures/smoke-mod` through `CLAUDE_CODE_PLUGIN_DIRS` in a throwaway profile and config folder, and starts its session with the mod's own `/smoke-ping`, which the mod answers without the model, so it costs nothing and needs no login. It checks the band, the pane, the status, a press and a toast, and that Show mods off removes all of it. It is skipped, with a message, when the installed Claude Code doesn't report `ui_surface_v1`.
- The website's screenshots use the demo mods in `scripts/demo-mods/` the same way.

To try a mod by hand, set `CLAUDE_CODE_PLUGIN_DIRS` to the mod's folder in your login shell, or in the `env` block of the profile's `settings.json`, and start a session.

## Other devices

The remote app and other computers don't get bands, panes or replaced views; the remote contract has no mods in it.
