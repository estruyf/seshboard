# Remote access

Remote lets a paired phone follow and steer Switchboard's sessions from anywhere: the session list with its status, the live transcript, sending or queueing a prompt, answering a permission prompt, question or plan, stopping a turn, and starting a session in a known project. Everything else (the terminal, Changes, git, memory, settings, profiles, attachments) stays on the computer. Issue [#93](https://github.com/estruyf/switchboard/issues/93) started it; this note is the design as built. The page for people using the app is [website/src/content/docs/remote-access.mdx](../website/src/content/docs/remote-access.mdx).

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
  - it is a secure context (installable, WebCrypto, push notifications later).
- **The engine only accepts sockets whose `Origin` is the remote app's.** Browsers always send `Origin` on a WebSocket and a page can't fake it, so another site open on the phone or the computer can't reach the engine.

### Why tunnels and not the local network

The first version listened on the local network. A page served from an HTTPS site can't open an unencrypted `ws://` socket to a LAN address (mixed content), and the computer can't get a trusted certificate for its LAN name; serving the app from the computer instead meant plain HTTP, a page whose JavaScript anyone on the network could change, and a new origin (a new pairing) for every address. Tunnels give an `https://` address that works from anywhere, so the app can live on one trusted origin. The cost is that the address is public (except Tailscale's): anyone who has it reaches the engine, and the handshake is what keeps them out.

**Tailscale** is the private choice: only your own devices on your tailnet can reach its address, and Tailscale's WireGuard is a second layer under Noise.

**ngrok's free plan** puts a warning page in front of browser requests unless a `ngrok-skip-browser-warning` header is sent, which a browser can't add to a WebSocket. It may not work for phones; Settings › Remote says so. Not verified yet.

### Development

`npm run dev:remote` serves the remote app at `http://localhost:5199/remote/`. Start the desktop app with `SWITCHBOARD_REMOTE_APP_URL=http://localhost:5199/remote/` and the engine accepts that origin and links straight to `http://127.0.0.1:<port>`, without a tunnel (`localhost` is a secure context, and `ws://` to the same computer isn't mixed content).

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
| A paired phone does more than it should | Its own contract (`remoteContract`), validated with zod; only sessions the sidebar lists; no terminal, files or settings |
| A lost phone | **Revoke**, which closes its connections at once (also one still in its handshake); devices unused for 30 days expire |
| Someone guesses keys or pairing secrets | Keys are 256-bit; five failed pairings close pairing; failed handshakes back off per client address |

The backoff's client address is what the tunnel saw: Cloudflare's `CF-Connecting-IP` behind a Cloudflare tunnel (it overwrites it), else the last `X-Forwarded-For` entry (the one the tunnel added). Behind a tunnel every socket comes from `127.0.0.1`.

## The channel

The encryption is done in the app with audited pure-JS primitives (`@noble/curves` X25519, `@noble/ciphers` ChaCha20-Poly1305, `@noble/hashes` SHA-256), shared by the engine and the remote app in `packages/protocol/src/remoteNoise.ts`. It doesn't depend on TLS, so it holds whatever the tunnel does. A test checks both handshakes against the cacophony Noise test vectors byte for byte.

### Framing (`remoteChannel.ts`)

1. The phone's first WebSocket frame: `0x53`, the protocol version, the mode (1 pair, 2 connect), then Noise's first message.
2. The engine's answer: Noise's second message.
3. Every frame after that is one ChaCha20-Poly1305 ciphertext of up to 60,000 bytes of the RPC's text lines (`lineTransport`). The nonce is a counter that is never sent: a dropped, replayed, reordered or changed frame doesn't decrypt, and the connection closes on the first one.

The prologue binds the handshake to Switchboard, the version and the mode (`switchboard-remote/1/pair`).

### Links

The QR codes open the remote app with everything after `#`, which a browser never sends in a request, so the site never sees it. The app takes it out of the address bar at once.

- `#p.<engine key>.<secret>.<engine address>`: **Pair a phone**.
- `#c.<engine key>.<engine address>`: **Show the address to paired phones**, after a quick tunnel got a new address. No secret: it only tells a phone paired with that key where the computer is now.

The engine address must be `https://` (or `http://` on `localhost`/`127.0.0.1`, for development).

### Pairing: `Noise_IKpsk2_25519_ChaChaPoly_SHA256`

- **Pair a phone** makes a 128-bit secret, good for one use and two minutes. Closing the dialog cancels it.
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
| `apps/remote` | The remote app |

The remote contract is not the app's contract: remote handlers call engine functions one by one, so a new method in `contract.ts` never becomes reachable from a phone. A test lists its methods. A phone can only read or act on sessions its list shows (the sidebar's, outside Archived).

Nothing listens until Remote is on: off by default, and started at launch (with its tunnel) only when it was on when the app quit.

## Known limits

- With every tunnel but Tailscale, the address is public; the handshake keeps everyone else out, but they can try. Pairing closes after five wrong secrets.
- The device key in IndexedDB can be read by script on the remote app's origin. The origin serves only the app, under a strict CSP. Non-extractable WebCrypto keys would need X25519 in WebCrypto, which phones' browsers don't all have yet.
- Someone with your unlocked phone has access until you revoke it.
- A tunnel tool left running after a crash of Switchboard keeps forwarding to a closed port until it is stopped.
- Not built yet: see Phase 2 below, and caching the app for offline starts.

## Phase 2

- **Cloudflare Access (Zero Trust) in front of the tunnel.** A named Cloudflare tunnel on your own domain, with an Access login before anyone reaches the handshake. Access works with a cookie on the tunnel's hostname, which a browser doesn't send on a cross-site WebSocket (Safari blocks cross-site cookies outright), so the remote app has to come from that same hostname. Plan: an option under **My own address**, "Open the remote app from this address": the engine serves the built remote app itself (shipped inside the desktop app), accepts its own public origin next to `REMOTE_APP_URL`, and the QR codes point there. Pairing stays required underneath: Access is the outer lock, the device key the inner one. Optionally the engine checks Access's signed `Cf-Access-Jwt-Assertion` header too.
- Push notifications when a session needs you (the remote app is a secure context now; the computer can send Web Push itself).
- The device label in the computer's own transcript, an indicator outside Settings while a phone is connected, and "Keep this Mac awake".
