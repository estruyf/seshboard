/**
 * Made-up devices that connect to Switchboard's Remote, for the website's pictures of Connected to this Mac
 * (scripts/website-screenshots.ts). Each one is already paired: the screenshot script wrote its public key into the
 * throwaway profile's cache. This only connects them, with the engine's key from a pairing link (which pairs nothing),
 * prints `connected`, and keeps them connected until it is stopped.
 *
 *   SWITCHBOARD_DEMO_LINK=<pairing link> PORT=<Remote's port> SWITCHBOARD_DEMO_SECRETS=<base64,base64>
 *     node --experimental-transform-types scripts/demo-phones.ts
 *
 * Its own process, because the remote channel's modules need `--experimental-transform-types`.
 */
import { keyPairFromSecret, parseRemoteLink, REMOTE_APP_URL, type RemoteContract } from '@switchboard/protocol';
import { client, handshake } from '../packages/engine/src/remote/testPhone.ts';

const link = parseRemoteLink(new URL(process.env.SWITCHBOARD_DEMO_LINK ?? '').hash);
if (link?.kind !== 'pair') throw new Error('SWITCHBOARD_DEMO_LINK is not a pairing link');
const port = Number(process.env.PORT);
const origin = new URL(process.env.SWITCHBOARD_REMOTE_APP_URL ?? REMOTE_APP_URL).origin;
const secrets = (process.env.SWITCHBOARD_DEMO_SECRETS ?? '').split(',').filter(Boolean);

for (const secret of secrets) {
  const keys = keyPairFromSecret(new Uint8Array(Buffer.from(secret, 'base64')));
  const socket = await handshake(port, 'connect', keys, link.enginePublicKey, undefined, origin);
  if (!socket.session) throw new Error(`a device was refused (close code ${socket.code})`);
  await client<RemoteContract>(socket.frames, socket.session).call('hello', { client: { version: 'demo' } });
}
console.log('connected');
// Stays connected until the screenshot script stops it.
setInterval(() => {}, 60_000);
