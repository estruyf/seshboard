import { z } from 'zod';
import { COMPUTER_METHODS } from './computerConstants.ts';

/**
 * Other computers: this Switchboard pairs with Remote on another computer, as a phone does, and shows that
 * computer's sessions (docs/remote-access.md, "Other computers"). The engine keeps the connection; the app's
 * windows reach the other computer only through `computers.call`, with `COMPUTER_METHODS`: the remote contract minus
 * what only a browser needs.
 */

export const ComputerMethodSchema = z.enum(COMPUTER_METHODS);

/**
 * How the connection to a paired computer is:
 *  - `connecting`: trying now;
 *  - `connected`;
 *  - `offline`: it couldn't reach it, and tries again at `retryAt` (null: it stopped trying; Try again starts over);
 *  - `unpaired`: that computer no longer knows this one (revoked, or 30 days without connecting): pair again.
 */
export const ComputerState = z.enum(['connecting', 'connected', 'offline', 'unpaired']);
export type ComputerState = z.infer<typeof ComputerState>;

export const Computer = z.object({
  id: z.string(),
  /** What the other computer calls itself ("Studio Mac"), from its last `hello`. */
  name: z.string(),
  /** Where it is: its tunnel's `https://` address. */
  address: z.string(),
  pairedAt: z.number(),
  state: ComputerState,
  /** Why it is offline or unpaired, in a sentence. */
  message: z.string().nullable(),
  retryAt: z.number().nullable(),
  /** The other computer's Switchboard version, once connected. */
  version: z.string().nullable(),
  /** What it takes beyond what every version does (`REMOTE_FEATURE_ATTACHMENTS`), once connected. */
  features: z.array(z.string()),
  /** When it was last connected, while it is not ("Last seen 2h ago"); null while connected, or not since this app started. */
  lastSeen: z.number().nullable(),
});
export type Computer = z.infer<typeof Computer>;

/**
 * Pairing with another computer, after its link was pasted: `connecting` (the handshake), `waiting` (for Allow on
 * that computer, with the code both show), or `failed` (with why). Null when not pairing.
 */
export const ComputerPairing = z
  .object({
    state: z.enum(['connecting', 'waiting', 'failed']),
    code: z.string().nullable(),
    message: z.string().nullable(),
  })
  .nullable();
export type ComputerPairing = z.infer<typeof ComputerPairing>;

export const ComputersStatus = z.object({
  /** False when this build doesn't offer Remote, or the keychain can't keep this computer's key. */
  available: z.boolean(),
  computers: z.array(Computer),
  pairing: ComputerPairing,
});
export type ComputersStatus = z.infer<typeof ComputersStatus>;

/** An event from another computer (its remote contract's), passed on to the windows as is. */
export const ComputerEvent = z.object({ computerId: z.string(), name: z.string(), payload: z.json() });
export type ComputerEvent = z.infer<typeof ComputerEvent>;
