# The promo video

About a minute of Seshboard, cut with [Remotion](https://www.remotion.dev): React rendered to frames, so the
timeline is a table of numbers in a `.tsx` file and changing the pace is changing a number and rendering again.

It leads with what makes Seshboard different (several Claude accounts in one list, a page per project with its
worktrees, the VS Code companion), then shows the rest at a glance (split view, Changes, the command palette,
search).

Nothing here is part of the app. It has its own `package.json`, isn't one of the repo's workspaces, and the
shipped build has none of its dependencies.

## Making it

```bash
# in the repo root: the app the capture drives, and the companion it installs into VS Code
npm run build
npm run package:vscode

cd promo
npm install
npm run capture          # every still and every recorded beat, retaken (about two minutes)
npm start                # the Remotion studio, with a scrubbable timeline
npm run render           # out/promo.mp4, the master (CRF 17)
npm run web              # out/web/: smaller copies without audio, a GIF for the README, and a poster
```

`npm run capture shots` and `npm run capture clips` do half each; naming a shot or a beat (`home`, `profile`,
`companion`) records just that one. Every run builds the world from scratch, so the steps always happen in the
same order; a beat you didn't ask for still happens, unrecorded, because later shots depend on it.

The capture needs VS Code at `/Applications/Visual Studio Code.app` for the companion beat. The ffmpeg is
Remotion's own (`scripts/ffmpeg.mjs`), already in `node_modules`; `PROMO_FFMPEG` picks another.

## Where the pictures come from

Everything on screen is the real app, running, driven by Playwright: Seshboard through Playwright's Electron
support (`scripts/harness.mjs`), and for the companion beat a real VS Code over its debugging port, with the
companion installed from its `.vsix`. Nothing is a mock-up and nothing is retouched.

**The demo world** is the README screenshots' (`apps/desktop/scripts/screenshot-demo.ts`): four small git
projects and two Claude Code config folders, a personal login and a work one, with made-up sessions. The harness
adds a few worktrees to acme-store, one for each group of the Worktrees tab, dated a few days back.

It's built in `/Users/Shared`, not in the temporary folder: Seshboard only shortens paths to `~/…` under
`/Users/<name>`, and a temporary home shows every project as `/private/var/folders/…`. The harness only adds
`.claude`, `.claude-work`, `.local`, `Developer`, `.vscode` and `.vscode-shared` there, refuses to start when one
of them already exists, and removes them again when it's done (also on Ctrl-C). If a crash leaves them behind,
check they're the demo's and delete them.

**Nothing touches real data.**

- HOME and CLAUDE_CONFIG_DIR point at the demo, so neither the app nor Claude Code sees your projects or
  transcripts. The demo logins have no credentials, so nothing is ever sent to Claude.
- The app keeps its database and preferences in a throwaway data folder (`SESHBOARD_DATA_DIR`), and the Claude
  Code update check reads a mock registry.
- VS Code runs with its own profile and extensions folder, and with HOME pointed at the demo. Its companion is
  told where the demo app's data is (`switchboard.appDataFolder`, which replaces where it would otherwise look),
  and the capture clicks nothing until the companion's status bar item says it's connected. Otherwise it would
  open Seshboard itself (`open -b`), and that would be your real app.
- Both apps run with `--use-mock-keychain`. With HOME pointed at the demo, macOS can't find your login keychain
  when VS Code asks for its storage key, and it offers to **reset** it. Never press Reset if that dialog shows
  up; press Cancel and look at why the switch didn't take.

**Stills** are `public/shots/*.png`, the window at 2x (2560x1600). The pointer is parked in the window's
top-left corner before each one, where nothing reacts to it: a pointer left over a row or a title keeps its hover
state or its tooltip, even hidden.

**Recorded beats** are `public/clips/*.mp4`, at a constant 30 fps, recorded with CDP's screencast. Two things
about it are worth knowing before changing anything:

- **It doesn't draw the pointer.** The harness puts a dot back at the position Chromium reports, with a ripple on
  a click. It follows real mouse events, so it can't drift from where the click lands. It's the only thing in
  any frame the apps didn't draw. The traffic lights on a window are the other drawn thing: macOS draws them
  outside the page, so a crop that includes a window's top-left corner puts them back, as the README's framed
  screenshots do.
- **Frames only come when the page paints**, so each stream is resampled onto a fixed 30 fps grid. The companion
  beat records VS Code and Seshboard at the same time on one clock, so frame N of one is the same moment as
  frame N of the other. Both are launched with Chromium's switches against occluded and background windows, or
  the one underneath stops painting.

`public/clips.json` records how long each beat is, and the composition reads it.

## How it's put together

The look is a patch bay, after the app's name: a dark panel with a faint grid of jack holes (`Ground`), the app's
yellow as the cable (`Cable`), and the four status colours the app uses (needs you, working, background, unread)
as the lit jacks on the title and the outro. Windows swing in from a tilt and settle flat (`Window`); captions
come up a word at a time (`Caption`). In the companion scene, a cable plugs into the two windows' edges at the
moment of the click, between the pictures, never over them.

Each recorded beat **holds** on its first frame while the caption is read, **plays**, and holds again where it
ends (`Clip` in `src/components/Shot.tsx`). Nothing is ever played faster than it was recorded: a beat that runs
long gets its pauses shortened in `scripts/capture.mjs` and is recorded again.

The camera is a crop. `Framed` takes a rectangle in the capture's own pixels (`pts()` writes it in the window's
1280x800 points) and scales the picture under a window that clips it, so stills and recordings share one
coordinate space. Every crop edge is either the window's own edge or falls in an empty part of the app, never
through a row, a card or a line of code.

## After the UI changes

`npm run capture` replaces every frame. What it doesn't fix, and what to check by hand every time:

- **The event frames.** Caption switches and the companion's cable are tied to the recording frame where
  something happens on screen: `PROFILE_ADDED` in `src/Promo.tsx`, `CLICK` in `src/scenes/Companion.tsx`, and
  `play` on the project beat. Find them again with

  ```bash
  node scripts/activity.mjs profile          # how much of the picture changes, frame by frame
  node scripts/activity.mjs companion-code 0.05
  node scripts/frame.mjs profile 135         # look at one frame
  ```

- **Crops.** A layout change moves the gaps a crop ends in. The Home crop, for one, ends between the project
  tiles and Profiles, because the demo's profile cards can only say "Usage unavailable".

Check a frame with `npx remotion still src/index.ts Promo /tmp/check.png --frame=N` before spending a few
minutes on a full render.
