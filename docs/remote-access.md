# Remote access

Remote lets a paired phone follow and steer Switchboard's sessions from anywhere: the session list with its status, the live transcript, sending or queueing a prompt (with images), answering a permission prompt, question or plan, stopping a turn, marking read and archiving, a finished turn's catch-up, the session's uncommitted changes and committing them, starting a session in a known project (with a Claude profile, model, effort, permission mode and worktree of its own) or queueing one for later, and push notifications. Everything else (the terminal, pushing, pull requests, memory, settings, managing profiles, files as attachments) stays on the computer. Issue [#93](https://github.com/estruyf/switchboard/issues/93) started it; this note is the design as built. The page for people using the app is [website/src/content/docs/remote-access.mdx](../website/src/content/docs/remote-access.mdx).

Whoever controls a session can make Claude run commands on the computer. So a paired phone is treated like an SSH key: pairing needs you at the computer, every connection is authenticated both ways and encrypted end to end, and a phone can only do the few things above.

## The shape

```
phone browser ── https ──▶ switchboard.struyfconsulting.com/remote/   (the remote app, static, GitHub Pages)
      │
      └──── wss (Noise inside) ──▶ tunnel (Cloudflare, Tailscale, ngrok, your own) ──▶ 127.0.0.1:47615 (the engine)
```

- **The engine listens on `127.0.0.1` only.** Nothing on the network reaches it directly; a tunnel forwards to it.
- **A tunnel gives it an `https://` address.** Switchboard starts the tool, reads the address from what it prints, and restarts it with backoff when it stops (`packages/engine/src/remote/tunnel.ts`):

  | Tunnel | Command | Address |
  |---|---|---|
  | Cloudflare quick tunnel | `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>` | `https://*.trycloudflare.com`, new each start, no account |
  | Tailscale | `tailscale serve --https=443 http://127.0.0.1:<port>` (foreground) | `https://<mac>.<tailnet>.ts.net`, stable, tailnet only |
  | ngrok | `ngrok http http://127.0.0.1:<port> --log stdout --log-format json [--url https://<domain>]` | stable with the account's domain |
  | Custom | nothing: you run it | the `https://` address you enter |

- **The remote app comes from Switchboard's own site** (`REMOTE_APP_URL`), built from `apps/remote` into `website/public/remote/` by `npm run website:build`. One fixed HTTPS origin:
  - the phone's device key lives on one origin, so it pairs once, whatever tunnel or tunnel address the computer has;
  - the app's code comes from the site, not from the tunnel provider, who terminates TLS and could otherwise change it;
  - it is a secure context (installable, WebCrypto, service workers and push notifications).
- **The engine only accepts sockets whose `Origin` is the remote app's.** Browsers always send `Origin` on a WebSocket and a page can't fake it, so another site open on the phone or the computer can't reach the engine.

### Why tunnels and not the local network

The first version listened on the local network. A page served from an HTTPS site can't open an unencrypted `ws://` socket to a LAN address (mixed content), and the computer can't get a trusted certificate for its LAN name; serving the app from the computer instead meant plain HTTP, a page whose JavaScript anyone on the network could change, and a new origin (a new pairing) for every address. Tunnels give an `https://` address that works from anywhere, so the app can live on one trusted origin. The cost is that the address is public (except Tailscale's): anyone who has it reaches the engine, and the handshake is what keeps them out.

**Tailscale** is the private choice: only your own devices on your tailnet can reach its address, and Tailscale's WireGuard is a second layer under Noise.

**ngrok's free plan** puts a warning page in front of browser requests unless a `ngrok-skip-browser-warning` header is sent, which a browser can't add to a WebSocket. It may not work for phones; Settings › Remote says so. Not verified yet.

### Development

`npm run dev:remote` serves the remote app at `http://localhost:5199/remote/`. Start the desktop app with `SWITCHBOARD_REMOTE_APP_URL=http://localhost:5199/remote/` and the engine accepts that origin and links straight to `http://127.0.0.1:<port>`, without a tunnel (`localhost` is a secure context, and `ws://` to the same computer isn't mixed content).

Without the desktop app, `node --experimental-transform-types scripts/remote-demo.ts` runs the real Remote hub against made-up sessions, prompts, a catch-up and changes, on port 47699, and allows every pairing by itself. It prints a pairing link for `npm run dev:remote`; a browser paired once stays paired across runs. It pushes for real, through the browser's push service.

## What we protect against

| Threat | Covered by |
|---|---|
| Someone who finds the tunnel's address connects | Only paired devices complete the handshake; an unknown key is refused before anything it sends is read |
| Someone photographs or intercepts the QR code | One-time, two-minute secret, plus **Allow** on the computer with a matching 6-digit code |
| The tunnel provider reads or changes traffic | Everything after the handshake is encrypted end to end (Noise); the provider sees ciphertext |
| The tunnel provider changes the app's code | The app comes from Switchboard's site, not through the tunnel |
| Someone replays recorded traffic | Fresh keys per connection and a counter nonce; a replayed or reordered frame closes the connection |
| Someone pretends to be the computer | The phone checks the engine's key from the QR code on every connection |
| A website open on the computer or the phone talks to the engine | `Origin` must be the remote app's; no cookies, no CORS; the engine listens on `127.0.0.1` |
| Hostile content in a transcript runs script in the remote app | Strict CSP (`script-src 'self'`), transcripts rendered as text (React escapes it), never HTML |
| A paired phone does more than it should | Its own contract (`remoteContract`), validated with zod; only sessions the sidebar lists; no terminal, files or settings; Changes take a session id, never a path, and a diff only of a file the change list has; only the permission modes that still ask (`RemotePermissionMode`); commits never push |
| A paired phone makes the engine send requests elsewhere | Push subscriptions must point at a browser push service (`isPushEndpoint`: Google, Mozilla, Apple, Microsoft) over HTTPS |
| The push service reads notifications | Payloads are encrypted for the phone's browser (RFC 8291, `aes128gcm`) and signed with the engine's VAPID key (RFC 8292) |
| A lost phone | **Revoke**, which closes its connections at once (also one still in its handshake); devices unused for 30 days expire |
| Someone guesses keys or pairing secrets | Keys are 256-bit; five failed pairings close pairing; failed handshakes back off per client address |

The backoff's client address is what the tunnel saw: Cloudflare's `CF-Connecting-IP` behind a Cloudflare tunnel (it overwrites it), else the last `X-Forwarded-For` entry (the one the tunnel added). Behind a tunnel every socket comes from `127.0.0.1`.

## The channel

The encryption is done in the app with audited pure-JS primitives (`@noble/curves` X25519, `@noble/ciphers` ChaCha20-Poly1305, `@noble/hashes` SHA-256), shared by the engine and the remote app in `packages/protocol/src/remoteNoise.ts`. It doesn't depend on TLS, so it holds whatever the tunnel does. A test checks both handshakes against the cacophony Noise test vectors byte for byte.

### Images

A phone sends images with `session.send`, never on their own. The remote app redraws each as a JPEG of at most 2,000px on its longest side at 0.8, and smaller or rougher until it fits `REMOTE_IMAGE_BYTES` (`apps/remote/src/lib/images.ts`), so four fit in one RPC line (the engine takes lines up to 4 MB, `remoteServer.ts`). The frame limit stays as it is: the channel already splits a long line into 60,000-byte frames and the line transport puts it back together.

### Files

Another computer (`computers/RemoteAttachments.tsx`) also sends files with `session.send` and `session.create`, as they are: up to `REMOTE_MAX_FILES`, with the images at most `REMOTE_ATTACHMENT_BYTES` of base64 together so the line stays under 4 MB (`checkAttachments` refuses more). The engine writes them to a folder of their own per message under `<dataDir>/remote-files` (`remoteFiles.ts`), with names that can't leave it, and adds them to the prompt as a line of `@` mentions, as the message box does with dropped files: Claude reads them itself. Folders older than 30 days go when Remote starts. `session.create` takes images too. `hello` says `features: ['attachments']`; the windows send files, and images to `session.create`, only to a computer that says it, since an older one drops unknown params without a word.

### Framing (`remoteChannel.ts`)

1. The phone's first WebSocket frame: `0x53`, the protocol version, the mode (1 pair, 2 connect), then Noise's first message.
2. The engine's answer: Noise's second message.
3. Every frame after that is one ChaCha20-Poly1305 ciphertext of up to 60,000 bytes of the RPC's text lines (`lineTransport`). The nonce is a counter that is never sent: a dropped, replayed, reordered or changed frame doesn't decrypt, and the connection closes on the first one.

The prologue binds the handshake to Switchboard, the version and the mode (`switchboard-remote/1/pair`).

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

WebSocket close codes: 4400 refused, 4403 unknown device, 4410 pairing closed, 4426 another protocol version.

## The code

| Where | What |
|---|---|
| `packages/protocol/src/remote.ts` | The remote contract (what a phone may ask), the pairing contract, Settings › Remote's schemas, `REMOTE_APP_URL` |
| `packages/protocol/src/remoteNoise.ts`, `remoteChannel.ts` | The handshakes, the framing, the links |
| `packages/protocol/src/remoteClient.ts` | The remote app's entry (`@switchboard/protocol/remote-client`): no zod |
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
| `apps/remote` | The remote app; `public/sw.js` is its service worker, which only shows notifications. A phone opens on Home (`PhoneHome.tsx`: what needs you and each profile's plan usage, `Usage.tsx`), which takes the list's place rather than stacking in the history. On a wide screen (768px and more) the list is a sidebar next to the home view (`Home.tsx`), with the ⌘K palette (`Palette.tsx`, ranking in `lib/palette.ts`) and one key handler in `Connected.tsx` (`lib/keys.ts`) |

The remote contract is not the app's contract: remote handlers call engine functions one by one, so a new method in `contract.ts` never becomes reachable from a phone. A test lists its methods. A phone can only read or act on sessions its list shows (the sidebar's, outside Archived).

### The methods

| Method | What it does |
|---|---|
| `hello` | The first request: the app's version, the device, and the computer's name |
| `sessions.list`, `projects.list` | The list (with `unread`, `pinned`, and a running session's model, effort and mode) and the projects you added |
| `transcript.get`, `transcript.watch`, `transcript.unwatch` | A transcript's pages and live updates, for one session at a time |
| `session.send`, `session.queue.remove`, `session.interrupt`, `session.respond` | Send or queue (with up to `REMOTE_MAX_IMAGES` images, each at most `REMOTE_IMAGE_BYTES` of base64, and up to `REMOTE_MAX_FILES` files), take from Up next, stop, answer a prompt |
| `session.create`, `later.add` | Start a session, or queue one, in a project you added; `model`, `effort`, `permissionMode` and `worktree` left out are the project's defaults |
| `session.markRead`, `session.setFlags` | Read, as opening it on the computer; pin or archive |
| `session.setModel`, `session.setEffort`, `session.setPermissionMode` | A running session's model, effort and mode; modes are `default`, `acceptEdits`, `plan` and `auto` only |
| `options.get` | New session's choices: the models, efforts, modes, each project's defaults, and whether Auto model is on with the models it may pick (`model: 'auto'` then goes to `session.create` and `later.add` as is) |
| `session.ask`, `session.askThreads` | Ask about this session, through the engine's `Asker` (read-only tools, nothing in the transcript), and the threads it keeps |
| `usage.get` | Every profile's plan usage (its name and colour, never its account), the default first; from the engine's `UsageMonitor`, checked again when older than a minute or with `refresh` |
| `catchup.get` | A session's catch-up, without paths outside its checkout |
| `changes.get`, `changes.diff`, `changes.commit` | The session's uncommitted changes, one file's diff (at most 2,000 lines), and a commit of everything without a terminal (the last lines of the output when a hook fails) |
| `push.key`, `push.subscribe`, `push.unsubscribe` | The engine's VAPID public key, and this device's subscription with its switches (Needs you, Finished) |
| `device.visibility` | Whether the app is on the device's screen: no push while it is |

Events: `sessions.changed`, `usage.changed` (a profile's new check), `session.ask` (to phones watching the session and to the phone that asked, until the answer ends), and for the watched session `transcript.updated`, `session.stream`, `upNext.changed` and `catchup.changed`.

### Push notifications

The engine sends Web Push itself (`webPush.ts`), without a library or a server of Switchboard's: it keeps a VAPID key pair in its app state (`remote.vapid`, made the first time a phone asks), and each device's subscription (`remote.push`). It pushes when a prompt opens in a session the phone lists, and when a turn ends (a session it runs goes from working to idle), after waiting up to eight seconds for the turn's catch-up so the line can say "14 tests passed · ~2 min to review". A device with the app on screen (`device.visibility`) gets none. A push service that answers 404 or 410 drops the subscription; revoking a device does too.

The payload is the kind, the session id, its title and project, and one line; a tool prompt adds its `requestId` and `answers: true` (`promptAnswers`: not for a question or a plan, which need their session). It is encrypted for the browser, so the push service only carries ciphertext; the computer has to reach the push services over HTTPS. The remote app's service worker (`public/sw.js`, allowed by `worker-src 'self'`) shows it and opens the session on a tap (`?s=<id>`, or a message to a page already open). iOS only allows push for a page added to the Home Screen, and shows no buttons on notifications.

Where the browser shows buttons (`Notification.maxActions`: Chrome, Edge and Firefox on a computer), a tool prompt's notification has **Deny** and **Allow**. The answer is never in a URL, so a link can't answer for you: the service worker posts it to a page that is open, or opens one and keeps the answer (and itself, through `waitUntil`) until that page asks for it with `take-answer`, for at most 30 seconds. The page answers only after a fresh `sessions.list` shows the prompt still open, and says "Already answered" otherwise.

Nothing listens until Remote is on: off by default, and started at launch (with its tunnel) only when it was on when the app quit.

## Settings › Remote

The page is laid out for daily use: the switch on the title's row, a status card (`apps/ui/src/components/remote/remoteStatusView.ts` picks its title, line and buttons from `RemoteStatus`, and its tests cover every state), Paired devices, the Connection (folded once Remote runs; a draft until **Save and restart**), and Advanced (the port and the security note). With Remote off and nothing paired, three setup steps replace it.

- **The fix for each problem**: a `port-in-use` problem carries `suggestedPort`, the next port free when Remote tried (`freePort.ts`), for **Use port …**; a missing tool offers its download page and Cloudflare instead.
- **Rename**: `remote.rename` stores a device's name (`DeviceName`, 1 to 60 characters).
- **What a device is**, for its icon: `kind` is `computer` for `REMOTE_DESKTOP_ORIGIN`, else `phone` or `browser` from the user agent when it paired. A label, never what lets it in.
- **Address changed**: each device keeps the engine's address it last connected through (`last_address`). `RemoteStatus.addressChanged` is true while a quick tunnel (Cloudflare, ngrok without a domain) runs at an address no paired device has used yet, so the card offers **Reconnect a paired device** (the connect link) only when it is needed.
- **Scripted runs** (the smoke test, the screenshots, a driven app) get throwaway keys made in memory instead of the keychain's (`throwawayRemoteKey`), since they use throwaway profiles and some point HOME at a made-up folder.

## Other computers

Switchboard on another computer pairs with Remote as a phone does, and shows its sessions next to the local ones. The engine is the client (`packages/engine/src/remote/computerLink.ts`): the same pairing link (pasted, not scanned), the same `Noise_IKpsk2` and `Noise_IK` handshakes, framing and remote contract, from Node with `ws`. Nothing about what a paired device may do changes: the other computer is one more device in Settings › Remote, limited to `remoteContract`, and **Revoke** cuts it off.

- **One device key per install**, made the first time it pairs, kept like the identity key (`safeStorage`, `remote-device.bin`; `apps/desktop/src/main/remoteIdentity.ts`). `remote_computers` (migration v28) has the other computers' public keys, addresses and the ids they gave this one, never a secret.
- **Origin.** It sends `REMOTE_DESKTOP_ORIGIN`, which the server accepts next to the remote app's. A browser page can't send it, so it doesn't widen what a website can reach; it isn't a lock either (any program can send any `Origin`). The handshake is. The server stores a device paired from that origin with `kind: 'computer'`, for its icon in Settings › Remote.
- **Connection.** One per paired computer, kept by the engine: a ping every 20 seconds notices a computer that went to sleep, and it reconnects with backoff up to a minute, without giving up. Close code 4403 stops it (`unpaired`).
- **The windows** reach a computer only through `computers.call`, with `COMPUTER_METHODS`: the remote contract without `hello`, push and `device.visibility`. The other computer validates the params; the results are shown as text (`components/computers/RemoteText.tsx`: no file links, no Run, no images loaded). Its events come as `computers.event`.
- **No loops.** A computer only ever serves its own sessions; the ones it shows from another computer are not in its list, so pairing both ways shows each computer's own sessions once.
- **One sidebar.** Each computer's last `sessions.list` becomes rows of the normal sidebar (`apps/ui/src/state/remoteRows.ts`), with the same status rules as that computer's list (an open prompt is needs you), in the same groups, search, ⌃⇥ and ⌘⇧U. A remote row's id is `remote:<computer>:<session>` (`remoteSelection.ts`), and a remote session is opened as `{ computerId, sessionId }` in the `remote` main view, never in the panes. A row only offers what the contract has: Open, Pin and Archive (`session.setFlags`), Copy title, and New session in its project. An offline computer keeps its last list, dimmed, and `lastSeen` (from the hub: when its connection last ended) says since when; a forgotten computer's rows go. The Computers strip and "Show sessions from" filter by computer, per window.
- **The same session view** (`RemoteSessionView.tsx`): the local header, column, permission card (with its keys) and message box, with the computer's chip and a 2px violet line. The transcript stays `RemoteText`; consecutive tool calls fold into one line (`toolsSummary`). Changes, the terminal, the editor and pull requests are disabled, with the reason as a tooltip.
- **New session on another computer** (`RemoteNewSession.tsx`): Run on picks the computer; its `projects.list` gives the tiles, `session.create` starts the session, and model, effort, mode and worktree show only when `options.get` answers (an older Switchboard there has no `options.get`, so the start sends only the project and the prompt). Images and files go with the prompt to a computer whose `hello` has `attachments` (see Files). Folders there can't be picked, and Quick question, the queue and the focus limit are this computer's.
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
- A tunnel tool left running after a crash of Switchboard keeps forwarding to a closed port until it is stopped.
- Not built yet: see Phase 2 below, and caching the app for offline starts.

## Phase 2

- **Cloudflare Access (Zero Trust) in front of the tunnel.** A named Cloudflare tunnel on your own domain, with an Access login before anyone reaches the handshake. Access works with a cookie on the tunnel's hostname, which a browser doesn't send on a cross-site WebSocket (Safari blocks cross-site cookies outright), so the remote app has to come from that same hostname. Plan: an option under **My own address**, "Open the remote app from this address": the engine serves the built remote app itself (shipped inside the desktop app), accepts its own public origin next to `REMOTE_APP_URL`, and the QR codes point there. Pairing stays required underneath: Access is the outer lock, the device key the inner one. Optionally the engine checks Access's signed `Cf-Access-Jwt-Assertion` header too.
- The device label in the computer's own transcript, an indicator outside Settings while a phone is connected, and "Keep this Mac awake".
