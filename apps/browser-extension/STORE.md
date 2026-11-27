# Store listing

What the Chrome Web Store, Edge Add-ons and addons.mozilla.org ask for, ready to paste. Keep it in step with the code:
a new permission, or anything that leaves the computer, changes the answers below.

Last updated: 2026-11-27

## Package

`npm run release -w @seshboard/browser-extension` writes the three zips to `releases/` (see `scripts/release.mjs`):
`-chromium.zip` for Chrome and Edge (without the manifest's `key`), `-firefox.zip` and `-source.zip` for AMO.

Before the first Chrome release: upload the zip as a draft, then add the id the store gives it to
`BROWSER_EXTENSION_IDS.chromium` in `packages/protocol/src/companionConstants.ts` and release Seshboard with it.
Without that, Seshboard's native messaging host does not let the store's extension in. The store's public key
(Package › View public key) can then replace `key` in `src/manifest.json`, so unpacked builds get the same id.

## Listing

- **Title and summary**: from the package (`src/manifest.json`).
- **Category**: Developer Tools.
- **Language**: English.
- **Store icon**: [store/store-icon-128.png](store/store-icon-128.png): the logo at 96x96 with a transparent 16px margin.
- **Screenshots** (1280x800): [store/screenshot-1-selection.jpg](store/screenshot-1-selection.jpg) and
  [store/screenshot-2-console.jpg](store/screenshot-2-console.jpg). They show the real panel (`src/lib/pageDialog.ts`)
  over made-up pages.
- **Small promo tile** (440x280): [store/promo-small-440x280.jpg](store/promo-small-440x280.jpg).
- **Marquee promo tile** (1400x560): [store/promo-marquee-1400x560.jpg](store/promo-marquee-1400x560.jpg).
- **Official URL**: seshboard.app, once it is verified in Google Search Console. Otherwise leave it empty.
- **Homepage URL**: https://seshboard.app/
- **Support URL**: https://github.com/estruyf/seshboard/issues
- **Mature content**: off.

### Description

```text
Seshboard is a desktop app for your Claude Code sessions. This extension sends what you see in the browser to them.

Select text on a page, right-click and choose Send to Seshboard. A panel on the page shows what goes and where: the session on screen in Seshboard, or a new session in the project the page belongs to. Press Enter, and it lands in that session's message box in Seshboard.

What you can send:
• The text you selected, with the page it came from
• The page's title and address
• A screenshot of the page
• The errors in the console of a page you run on localhost: console.error, uncaught errors, unhandled promise rejections and failed fetch calls

Where it goes:
• The session on screen in Seshboard
• Any other session, found by typing a few letters of its title or project
• A new session in one of your projects. On a GitHub issue or pull request, the project with that repository is picked for you.

Nothing goes to Claude until you press send in Seshboard. You can edit the message, remove what you don't want, and add more first.

The toolbar button lists the sessions that wait for you (a permission, a question, a finished plan), with their number on the badge. A click opens the session in Seshboard.

Requires the Seshboard app on macOS, Windows or Linux: https://seshboard.app/. In Seshboard, open Settings › Browser extension and press Connect browsers once.

Privacy: the extension talks only to the Seshboard app on your own computer, through the browser's native messaging. It sends nothing to any server, and it reads a page only when you right-click it or open the extension on it. Console errors are recorded on localhost pages only.
```

## Privacy

### Single purpose

```text
Send what you look at in the browser (selected text, the page's address, a screenshot, a local page's console errors) to a Claude Code session in the Seshboard desktop app on the same computer, and show which of those sessions wait for you.
```

### Permission justifications

**nativeMessaging**

```text
The extension talks to the Seshboard desktop app on the same computer through a native messaging host that Seshboard installs (Settings › Browser extension › Connect browsers). Everything the extension sends goes there, and nowhere else: the list of sessions and projects, and what you choose to add to a session's message box.
```

**contextMenus**

```text
Adds "Send to Seshboard", "Send page to Seshboard" and "Start session from this page" to the right-click menu. They open the panel on the page where you pick what to send and where.
```

**activeTab**

```text
Reads the page you invoked the extension on, and only that one: its title and address, the text you selected, and a screenshot of the visible part when you tick Screenshot. Without it, the extension would need access to every site.
```

**scripting**

```text
Used with activeTab on the page you right-clicked or opened the extension on: it reads the selected text (with its line breaks), and shows the panel on the page where you pick what to send and where.
```

**Host permission** (content scripts on http(s)://localhost/* and http(s)://127.0.0.1/*)

```text
On pages you run on your own computer (localhost and 127.0.0.1 only), two content scripts record the page's errors from the moment it loads: console.error calls, uncaught errors, unhandled promise rejections and failed fetch calls. They stay in the page until you tick Console errors and add them to a session. Recording has to start when the page loads, so the errors from before you open the extension are there. No other site is matched.
```

### Remote code

No, I am not using remote code. Every script is bundled in the package. The panel on the page is a function from the
package, injected with `scripting.executeScript({ func })`.

### Data usage

Leave every category unticked, and tick the three certifications. The extension sends nothing off the computer: it
passes what you choose to the Seshboard app on the same computer over native messaging, and makes no network requests
of its own. This matches `data_collection_permissions: none` in the Firefox manifest. If that ever changes, change
both, and [PRIVACY.md](PRIVACY.md).

### Privacy policy URL

https://github.com/estruyf/seshboard/blob/dev/apps/browser-extension/PRIVACY.md (the link works once `dev` is pushed;
switch it to `main` after the release).

## Firefox Add-ons

### Reviewer notes

```text
The extension talks to the Seshboard desktop app (https://seshboard.app/, open source: https://github.com/estruyf/seshboard) through native messaging. Without the app, the panel and the popup say that Seshboard can't be reached, and how to connect it.

To try it: install Seshboard, open Settings › Browser extension, press Connect browsers. Then select text on any page, right-click › Send to Seshboard, and press Enter in the panel: the text shows as a chip in Seshboard's message box.

Console errors: open any page on http://localhost/ that logs console.error; the panel and the popup offer "Console errors (N)".

The code is bundled with Extension.js: see README-SOURCE.md in the source zip to build it again.
```

## Edge Add-ons

The Chromium zip, the same listing and the reviewer notes above.
