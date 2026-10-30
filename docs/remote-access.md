# Remote access

Remote lets a paired phone follow and steer Seshboard's sessions from anywhere: the session list with its status, the live transcript, sending or queueing a prompt (with images), answering a permission prompt, question or plan, stopping a turn, marking read and archiving, a finished turn's catch-up, the session's uncommitted changes and committing them, starting a session in a known project (with a Claude profile, model, effort, permission mode, worktree and branch of its own) or queueing one for later, and push notifications. Everything else (the terminal, pushing, pull requests, memory, settings, managing profiles, files as attachments) stays on the computer. Issue [#93](https://github.com/estruyf/switchboard/issues/93) started it; this note is the design as built. The page for people using the app is [website/src/content/docs/remote-access.mdx](../website/src/content/docs/remote-access.mdx).

Whoever controls a session can make Claude run commands on the computer. So a paired phone is treated like an SSH key: pairing needs you at the computer, every connection is authenticated both ways and encrypted end to end, and a phone can only do the few things above.

## The shape

```
phone browser ── https ──▶ seshboard.app/remote/   (the remote app, static, GitHub Pages)
      │
      └──── wss (Noise inside) ──▶ tunnel (Cloudflare, Tailscale, ngrok, your own) ──▶ 127.0.0.1:47615 (the engine)
```

- **The engine listens on `127.0.0.1` only.** Nothing on the network reaches it directly; a tunnel forwards to it.
- **A tunnel gives it an `https://` address.** Seshboard starts the tool, reads the address from what it prints, and restarts it with backoff when it stops (`packages/engine/src/remote/tunnel.ts`):

  | Tunnel | Command | Address |
  |---|---|---|
  | Cloudflare quick tunnel | `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>` | `https://*.trycloudflare.com`, new each start, no account |
  | Tailscale | `tailscale serve --https=443 http://127.0.0.1:<port>` (foreground) | `https://<mac>.<tailnet>.ts.net`, stable, tailnet only |
  | ngrok | `ngrok http http://127.0.0.1:<port> --log stdout --log-format json [--url https://<domain>]` | stable with the account's domain |
  | Custom | nothing: you run it | the `https://` address you enter |

- **The remote app comes from Seshboard's own site** (`REMOTE_APP_URL`), built from `apps/remote` into `website/public/remote/` by `npm run website:build`. One fixed HTTPS origin:
  - the phone's device key lives on one origin, so it pairs once, whatever tunnel or tunnel address the computer has;
  - the app's code comes from the site, not from the tunnel provider, who terminates TLS and could otherwise change it;
  - it is a secure context (installable, WebCrypto, service workers and push notifications).
- **The engine only accepts sockets whose `Origin` is the remote app's.** Browsers always send `Origin` on a WebSocket and a page can't fake it, so another site open on the phone or the computer can't reach the engine.
- **The app icon colourway** (Settings › Theme › App icon, `packages/protocol/src/appIcons.ts`) can't be served by the engine, which only speaks the socket. So every colourway's icons ship with the remote app (`public/app-icons/<key>/`, Graphite's where they always were), with a manifest each made from the app's own at build time (`appIconManifest`, in `vite.config.ts`). The engine says which one in `hello` (`appIcon`, Graphite while Use it on your phone too is off) and in `app.icon` when it changes; the app points its manifest, apple-touch-icon and favicon links there, with `?v=<key>`, and keeps the key for its next load (`src/lib/favicon.ts`). A Home Screen app keeps the icon it was added with.

### Why tunnels and not the local network

The first version listened on the local network. A page served from an HTTPS site can't open an unencrypted `ws://` socket to a LAN address (mixed content), and the computer can't get a trusted certificate for its LAN name; serving the app from the computer instead meant plain HTTP, a page whose JavaScript anyone on the network could change, and a new origin (a new pairing) for every address. Tunnels give an `https://` address that works from anywhere, so the app can live on one trusted origin. The cost is that the address is public (except Tailscale's): anyone who has it reaches the engine, and the handshake is what keeps them out.

**Tailscale** is the private choice: only your own devices on your tailnet can reach its address, and Tailscale's WireGuard is a second layer under Noise.

**ngrok's free plan** puts a warning page in front of browser requests unless a `ngrok-skip-browser-warning` header is sent, which a browser can't add to a WebSocket. It may not work for phones; Settings › Remote says so. Not verified yet.

### Development

`npm run dev:remote` serves the remote app at `http://localhost:5199/remote/`. Start the desktop app with `SESHBOARD_REMOTE_APP_URL=http://localhost:5199/remote/` and the engine accepts that origin and links straight to `http://127.0.0.1:<port>`, without a tunnel (`localhost` is a secure context, and `ws://` to the same computer isn't mixed content).

The website's preview (Cloudflare Pages, built from `dev`) serves the remote app at `REMOTE_PREVIEW_APP_URL` (`https://beta.seshboard.app/remote/`). Development builds (`npm run dev`), beta builds (`-beta.` versions) and releases whose update channel is Beta also accept sockets from its origin (`acceptsPreviewRemote` in main, sent to the engine as `remotePreview`; `remoteAppOrigins`), so the next remote app can be tried with a real tunnel: open the preview on the phone and paste the pairing link (it still points at the production app; only the part after `#` is used). Following the channel keeps a phone set up on the preview working when a beta's release is installed. A release on the Stable channel accepts only the production origin, so code that is only on `dev` can't reach the computer of anyone who didn't choose Beta; switching to Stable closes the phones connected through the preview. The preview has an origin of its own, so a phone pairs there apart from the production app.

**The move to seshboard.app.** The site moved from `switchboard.struyfconsulting.com` to `seshboard.app`, and the preview from `switch-dev.struyfconsulting.com` to `beta.seshboard.app`. A phone's pairing lives on the origin it paired on, so until 1.3.0 the engine also accepts sockets from the old addresses (`REMOTE_LEGACY_APP_URLS`, added by `remoteAppOrigins`), as long as the old sites still serve the remote app at `/remote/`. New pairing links point at the new site. In 1.3.0, remove `REMOTE_LEGACY_APP_URLS` and the old addresses' tests.

Without the desktop app, `node --experimental-transform-types scripts/remote-demo.ts` runs the real Remote hub against made-up sessions, prompts, a catch-up and changes, on port 47699, and allows every pairing by itself. It prints a pairing link for `npm run dev:remote`; a browser paired once stays paired across runs. It pushes for real, through the browser's push service.

## What we protect against

| Threat | Covered by |
|---|---|
| Someone who finds the tunnel's address connects | Only paired devices complete the handshake; an unknown key is refused before anything it sends is read |
| Someone photographs or intercepts the QR code | One-time, two-minute secret, plus **Allow** on the computer with a matching 6-digit code |
| The tunnel provider reads or changes traffic | Everything after the handshake is encrypted end to end (Noise); the provider sees ciphertext |
| The tunnel provider changes the app's code | The app comes from Seshboard's site, not through the tunnel |
| Someone replays recorded traffic | Fresh keys per connection and a counter nonce; a replayed or reordered frame closes the connection |
| Someone pretends to be the computer | The phone checks the engine's key from the QR code on every connection |
| A website open on the computer or the phone talks to the engine | `Origin` must be the remote app's; no cookies, no CORS; the engine listens on `127.0.0.1` |
| Hostile content in a transcript runs script in the remote app | Strict CSP (`script-src 'self'`), transcripts rendered as text (React escapes it), never HTML. `connect-src` allows `'self'` only so the app can read `version.json` (the build it would update to, `src/lib/update.ts`) on its own site |
| A paired phone does more than it should | Its own contract (`remoteContract`), validated with zod; only sessions the sidebar lists; no terminal, files or settings; Changes take a session id, never a path, and a diff only of a file the change list has; only the permission modes that still ask (`RemotePermissionMode`); commits never push; a branch to check out must be one of the project's local branches; a clone only from github.com, only while Clone from GitHub is on there, only into its Clone into folder, never over a folder that is there |
| A paired phone makes the engine send requests elsewhere | Push subscriptions must point at a browser push service (`isPushEndpoint`: Google, Mozilla, Apple, Microsoft) over HTTPS |
| The push service reads notifications | Payloads are encrypted for the phone's browser (RFC 8291, `aes128gcm`) and signed with the engine's VAPID key (RFC 8292) |
| A lost phone | **Revoke**, which closes its connections at once (also one still in its handshake); devices unused for 30 days expire |
| Someone guesses keys or pairing secrets | Keys are 256-bit; five failed pairings close pairing; failed handshakes back off per client address |

The backoff's client address is what the tunnel saw: Cloudflare's `CF-Connecting-IP` behind a Cloudflare tunnel (it overwrites it), else the last `X-Forwarded-For` entry (the one the tunnel added). Behind a tunnel every socket comes from `127.0.0.1`.

Behind one network every device has the same address, so a device that keeps failing (a revoked pairing in a second copy of the remote app, a computer paired before this one's Remote key changed) makes its address wait, and the count only goes back to zero when a handshake from the address works. A waiting address still gets its socket, but only a reconnect whose first message shows a paired device's key gets in (the `IK` message proves the key); a pairing is closed with 4429, and anything else is refused as usual without being counted. A paired device that gets in that way doesn't reset the count: it proved its own key, not the others'. Settings › Remote shows the addresses waiting now (`RemoteStatus.blocked`, from `Backoff.blocked`) with **Unblock** (`remote.unblock`), which clears them as a restart did.

A reconnect whose first message doesn't decrypt was made for another engine key: a device paired before this computer's identity changed (the rename to Seshboard made a new one where the old keychain item couldn't be read). The engine closes it with 4403, pair again, which the remote app and Seshboard on another computer stop on; before, 4400 made them retry forever and kept their address waiting. Both clients also treat a 4400 during a reconnect's handshake (from an older engine), or an answer that doesn't decrypt, as 4403.

### The log

Remote writes `remote.log` in the data folder (`remoteLog.ts`, `REMOTE_LOG_FILE`; moved to `remote.log.1` past 1 MB), next to the windows' log: Remote turning on and off, every refused socket with its reason, address, origin and kind of device (a refused key names the device it was paired as, and when it was revoked), each wait starting, the first socket turned away during it, the address getting in again, and each connection and disconnection with its close code. A socket that sends nothing within five seconds is logged but not counted. **Show in Finder** in Settings › Remote › Advanced opens it (`showRemoteLog` in main, a fixed path).

## The channel

The encryption is done in the app with audited pure-JS primitives (`@noble/curves` X25519, `@noble/ciphers` ChaCha20-Poly1305, `@noble/hashes` SHA-256), shared by the engine and the remote app in `packages/protocol/src/remoteNoise.ts`. It doesn't depend on TLS, so it holds whatever the tunnel does. A test checks both handshakes against the cacophony Noise test vectors byte for byte.

### Images

A phone sends images with `session.send` (and `session.create`, and files too, when `hello` says `attachments`: `apps/remote/src/components/Attachments.tsx`, planning in `lib/attachments.ts`), never on their own. The remote app redraws each as a JPEG of at most 2,000px on its longest side at 0.8, and smaller or rougher until it fits `REMOTE_IMAGE_BYTES` (`apps/remote/src/lib/images.ts`), so four fit in one RPC line (the engine takes lines up to 4 MB, `remoteServer.ts`). The frame limit stays as it is: the channel already splits a long line into 60,000-byte frames and the line transport puts it back together.

### Files

Another computer (`computers/RemoteAttachments.tsx`) also sends files with `session.send` and `session.create`, as they are: up to `REMOTE_MAX_FILES`, with the images at most `REMOTE_ATTACHMENT_BYTES` of base64 together so the line stays under 4 MB (`checkAttachments` refuses more). The engine writes them to a folder of their own per message under `<dataDir>/remote-files` (`remoteFiles.ts`), with names that can't leave it, and adds them to the prompt as a line of `@` mentions, as the message box does with dropped files: Claude reads them itself. Folders older than 30 days go when Remote starts. `session.create` takes images too. `hello` says `features: ['attachments']`; the windows send files, and images to `session.create`, only to a computer that says it, since an older one drops unknown params without a word.

### Framing (`remoteChannel.ts`)

1. The phone's first WebSocket frame: `0x53`, the protocol version, the mode (1 pair, 2 connect), then Noise's first message.
2. The engine's answer: Noise's second message.
3. Every frame after that is one ChaCha20-Poly1305 ciphertext of up to 60,000 bytes of the RPC's text lines (`lineTransport`). The nonce is a counter that is never sent: a dropped, replayed, reordered or changed frame doesn't decrypt, and the connection closes on the first one.

The prologue binds the handshake to Seshboard, the version and the mode (`switchboard-remote/1/pair`).

### Links

The QR codes open the remote app with everything after `#`, which a browser never sends in a request, so the site never sees it. The app takes it out of the address bar at once.

- `#p.<engine key>.<secret>.<engine address>`: **Pair a device**.
- `#c.<engine key>.<engine address>`: **Reconnect a paired device**, after a quick tunnel got a new address. No secret: it only tells a phone paired with that key where the computer is now.

The engine address must be `https://` (or `http://` on `localhost`/`127.0.0.1`, for development).

A link can also be pasted in (`LinkEntry`, `pastedLink`): on the welcome screen, after a bad link or a failed pairing. iOS gives a Home Screen app its own storage, apart from Safari's, and no address bar, so a pairing done in Safari never reaches it. In Safari on iOS, the pairing screen offers **Copy link** (the same `#p.…` link) to pair the Home Screen app instead.

### Pairing: `Noise_IKpsk2_25519_ChaChaPoly_SHA256`

- **Pair a device** makes a 128-bit secret, good for one use and two minutes. Closing the dialog cancels it.
- The phone makes its X25519 device key and keeps it in IndexedDB, on the remote app's origin.
- The phone already knows the engine's static key (`IK`), and the secret (stretched to 32 bytes with SHA-256) is the pre-shared key (`psk2`). The phone knows the engine is real once the second message decrypts; the engine knows the phone scanned the code once the phone's first frame decrypts. Only then is the secret used up, and only then may the phone ask `pair.request` with its name.
- Both sides show 6 digits from the handshake hash. Someone in the middle would see other digits.
- The device is stored only after **Allow**. **Deny**, 60 seconds, a closed dialog or the phone going away throw it away.

### Every connection after that: `Noise_IK_25519_ChaChaPoly_SHA256`

The engine reads the phone's static key from the first message and refuses an unknown, revoked or expired one before writing anything back (close code 4403: pair again). The phone counts as connected once its first frame decrypts, which proves it holds the device key; the engine checks the key again then, so a phone revoked during its handshake is refused too.

WebSocket close codes: 4400 refused, 4403 unknown device (or a key for another engine identity: pair again), 4410 pairing closed, 4426 another protocol version, 4429 a pairing from an address that waits.

## The code

| Where | What |
|---|---|
| `packages/protocol/src/remote.ts` | The remote contract (what a phone may ask), the pairing contract, Settings › Remote's schemas, `REMOTE_APP_URL` |
| `packages/protocol/src/remoteNoise.ts`, `remoteChannel.ts` | The handshakes, the framing, the links |
| `packages/protocol/src/remoteClient.ts` | The remote app's entry (`@seshboard/protocol/remote-client`): no zod |
| `packages/engine/src/remote/devices.ts` | `remote_devices` (migration v24): name and public key only |
| `packages/engine/src/remote/pairing.ts` | The one-time secret, the attempt limit, Allow or Deny |
| `packages/engine/src/remote/remoteServer.ts` | The socket on `127.0.0.1`, the origin check, the handshakes, the backoff |
| `packages/engine/src/remote/tunnel.ts` | Finding, starting and reading the tunnel tools |
| `packages/engine/src/remote/remoteView.ts` | What a phone sees: project ids and names instead of folders, prompts without the fields only the computer uses, transcripts without images |
| `packages/engine/src/remote/remoteHub.ts` | Settings › Remote, the tunnel's lifecycle, and each remote request mapped to the engine's own functions |
| `apps/desktop/src/main/remoteIdentity.ts` | The engine's identity key, encrypted with `safeStorage`; asked for only once Remote is on |
| `apps/ui/src/components/remote/` | Settings › Remote, the pairing dialog with the QR code and Allow |
| `packages/engine/src/remote/webPush.ts` | Web Push without a library: the VAPID key pair and JWT, the payload encryption (checked against RFC 8291's example), sending |
| `packages/engine/src/remote/pushEvents.ts` | When a phone gets a push (a prompt opens, a turn ends) and what it says |
| `packages/engine/src/remote/computerName.ts` | The computer's name for the phone (macOS: the Sharing name) |
| `apps/remote/src/lib/computers.ts`, `lib/storage.ts`, `lib/push.ts` | The connections to every paired computer, the pairings and the phone's push key, one subscription for all |
| `apps/remote` | The remote app; `public/sw.js` is its service worker, which only shows notifications. A phone has one home, the first screen (`SessionList.tsx` in `phone` mode: a header with the round menu button, the computer's name, search and `⋯`, each profile's plan usage, `Usage.tsx`, rows edge to edge and a floating New session that hides while you scroll down, `lib/fab.ts`); a `home` history entry shows it too. In drawer mode every screen has the menu button (`DrawerButton`); the drawer has the search, the places (`lib/drawer.ts`), Recent and, at its bottom, Settings and the computer (`ComputerRow`). Home's `⋯` has the quick settings (`lib/more.ts`), and Settings is a page (`SettingsView.tsx`, the `settings` route) with Appearance (Theme, its colours and Text size, `lib/textSize.ts`), Notifications, the computers, Disconnect and Forget, and About. A session on a phone has a round `⋯` with Ask about this session, Changes and Copy the last reply; its catch-up titles what you asked (`lib/promptTitle.ts`: the prompt's first heading, else its first sentence), and the message box is one box with the model and mode in one chip (`ModelModeChip`). New session on a phone has the project as one row, one Options row that sums up the choices (`lib/newOptions.ts`) with the pickers as rows of a sheet (`ChoiceChip`'s `look="row"`), and Start as a floating pill. Wide screens keep the chips and tiles. On a wide screen (768px and more) the list is a sidebar next to the home view (`Home.tsx`), with the ⌘K palette (`Palette.tsx`, ranking in `lib/palette.ts`) and one key handler in `Connected.tsx` (`lib/keys.ts`) |

The remote contract is not the app's contract: remote handlers call engine functions one by one, so a new method in `contract.ts` never becomes reachable from a phone. A test lists its methods. A phone can only read or act on sessions its list shows (the sidebar's, outside Archived).

### The methods

| Method | What it does |
|---|---|
| `hello` | The first request: the app's version, the device, and the computer's name |
| `sessions.list`, `projects.list` | The list (with `unread`, `pinned`, and a running session's model, effort and mode) and the projects you added |
| `projects.branches` | A project's local branches, the one checked out and those checked out in another worktree, read from git each time (`hello` says `branches`) |
| `projects.clonePlan`, `projects.clone`, `projects.cancelClone` | Clone from GitHub on the computer (`hello` says `projects.clone`): where a clone of a GitHub URL would go in its Clone into folder (`off` while its setting is off), the clone itself (added as a project there), and Cancel. Job ids are the device's own (`remote:<device>:<job>`), and `projects.cloneProgress` reports to that connection only, with the project's id, never its folder. What the repository brings (hooks, MCP servers, rules) comes with `done`, for the trust question the app asks before Start |
| `transcript.get`, `transcript.watch`, `transcript.unwatch` | A transcript's pages and live updates, for one session at a time |
| `session.send`, `session.queue.remove`, `session.queue.sendNow`, `session.interrupt`, `session.respond` | Send, steer, send now or queue (`mode`, with up to `REMOTE_MAX_IMAGES` images, each at most `REMOTE_IMAGE_BYTES` of base64, and up to `REMOTE_MAX_FILES` files), take from Up next, send one from Up next now (stopping the turn; with `session.queue.sendNow` in `hello`'s features), stop, answer a prompt |
| `session.create`, `later.add` | Start a session, or queue one, in a project you added; `model`, `effort`, `permissionMode` and `worktree` left out are the project's defaults. `checkoutBranch` (with `branches`) checks out a local branch in the project's folder first, as New session's branch on the computer: only one `projects.branches` lists and no other worktree has, never with a worktree, and refused while a session works in that checkout; git keeps uncommitted changes or refuses |
| `session.markRead`, `session.markUnread`, `session.setFlags` | Read, as opening it on the computer, or unread again (Undo after a swipe, with the `session.markUnread` feature); pin or archive. An archived session leaves the phone's list, so nothing may touch it any more, except the unarchive (Undo) of a session that phone archived in the last 10 minutes |
| `session.setModel`, `session.setEffort`, `session.setPermissionMode` | A running session's model, effort and mode; modes are `default`, `acceptEdits`, `plan` and `auto` only |
| `options.get` | New session's choices: the models, efforts, modes, each project's defaults, and whether Auto model is on with the models it may pick (`model: 'auto'` then goes to `session.create` and `later.add` as is). `providers` lists the providers besides Claude Code that are allowed there and can start sessions (GitHub Copilot), with their own modes |
| `providers.ready` | Whether one of `options.get`'s providers can start a session now, and its models: its CLI's own install or sign-in message (never a credential), else its model names. Asking starts the provider's runtime on the computer, with the computer's own login. `session.create` with `provider` starts a session with it, only one listed, in one of its modes (`model` and `permissionMode` are its own; Claude Code's profile, effort, worktree and branch don't apply) |
| `session.ask`, `session.askThreads` | Ask about this session, through the engine's `Asker` (read-only tools, nothing in the transcript), and the threads it keeps |
| `limits.get`, `limits.resume`, `limits.arm` | How a session stands with its profile's plan usage limit (`RemoteLimitStanding`: whether it stopped the session, the limit's kind and reset, when an armed resume sends; never the profile's id), Resume now, and Resume when it resets on or off (`hello` says `limits`). Only for sessions the list shows; `limits.changed` follows each change for the watched session |
| `usage.get` | Every profile's plan usage (its name and colour, never its account), the default first; from the engine's `UsageMonitor`, checked again when older than a minute or with `refresh` |
| `usage.tokens` | Where an account's tokens went in a period, as `usage.breakdown` (`hello` says `usage.tokens`). The caller sends the account's `accountKey` (SHA-256 of its email and organization, `packages/protocol/src/accountKey.ts`), so only someone who knows the account can ask and the answer never names it; the engine answers for the profile signed in to it (the default first), or `null`. Projects come as an id and a name (`remoteUsage`), never a folder; session titles are included |
| `usage.sessionCost` | A session's estimated API cost since it started, in US dollars (`hello` says `costs`): numbers only, and only for a session the list shows (`checkSession`, as `catchup.get`) |
| `usage.windowCosts` | The estimated API cost of the plan windows the caller names (kind, scope and start, at most 10), for the profile signed in to an account, with its `accountKey` as in `usage.tokens`, or `null` (`hello` says `costs`). Numbers only: no session, project or folder |
| `catchup.get` | A session's catch-up, without paths outside its checkout |
| `changes.get`, `changes.diff`, `changes.commit` | The session's uncommitted changes, one file's diff (at most 2,000 lines), and a commit of everything without a terminal (the last lines of the output when a hook fails) |
| `push.key`, `push.subscribe`, `push.unsubscribe` | The engine's VAPID public key, and this device's subscription with its switches (Needs you, Finished). With `push.vapid` in `hello`, `push.subscribe` also takes the device's own VAPID key pair (`vapid`, checked to be a pair) and `label` (see More than one computer) |
| `device.visibility` | Whether the app is on the device's screen: no push while it is |
| `theme.get` | The theme the app shows, resolved there (`remote.setTheme` from the main window), every token of both modes, colours only (`RemoteTheme`); `null` before a window sent one (`hello` says `theme`). Kept in app state (`remote.theme`), so it is there before a window opens |

Events: `sessions.changed`, `usage.changed` (a profile's new check), `theme.changed` (another theme picked, or the one in use edited), `session.ask` (to phones watching the session and to the phone that asked, until the answer ends), `projects.cloneProgress` (to the connection that started the clone), and for the watched session `transcript.updated`, `session.stream`, `upNext.changed`, `limits.changed` and `catchup.changed`.

### Push notifications

The engine sends Web Push itself (`webPush.ts`), without a library or a server of Seshboard's: it keeps a VAPID key pair in its app state (`remote.vapid`, made the first time a phone asks), and each device's subscription (`remote.push`). It pushes when a prompt opens in a session the phone lists, and when a turn ends (a session it runs goes from working to idle), after waiting up to eight seconds for the turn's catch-up so the line can say "14 tests passed · ~2 min to review". A device with the app on screen (`device.visibility`) gets none. A push service that answers 404 or 410 drops the subscription; revoking a device does too.

The payload is the kind, the session id, its title and project, one line, and the `deviceId` of the device it goes to (and `computer`, the device's `label`, when it gave one); a tool prompt adds its `requestId` and `answers: true` (`promptAnswers`: not for a question or a plan, which need their session). It is encrypted for the browser, so the push service only carries ciphertext; the computer has to reach the push services over HTTPS. The remote app's service worker (`public/sw.js`, allowed by `worker-src 'self'`) shows it and opens the session on a tap (`?s=<id>`, or a message to a page already open). iOS only allows push for a page added to the Home Screen, and shows no buttons on notifications.

Where the browser shows buttons (`Notification.maxActions`: Chrome, Edge and Firefox on a computer), a tool prompt's notification has **Deny** and **Allow**. The answer is never in a URL, so a link can't answer for you: the service worker posts it to a page that is open, or opens one and keeps the answer (and itself, through `waitUntil`) until that page asks for it with `take-answer`, for at most 30 seconds. The page answers only after a fresh `sessions.list` shows the prompt still open, and says "Already answered" otherwise.

Nothing listens until Remote is on: off by default, and started at launch (with its tunnel) only when it was on when the app quit.

## More than one computer

A phone can be paired with several computers (`apps/remote/src/lib/computers.ts`). Each pairing is its own `Paired` in IndexedDB, keyed `computer:<engine key in hex>` (`lib/storage.ts`; the one pairing an older version kept under `current` moves over the first time), with its own device key. Pairing a computer again replaces its pairing; another computer is added. **Pair another computer…** in the computer's menu opens the same paste-a-link screen as the welcome.

- **Every computer stays connected.** `Computers` keeps one `Connection` per pairing, with its own backoff and Disconnect (per computer in sessionStorage), and keeps each connected computer's `sessions.list` up to date through `sessions.changed`, cached per computer for the tab. Every connected computer is asked for usage (`useUsages`, cached per computer) and told `device.visibility`, since all their sessions are on screen; only the computer of the open session watches its transcript and Ask.
- **One list for every computer.** `Connected` is one view for all of them. `lib/everywhere.ts` merges their lists: a session's `id` (a prompt's `requestId` and `sessionId`) becomes its key in the list, `<computer>:<id>`, since two computers can have the same ids, and it keeps its own ids (`sessionId`, `original`) for the calls to its computer. The groups, filters, palette, Home and ⌘⇧U work on the merged list; with more than one computer, rows, cards, the palette and a session's header show a `ComputerTag` (neutral, not violet: here every session is on another computer). A session and New session belong to one computer: their route (and history entry) carries `computer`, so the open view, Back and a reload stay on it, and the one on screen becomes `lastComputer`. With more than one computer, the list's title is **Sessions** and a `ComputerChip` per computer (`strip`) has its own menu (Disconnect or Connect, Forget); Pair another computer is on the Settings page (and the sidebar's `⋯` on a wide screen), and the computer's own menu (Home's title, the drawer's computer row) has Switch to for each of the others. A computer that isn't connected keeps its rows, dimmed, with its own banner (`UnpairedBanner` when it refused the phone), and isn't counted in what needs you. New session has **Run on** (`runOnDefault`: the one asked for, else the one it started on last, `lastRunOn`, while connected, else a connected one); switching keeps the prompt and attachments and loads that computer's projects and defaults. Usage merges into one list (`mergeUsage`), each profile named after its computer.
- **Notifications from all of them.** A browser keeps one push subscription per VAPID key, so each computer's own key would take the subscription from the others. The phone makes its own P-256 key pair with WebCrypto (`push-key` in IndexedDB) and gives it, with the subscription, to every computer whose `hello` has `push.vapid` (`REMOTE_FEATURE_PUSH_KEY`); they sign their pushes with it (`PushEntry.vapid`), and one subscription gets them all. An older computer keeps its own key while it is the only one paired, and gets no subscription next to others (`pushKeyFor`); Notifications names it. With more than one computer, the phone sends `label`, the computer's name, which each push carries as `computer` and the service worker puts first. The push's `deviceId` is the id that computer gave the phone, so a tap opens `?s=<session>&d=<device>` on the right computer, and Deny or Allow answer there. The phone's private key goes only to computers it is paired with, which can push to it anyway; forgetting a computer throws the key and the subscription away and gives new ones to the computers that stay (one not connected gets them when it connects), so the forgotten one can't push any more.

- **One theme for all of them.** The phone can look like one of its computers (Settings › Appearance on a phone; **Theme** in the sidebar's `⋯` menu and the palette on a wide screen, `ThemeSheet`). Each computer whose `hello` has `theme` (`REMOTE_FEATURE_THEME`) gives its theme with `theme.get` and `theme.changed`; `Computers` keeps it per computer (`theme` on `Computer`, in localStorage), so it shows while that computer is offline. The phone shows one theme for every computer, not the one on screen: the list has every computer's sessions, and the colours would change on each switch. By default it is the first computer that sent a theme (`themeComputer`), not simply the first one paired: a pairing that never connects again would keep the phone in Demo Time. A forgotten one falls back the same way, and **Demo Time** (`OWN_THEME`) keeps the phone's own look. **Sync now** asks every connected computer for `theme.get` again (`Computers.syncThemes`). The phone takes only the tokens its styles.css has (`PHONE_TOKENS`, `edge` from `overlay-border`) and only values `COLOR_PATTERN` reads (`cleanTheme`), builds the overlay shadow as the app does (`overlayShadow`, in the protocol), and puts them on `<html>`'s style for the mode shown (`themeApply.ts`: the CSP allows no `<style>` of its own), with the `theme-color` tags. **Appearance** is Match System (Auto on the Settings page and in Home's `⋯`), Light or Dark (localStorage); Light or Dark puts `data-mode` on `<html>`, which styles.css reads for Demo Time's tokens (the dark ones twice, in the media query and under `[data-mode='dark']`; a test keeps them equal), and both `theme-color` tags take that mode's background. The one on screen is kept too, so a launch paints with it before anything connects.

## Settings › Remote

The page is laid out for daily use: the switch on the title's row, a status card (`apps/ui/src/components/remote/remoteStatusView.ts` picks its title, line and buttons from `RemoteStatus`, and its tests cover every state), Paired devices, the Connection (folded once Remote runs; a draft until **Save and restart**), and Advanced (the port and the security note). With Remote off and nothing paired, three setup steps replace it.

- **The fix for each problem**: a `port-in-use` problem carries `suggestedPort`, the next port free when Remote tried (`freePort.ts`), for **Use port …**; a missing tool offers its download page and Cloudflare instead.
- **Rename**: `remote.rename` stores a device's name (`DeviceName`, 1 to 60 characters).
- **What a device is**, for its icon: `kind` is `computer` for `REMOTE_DESKTOP_ORIGIN`, else `phone` or `browser` from the user agent when it paired. A label, never what lets it in.
- **Address changed**: each device keeps the engine's address it last connected through (`last_address`). `RemoteStatus.addressChanged` is true while a quick tunnel (Cloudflare, ngrok without a domain) runs at an address no paired device has used yet, so the card offers **Reconnect a paired device** (the connect link) only when it is needed.
- **Connected to this Mac**: the sidebar's footer above the Computers strip (`apps/ui/src/components/remote/ConnectedDevices.tsx`, pure logic in `state/connectedDevices.ts`). Remote's status lives in one store per window (`state/remoteStore.ts`, filled by `useRemoteSync`), which Settings › Remote reads too. The rows are `connections` joined with `devices`, one per device with its earliest `since`. Each device's last action comes from `remote.fromDevice`, which carries `deviceId` (and `device`, its name, for older callers) and, for an answer, `answer` with the tool and whether it was allowed. That history is kept in memory only. The "connected" toast shows once per device per day (the day in `localStorage`), never within five minutes of pairing.
- **Scripted runs** (the smoke test, the screenshots, a driven app) get throwaway keys made in memory instead of the keychain's (`throwawayRemoteKey`), since they use throwaway profiles and some point HOME at a made-up folder.

## Other computers

Seshboard on another computer pairs with Remote as a phone does, and shows its sessions next to the local ones. The engine is the client (`packages/engine/src/remote/computerLink.ts`): the same pairing link (pasted, not scanned), the same `Noise_IKpsk2` and `Noise_IK` handshakes, framing and remote contract, from Node with `ws`. Nothing about what a paired device may do changes: the other computer is one more device in Settings › Remote, limited to `remoteContract`, and **Revoke** cuts it off.

- **One device key per install**, made the first time it pairs, kept like the identity key (`safeStorage`, `remote-device.bin`; `apps/desktop/src/main/remoteIdentity.ts`). `remote_computers` (migration v28) has the other computers' public keys, addresses and the ids they gave this one, never a secret. Entries are kept by the other computer's key, so pairing one again after its Remote key changed would add a second entry; a new pairing replaces the entries at the same address (`sameAddress`, the origin) instead, whose old key would only be refused there.
- **Origin.** It sends `REMOTE_DESKTOP_ORIGIN`, which the server accepts next to the remote app's. A browser page can't send it, so it doesn't widen what a website can reach; it isn't a lock either (any program can send any `Origin`). The handshake is. The server stores a device paired from that origin with `kind: 'computer'`, for its icon in Settings › Remote.
- **Connection.** One per paired computer, kept by the engine: a ping every 20 seconds notices a computer that went to sleep, and it reconnects with backoff up to a minute, without giving up. Close code 4403 stops it (`unpaired`).
- **The windows** reach a computer only through `computers.call`, with `COMPUTER_METHODS`: the remote contract without `hello`, push and `device.visibility`. The other computer validates the params; the results are shown as text (`components/computers/RemoteText.tsx`: no file links, no Run, no images loaded). Its events come as `computers.event`.
- **No loops.** A computer only ever serves its own sessions; the ones it shows from another computer are not in its list, so pairing both ways shows each computer's own sessions once.
- **One sidebar.** Each computer's last `sessions.list` becomes rows of the normal sidebar (`apps/ui/src/state/remoteRows.ts`), with the same status rules as that computer's list (an open prompt is needs you), in the same groups, search, ⌃⇥ and ⌘⇧U. A remote row's id is `remote:<computer>:<session>` (`remoteSelection.ts`), and that id is a remote session's leaf in the panes, so it tiles beside local and other remote sessions (`RemotePane`); `localSessionId` keeps it away from this computer's engine, hosts and terminal. A row only offers what the contract has: Open, Pin and Archive (`session.setFlags`), Copy title, and New session in its project. An offline computer keeps its last list, dimmed, and `lastSeen` (from the hub: when its connection last ended) says since when; a forgotten computer's rows go. The Computers strip and "Show sessions from" filter by computer, per window.
- **The same session view** (`RemoteSessionView.tsx`): the local header, column, permission card (with its keys) and message box, with the computer's chip and a 2px violet line. While the session runs in Seshboard there, its model, effort and mode chips change them with `session.setModel`, `session.setEffort` and `session.setPermissionMode`; its profile shows, but stays. The transcript stays `RemoteText`; consecutive tool calls fold into one line (`toolsSummary`). Changes, the terminal, the editor and pull requests are disabled, with the reason as a tooltip.
- **New session on another computer** (`RemoteNewSession.tsx`): Run on picks the computer; its `projects.list` gives the tiles, `session.create` starts the session, and profile, model, effort, mode and worktree show only when `options.get` answers; on the current checkout, the branch chip shows when `hello` has `branches` (`projects.branches`, sent as `checkoutBranch` only when it differs from what is checked out) (an older Seshboard there has no `options.get`, so the start sends only the project and the prompt). They resolve as in the remote app (`remoteNewSession.ts`): the project's defaults, then its profile's, and only what you change is sent. The chips are `RemoteChips.tsx`. Images and files go with the prompt to a computer whose `hello` has `attachments` (see Files). With Clone from GitHub on here, the clone form clones there (`projects.clone`, when its `hello` has `projects.clone`; an older one is asked to update), in that computer's Clone into folder, and Start waits for it, asks about what the repository brings, then starts in the new project there. Folders there can't be picked, and Quick question, the queue and the focus limit are this computer's.
- **Its tokens in Usage** (`components/usage/useUsageData.ts`, `usageMerge.ts`): with All computers chosen, the Usage view asks each connected computer whose `hello` has `usage.tokens` for the same account's breakdown, every minute, and adds it to this computer's. Session and Project rows stay apart per computer (keyed `<computer>:<key>`, with its chip and the project's id and name instead of a folder); Model and Day rows add up; Computer is a grouping made from each computer's totals. Shares are split again over every row with `sharesOf`: a measured share stays, since plan % counts every computer already, and the rest goes by weight. A computer that is offline, too old, has no profile on the account or fails is listed as not counted, with why.
- **Its costs** (`usage/useWindowCosts.ts`, `usage/SessionCost.tsx`): the usage bars and the Limits cards ask each connected computer whose `hello` has `costs` for the cost of the same plan windows (`usage.windowCosts`, with the starts this computer's plan gave, since the windows are the account's) and add it up; the tooltip says which computers count and why others don't. A session on another computer shows its cost under the message box from `usage.sessionCost` there.
- **Not built yet:** Changes and Commit, Ask, plan usage, notifications for its sessions, projects matched across computers, and more than one window watching different sessions there (the remote contract watches one transcript per connection).

| Where | What |
|---|---|
| `packages/protocol/src/computers.ts`, `computerConstants.ts` | The status schemas, the methods a window may call, the origin |
| `packages/engine/src/remote/computerLink.ts` | Dialing, pairing, the connection and its backoff |
| `packages/engine/src/remote/computerHub.ts`, `computerStore.ts` | Paired computers, their state and wording, passing calls and events on |
| `apps/ui/src/state/remoteRows.ts`, `remoteSelection.ts`, `computersStore.ts`, `runOnStore.ts` | Remote sessions as sidebar rows, the selection, the filter by computer, Run on |
| `apps/ui/src/components/computers/` | Settings › Other computers, the Computers strip, the remote session view, New session on another computer, a computer's page |

## Known limits

- With every tunnel but Tailscale, the address is public; the handshake keeps everyone else out, but they can try. Pairing closes after five wrong secrets.
- The device key in IndexedDB can be read by script on the remote app's origin. The origin serves only the app, under a strict CSP. Non-extractable WebCrypto keys would need X25519 in WebCrypto, which phones' browsers don't all have yet.
- Someone with your unlocked phone has access until you revoke it.
- A tunnel tool left running after a crash of Seshboard keeps forwarding to a closed port until it is stopped.
- Not built yet: see Phase 2 below, and caching the app for offline starts.

## Phase 2

- **Cloudflare Access (Zero Trust) in front of the tunnel.** A named Cloudflare tunnel on your own domain, with an Access login before anyone reaches the handshake. Access works with a cookie on the tunnel's hostname, which a browser doesn't send on a cross-site WebSocket (Safari blocks cross-site cookies outright), so the remote app has to come from that same hostname. Plan: an option under **My own address**, "Open the remote app from this address": the engine serves the built remote app itself (shipped inside the desktop app), accepts its own public origin next to `REMOTE_APP_URL`, and the QR codes point there. Pairing stays required underneath: Access is the outer lock, the device key the inner one. Optionally the engine checks Access's signed `Cf-Access-Jwt-Assertion` header too.
- The device label in the computer's own transcript, an indicator outside Settings while a phone is connected, and "Keep this Mac awake".
