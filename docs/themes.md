# Themes

A theme colours Seshboard: the app, code blocks and diffs, and the terminal, in a light and a dark version. It is one JSON file. Pick, import and export themes in **Settings → Theme**; see the [README](../README.md#themes) for how that works. This page is the file format.

- [The smallest theme](#the-smallest-theme)
- [The file](#the-file)
- [Colours](#colour-values)
- [How missing colours are generated](#how-missing-colours-are-generated)
- [Every token and where it shows](#every-token-and-where-it-shows)
- [Code colours](#code-colours)
- [The terminal](#the-terminal)
- [Importing, exporting and editing](#importing-exporting-and-editing)
- [Built-in themes](#built-in-themes)
- [Credits and licences](#credits-and-licences)

## The smallest theme

A background (`canvas`) and an `accent` per mode are enough. Everything else is generated from them, solved to stay readable:

```json
{
  "name": "Mint",
  "version": 1,
  "dark": { "canvas": "#0f1a17", "accent": "#3ddc97" }
}
```

This one has only a dark version, so in light mode Seshboard uses Demo Time.

## The file

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/estruyf/switchboard/main/docs/switchboard-theme.schema.json",
  "name": "Solarized",          // required, 1 to 48 characters
  "author": "Ethan Schoonover",  // optional
  "version": 1,                 // required: the theme format, 1
  "light": { "canvas": "…", "accent": "…", "colors": { … }, "syntax": … },
  "dark":  { "canvas": "…", "accent": "…", "colors": { … }, "terminal": { … }, "syntax": … }
}
```

- **`light` and `dark`**: at least one. A missing mode uses Demo Time, and Settings says so.
- **`canvas` and `accent`** (per mode, optional): the background and the accent every missing colour is generated from.
- **`colors`** (per mode, optional): any of the [tokens](#every-token-and-where-it-shows) by their name. They win over what canvas and accent generate. Without `canvas`, the mode's `colors.bg` stands in for it (and `colors.accent` for `accent`); without those either, Demo Time's.
- **`terminal`**: the terminal's colours. Only read from `dark`, because the terminal panel is always dark.
- **`syntax`** (per mode, optional): the [code colours](#code-colours). Missing means Demo Time's.
- **`$schema`** points editors such as VS Code at [switchboard-theme.schema.json](switchboard-theme.schema.json), for completion and checks while you type. Exports always include it.
- **`$comment`** may be a string or a list of strings, at the top level, in a mode, or in `colors`, for notes. It is ignored.
- Files may have comments (`//`, `/* */`) and trailing commas, as VS Code's theme files do.
- **Unknown keys are ignored**, and the import lists them ("Ignored 2 unknown keys: `colors.tab-bg`, `fonts`").

Here is a short Solarized with both modes, a few colours of its own, its terminal and Shiki's Solarized code colours. The Solarized that ships with Seshboard sets every colour; it is in [apps/ui/src/themes/solarized.json](../apps/ui/src/themes/solarized.json).

```json
{
  "$schema": "https://raw.githubusercontent.com/estruyf/switchboard/main/docs/switchboard-theme.schema.json",
  "name": "Solarized Short",
  "author": "Ethan Schoonover",
  "version": 1,
  "light": {
    "canvas": "#fdf6e3",
    "accent": "#b58900",
    "colors": { "sidebar": "#eee8d5", "text": "#073642", "muted": "#586e75" },
    "syntax": "solarized-light"
  },
  "dark": {
    "canvas": "#002b36",
    "accent": "#b58900",
    "colors": { "sidebar": "#073642", "card": "#073642", "text": "#93a1a1", "muted": "#839496" },
    "terminal": {
      "background": "#001e26",
      "foreground": "#93a1a1",
      "cursor": "#b58900",
      "ansi": ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"]
    },
    "syntax": "solarized-dark"
  }
}
```

And Demo Time, the built-in theme, which sets every token (exporting it from Settings gives you this file as a starting point):

```json
{
  "$schema": "https://raw.githubusercontent.com/estruyf/switchboard/main/docs/switchboard-theme.schema.json",
  "name": "Demo Time",
  "author": "Elio Struyf",
  "version": 1,
  "light": {
    "canvas": "#ffffff",
    "accent": "#ffd43b",
    "colors": {
      "bg": "#ffffff", "sidebar": "#f4f6fa", "card": "#ffffff", "popover": "#ffffff", "code-bg": "#f4f6fa",
      "border": "#e1e4e8", "overlay-border": "#d1d5da", "overlay-shadow": "#15181f33",
      "text": "#202736", "muted": "#505869", "faint": "#687082", "link": "#005cc5",
      "selected": "#2027361a", "focus-ring": "#916c008c", "scrim": "#15181f59",
      "ok": "#00806f", "warn": "#d1186b", "error": "#d73a49", "caution": "#b35900", "unread": "#005cc5", "memory": "#8250df", "remote": "#7048e8", "paper": "#fbfaf7", "paper-text": "#1f2328", "trigger": "#6f42c1", "pipeline": "#6741d9",
      "accent": "#ffd43b", "accent-ink": "#916c00", "on-accent": "#15181f",
      "diff-added": "#00806f1f", "diff-removed": "#d73a491f",
      "terminal-bg": "#0d1016", "terminal-shadow": "#15181f29",
      "profile-yellow": "#b08300", "profile-blue": "#1f6feb", "profile-green": "#1a7f37", "profile-purple": "#8250df",
      "profile-red": "#cf222e", "profile-orange": "#d1600a", "profile-gray": "#6e7781",
      "chart-output": "#7048e8", "chart-cache-write": "#c2255c", "chart-cache-read": "#1c7ed6", "chart-input": "#099268"
    }
  },
  "dark": {
    "canvas": "#15181f",
    "accent": "#ffd43b",
    "colors": {
      "bg": "#15181f", "sidebar": "#202736", "card": "#202736", "popover": "#2a3244", "code-bg": "#202736",
      "border": "#2d3142", "overlay-border": "#414861", "overlay-shadow": "#000000b3",
      "text": "#d9dbe1", "muted": "#9ba4b7", "faint": "#8b94a6", "link": "#74c0fc",
      "selected": "#d9dbe11c", "focus-ring": "#ffd43b8c", "scrim": "#00000099",
      "ok": "#51cf66", "warn": "#ed217c", "error": "#ff6b6b", "caution": "#ffa94d", "unread": "#74c0fc", "memory": "#b197fc", "remote": "#b197fc", "paper": "#15181f", "paper-text": "#d9dbe1", "trigger": "#b197fc", "pipeline": "#9775fa",
      "accent": "#ffd43b", "accent-ink": "#ffd43b", "on-accent": "#15181f",
      "diff-added": "#51cf661f", "diff-removed": "#ff6b6b1f",
      "terminal-bg": "#0d1016", "terminal-shadow": "#0000008c",
      "profile-yellow": "#ffd43b", "profile-blue": "#74c0fc", "profile-green": "#51cf66", "profile-purple": "#b197fc",
      "profile-red": "#ff8787", "profile-orange": "#ffa94d", "profile-gray": "#9ba4b7",
      "chart-output": "#9775fa", "chart-cache-write": "#e64980", "chart-cache-read": "#339af0", "chart-input": "#0ca678"
    },
    "terminal": {
      "background": "#0d1016",
      "foreground": "#d9dbe1",
      "cursor": "#ffd43b",
      "selection": "#ffd43b40",
      "ansi": ["#15181f", "#ff6b6b", "#51cf66", "#ffd43b", "#74c0fc", "#d0bfff", "#66d9ef", "#d9dbe1", "#6b7280", "#ed217c", "#7ee787", "#e6be36", "#8bb3ff", "#d2a8ff", "#56d4dd", "#ffffff"]
    }
  }
}
```

## Colour values

A theme holds colours and nothing else. Every value must be one of:

- `#rgb`, `#rrggbb` or `#rrggbbaa`
- `rgb()` or `rgba()`, with commas or spaces: `rgb(21 24 31 / 0.35)`
- `hsl()` or `hsla()`: `hsl(210 40% 50%)`
- `oklch()`: `oklch(0.7 0.1 250 / 50%)`

Anything else (named colours such as `red`, `url()`, `var()`, `color-mix()`, `;`, `}`) refuses the whole file, with where the first problem is:

> `dark.colors.bg` uses `url(…)`. Themes can only hold colour values: #hex, rgb(), hsl() or oklch().

Nothing is added then. The same check applies to the terminal and to inline code themes, so a theme file can never add CSS of its own.

## How missing colours are generated

For each mode, Seshboard first generates every token from `canvas` and `accent`, then applies `colors` on top, then works out the tokens that follow from others (`selected` from `text`, `focus-ring` from `accent-ink`, `diff-added` and `diff-removed` from `ok` and `error`) unless `colors` sets them. The maths is in OKLCH, so lightness steps look even:

| Tokens | Generated as |
|---|---|
| `bg` | the canvas |
| `sidebar`, `card`, `popover`, `code-bg` | steps from the canvas: lighter in dark mode, darker in light mode, with a hint of the accent's hue when the canvas has none of its own |
| `border`, `overlay-border` | further steps from the canvas |
| `text`, `muted` | at least 4.5:1 (WCAG AA) on the canvas, the sidebar and cards |
| `faint` | at least 3:1 |
| `accent` | the accent, as given |
| `accent-ink` | the accent's hue, moved until it reaches 4.5:1 on `bg` |
| `on-accent` | black or white, whichever reads better on the accent |
| `link`, `unread` | the accent when it is blue-ish, otherwise Demo Time's blue; 4.5:1 on `bg` |
| `ok`, `warn`, `error`, `caution` | Demo Time's hues, moved to 4.5:1 on `bg`, so they keep their meaning (pink still needs you) |
| `paper` | a light canvas: a slightly warm, slightly darker lift of it. A dark canvas: the canvas |
| `paper-text` | `text`, moved to at least 4.5:1 on `paper` |
| `remote` | Demo Time's violet, moved to 4.5:1 on `bg`, the sidebar and cards |
| `profile-*` | Demo Time's hues, moved to 3:1 on `bg` |
| `selected` | `text` at 10% (light) or 11% (dark) |
| `focus-ring` | `accent-ink` at 55% |
| `diff-added`, `diff-removed` | `ok` and `error` at 14% |
| `scrim`, `overlay-shadow`, `terminal-shadow` | near-black at Demo Time's strengths |
| `terminal-bg` | dark in both modes, in the canvas's hue |

From Demo Time's own canvas and accent, the generator lands close to Demo Time. The differences: `on-accent` is pure black (Demo Time uses its near-black `#15181f`); on a white canvas the greys and text take a hint of the yellow accent instead of Demo Time's cool blue-grey; the diff backgrounds are 14% (Demo Time's are 12%); `accent-ink` (`#8f7400` instead of `#916c00`) and dark `warn` are solved to just 4.5:1. Demo Time itself always uses its exact values.

When a theme is imported, the dialog lists which colours are generated, with swatches, and warns about any pair under WCAG AA: text and muted text on the background, text on the accent, and code (plain and comments) on the code background. The theme still imports.

## Every token and where it shows

The names are the `--sb-*` CSS variables without the prefix. Values are Demo Time's.

| Token | Where it shows | Light | Dark |
|---|---|---|---|
| `bg` | the conversation, the window behind everything, fields | `#ffffff` | `#15181f` |
| `sidebar` | the sidebar and side panels | `#f4f6fa` | `#202736` |
| `card` | cards: your prompt, plans, permission and question cards, the message box, theme cards | `#ffffff` | `#202736` |
| `popover` | menus, popovers, dialogs, toasts | `#ffffff` | `#2a3244` |
| `code-bg` | code blocks, tool output, inline and Changes diffs | `#f4f6fa` | `#202736` |
| `border` | lines between areas, card edges | `#e1e4e8` | `#2d3142` |
| `overlay-border` | edges of menus and dialogs, and of fields, chips and secondary buttons inside them | `#d1d5da` | `#414861` |
| `overlay-shadow` | the shadow under menus and dialogs (one colour; the app builds the layers) | `#15181f33` | `#000000b3` |
| `text` | text | `#202736` | `#d9dbe1` |
| `muted` | secondary text, quiet icons | `#505869` | `#9ba4b7` |
| `faint` | small hints, ages, placeholders | `#687082` | `#8b94a6` |
| `link` | links and link-like buttons (Undo) | `#005cc5` | `#74c0fc` |
| `selected` | the selected row (usually translucent) | `#2027361a` | `#d9dbe11c` |
| `focus-ring` | the outline around the focused control while moving with Tab | `#916c008c` | `#ffd43b8c` |
| `scrim` | the backdrop behind dialogs | `#15181f59` | `#00000099` |
| `ok` | running in the background, success, added lines' marks, usage under 60% | `#00806f` | `#51cf66` |
| `warn` | needs you: a permission or a question (pink) | `#d1186b` | `#ed217c` |
| `error` | failures, removed lines' marks, usage from 85% | `#d73a49` | `#ff6b6b` |
| `caution` | a level getting high: usage bars and the context ring from 60% | `#b35900` | `#ffa94d` |
| `unread` | finished and not read yet: rail, dot | `#005cc5` | `#74c0fc` |
| `memory` | Claude Code memory: MEMORY.md in What loads here | `#8250df` | `#b197fc` |
| `remote` | only things on another computer: its chips, the badge on its project icons, the line over its sessions | `#7048e8` | `#b197fc` |
| `trigger` | event triggers: the bolt on a session a trigger started, event fields in a trigger's prompt | `#6f42c1` | `#b197fc` |
| `pipeline` | pipelines: the icon on a parent row and a run row, step kinds and @ links in the editor | `#6741d9` | `#9775fa` |
| `paper`, `paper-text` | reading mode: the page behind a reply and the text on it. Light is a warm off-white; dark is the same as `bg` and `text` | `#fbfaf7`, `#1f2328` | `#15181f`, `#d9dbe1` |
| `accent` | primary buttons and tints (Demo Time's yellow) | `#ffd43b` | `#ffd43b` |
| `accent-ink` | the accent as text, icons, spinners, working dots and borders | `#916c00` | `#ffd43b` |
| `on-accent` | text on an accent fill | `#15181f` | `#15181f` |
| `diff-added` | the background of added lines | `#00806f1f` | `#51cf661f` |
| `diff-removed` | the background of removed lines | `#d73a491f` | `#ff6b6b1f` |
| `terminal-bg` | the terminal panel (always dark) | `#0d1016` | `#0d1016` |
| `terminal-shadow` | the shadow the terminal panel casts on the conversation | `#15181f29` | `#0000008c` |
| `profile-yellow`, `-blue`, `-green`, `-purple`, `-red`, `-orange`, `-gray` | the dots, tags and rails that tell Claude profiles apart | see Demo Time above | |
| `chart-output`, `chart-cache-write`, `chart-cache-read`, `chart-input` | the token types in the Usage view's charts, and its plan windows' lines (Weekly, a model's weekly, Session). Checked together for colour blindness; generated themes keep Demo Time's | `#7048e8`, `#c2255c`, `#1c7ed6`, `#099268` | `#9775fa`, `#e64980`, `#339af0`, `#0ca678` |

The terminal panel always uses the dark mode's tokens, in light mode too.

## Code colours

Without `syntax`, code keeps Demo Time's colours. Per mode, `syntax` is one of:

- **The name of a bundled Shiki theme**, loaded the first time it is used. One of: `andromeeda`, `aurora-x`, `ayu-dark`, `ayu-light`, `ayu-mirage`, `catppuccin-frappe`, `catppuccin-latte`, `catppuccin-macchiato`, `catppuccin-mocha`, `dark-plus`, `dracula`, `dracula-soft`, `everforest-dark`, `everforest-light`, `github-dark`, `github-dark-default`, `github-dark-dimmed`, `github-dark-high-contrast`, `github-light`, `github-light-default`, `github-light-high-contrast`, `gruvbox-dark-hard`, `gruvbox-dark-medium`, `gruvbox-dark-soft`, `gruvbox-light-hard`, `gruvbox-light-medium`, `gruvbox-light-soft`, `houston`, `kanagawa-dragon`, `kanagawa-lotus`, `kanagawa-wave`, `light-plus`, `material-theme`, `material-theme-darker`, `material-theme-lighter`, `material-theme-ocean`, `material-theme-palenight`, `min-dark`, `min-light`, `monokai`, `night-owl`, `night-owl-light`, `nord`, `one-dark-pro`, `one-light`, `poimandres`, `rose-pine`, `rose-pine-dawn`, `rose-pine-moon`, `slack-dark`, `slack-ochin`, `snazzy-light`, `solarized-dark`, `solarized-light`, `synthwave-84`, `tokyo-night`, `vesper`, `vitesse-black`, `vitesse-dark`, `vitesse-light`. Another name is refused, with a hint for a typo ("Did you mean “solarized-dark”?").
- **An inline TextMate theme**, such as the `tokenColors` of a VS Code theme. Only `name`, `type` and `tokenColors` are read, and of each rule only `scope`, `settings.foreground` (a [colour value](#colour-values)) and `settings.fontStyle` (`italic`, `bold`, `underline`, or several separated by spaces). Its `colors` and `editor.*` keys are ignored.

  ```json
  "syntax": {
    "name": "Mine",
    "type": "dark",
    "tokenColors": [
      { "scope": ["comment"], "settings": { "foreground": "#7f8c98", "fontStyle": "italic" } },
      { "scope": ["keyword", "storage"], "settings": { "foreground": "#ff7ab2" } },
      { "scope": "string", "settings": { "foreground": "#a3e635" } }
    ]
  }
  ```

The background of code is always the theme's `code-bg`, never the syntax theme's, and diffs use `diff-added` and `diff-removed`. Light and dark code colours switch with the app, without highlighting again.

## The terminal

`dark.terminal` sets the terminal panel's colours: `background`, `foreground`, `cursor`, `selection`, and `ansi`, exactly 16 colours: black, red, green, yellow, blue, magenta, cyan, white, then the bright versions in the same order. Each one is optional: without it, the terminal uses the dark mode's `terminal-bg`, `text` and `accent-ink`, the accent at 25% for the selection, and Demo Time's ANSI colours. A `background` here also colours the panel around the terminal, unless `colors.terminal-bg` says otherwise.

## Importing, exporting and editing

- **Import** (Settings → Theme → *Import…*, *Import theme…* in the command palette, or a `.json` dropped on the window outside a session's message box) checks the file and shows a preview before anything is added. A theme with the name of one you have asks whether to replace it or keep both (the copy is named "Solarized 2"); a built-in theme's name always keeps both.
- **Imported themes** are files in the `themes` folder of Seshboard's app data (`~/Library/Application Support/Seshboard/themes`); *Open themes folder* shows it. Seshboard watches the folder: edit the theme in use and it applies when you save. If the change isn't valid, the last version that worked stays in use and Settings → Theme says what is wrong.
- **Export** writes the theme as `<name>.json` (`solarized.json`), always with `$schema`. It writes `canvas` and `accent` and only the colours that differ from what those generate, so the file stays short and imports to exactly the same colours. Exporting Demo Time writes every token.
- **Duplicate** saves a copy of any theme as a new imported one, ready to edit.
- **Remove** moves an imported theme's file to the Trash. Built-in themes can't be removed. Removing the theme in use goes back to Demo Time.
- **Settings → Backup** can include your imported themes.

## Built-in themes

| Theme | Light | Dark | Code colours |
|---|---|---|---|
| Demo Time | Demo Time Light | Demo Time Dark | Demo Time |
| Catppuccin | Latte | Mocha | `catppuccin-latte` / `catppuccin-mocha` |
| Nord | Demo Time Light | Nord | `nord` |
| Solarized | Solarized Light | Solarized Dark | `solarized-light` / `solarized-dark` |
| Graphite, Midnight, Paper, Signal, Forest, Plum, Aluminium, Ocean, Neon | their own | their own | Demo Time |

They are theme files like any other ([apps/ui/src/themes](../apps/ui/src/themes)), checked the same way as imports, and they can't be removed. Nord is dark only, as the original is, so in light mode it shows Demo Time. The nine after Solarized match the [app icon's colourways](../assets/app-icons): each takes its accent from the icon's main cable, its second cable for a chart series (and for links where it is blue), and its background from the icon's body; the rest is generated, then adjusted until every pair reaches WCAG AA, Demo Time's code colours included. All of them reach WCAG AA for text, muted text and the accent as text in every mode they have. Solarized, Nord and Catppuccin keep their own palettes where that is lower, as the originals do: text on Solarized's yellow in light mode (3.0:1) and its comments in code (2.3:1 light, 2.6:1 dark), Nord's comments in code (2.7:1) and Catppuccin Latte's (3.3:1). Where a VS Code theme's status colours are too light to read as text on its background, the port darkens them (Catppuccin Latte's green, pink, peach, yellow and blue) or lightens them (Nord's red, orange and purple) and keeps their hue. Nord's code blocks sit a step darker than its background, so its dim comments stay as readable as they can.

## Credits and licences

- **Demo Time**: [estruyf/vscode-demo-time-theme](https://github.com/estruyf/vscode-demo-time-theme), MIT.
- **Catppuccin**: [catppuccin.com](https://catppuccin.com/), its palette from [catppuccin/palette](https://github.com/catppuccin/palette) mapped as [catppuccin/vscode](https://github.com/catppuccin/vscode) does, ported for Seshboard by Elio Struyf. MIT License, Copyright (c) 2021 Catppuccin. Its code colours are Shiki's bundled `catppuccin-latte` and `catppuccin-mocha`.
- **Nord**: [nordtheme/visual-studio-code](https://github.com/nordtheme/visual-studio-code) by Sven Greb, ported for Seshboard by Elio Struyf. MIT License, Copyright (c) 2016-present Sven Greb. Its code colours are Shiki's bundled `nord`.
- **Solarized**: the [Solarized](https://ethanschoonover.com/solarized/) palette by Ethan Schoonover ([altercation/solarized](https://github.com/altercation/solarized)), ported for Seshboard by Elio Struyf. MIT License, Copyright (c) 2011 Ethan Schoonover. Its code colours are Shiki's bundled `solarized-light` and `solarized-dark`.

The MIT License for Solarized, Nord and Catppuccin (each with its own copyright line above):

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
