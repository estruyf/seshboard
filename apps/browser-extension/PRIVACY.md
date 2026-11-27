# Privacy policy

_Seshboard browser extension. Last updated 2026-11-27._

## Short version

The extension sends what you choose to the Seshboard app on your own computer, and nowhere else. It makes no network
requests, stores nothing, and reads a page only when you ask it to.

## What it reads

- **The page you invoke it on**, when you right-click it or open the extension on it: its title and address, and the
  text you selected.
- **A screenshot** of the visible part of that page, only when you tick Screenshot.
- **Console errors on pages you run on your own computer** (`localhost` and `127.0.0.1`): `console.error` calls,
  uncaught errors, unhandled promise rejections and failed `fetch` calls. They stay in that page, at most the last 50,
  until you tick Console errors and add them. The extension reads no other site's console.

## Where it goes

To the Seshboard desktop app on the same computer, through your browser's native messaging, a channel between the
extension and a program on your computer. Seshboard puts it in a session's message box. Nothing goes to Claude, or
anywhere else, until you press send in Seshboard. What Seshboard does with a message you send is covered by Seshboard
and by Claude Code, not by this extension.

The extension also asks Seshboard for your sessions and projects, to show where you can send and which sessions wait
for you. That list stays in the extension's memory while it runs.

## What it stores

Nothing. It keeps no history, no settings and no data in the browser's storage.

## What it does not do

- It sends nothing to the developer or to any other server, and makes no network requests of its own.
- It has no analytics and no tracking.
- It loads no code from outside the package.

## Contact

Questions or problems: https://github.com/estruyf/seshboard/issues
