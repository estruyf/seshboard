import { z } from 'zod';
import { COMPUTER_COLORS, COMPUTER_METHODS, COMPUTER_NAME_MAX, COMPUTER_NOTIFY } from './computerConstants.ts';

/**
 * Other computers: this Seshboard pairs with Remote on another computer, as a phone does, and shows that
 * computer's sessions (docs/remote-access.md, "Other computers"). The engine keeps the connection; the app's
 * windows reach the other computer only through `computers.call`, with `COMPUTER_METHODS`: the remote contract minus
 * what only a browser needs.
 */

export const ComputerMethodSchema = z.enum(COMPUTER_METHODS);

/** A paired computer's colour; one a newer version saved and this one doesn't know is the default violet. */
export const ComputerColorSchema = z.enum(COMPUTER_COLORS).catch('violet');

/** Which of a paired computer's notifications show here; one a newer version saved and this one doesn't know is `all`. */
export const ComputerNotifySchema = z.enum(COMPUTER_NOTIFY).catch('all');

/** A name you give a paired computer here; empty goes back to what it calls itself. */
export const ComputerNameSchema = z.string().trim().max(COMPUTER_NAME_MAX);

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
  /** Its name here: the one you gave it, else what it calls itself (`ownName`). */
  name: z.string(),
  /** What the other computer calls itself ("Studio Mac"), from its last `hello`. */
  ownName: z.string(),
  /** Whether `name` is one you gave it here. */
  renamed: z.boolean(),
  /** Its colour on chips, rows and the line over its sessions. */
  color: ComputerColorSchema,
  /** Which of its notifications show here. */
  notify: ComputerNotifySchema,
  /**
   * The sessions that are mine there, the most recent last: started there from this computer (New session, Run on) or
   * acted on from here (a message, an answer, a resume). `isMine` reads it, for the sidebar's Mine filter and Only mine.
   */
  mineHere: z.array(z.string()).default([]),
  /** Where it is: its tunnel's `https://` address. */
  address: z.string(),
  pairedAt: z.number(),
  state: ComputerState,
  /** Why it is offline or unpaired, in a sentence. */
  message: z.string().nullable(),
  retryAt: z.number().nullable(),
  /** The other computer's Seshboard version, once connected. */
  version: z.string().nullable(),
  /** What it takes beyond what every version does (`REMOTE_FEATURE_ATTACHMENTS`), once connected. */
  features: z.array(z.string()),
  /** When it was last connected, while it is not ("Last seen 2h ago"); null while connected, or not since this app started. */
  lastSeen: z.number().nullable(),
  /**
   * What it sent that this version can't read (it may run an older or newer version), in a sentence; null when
   * everything was fine. A session list with such entries shows without them.
   */
  problem: z.string().nullable(),
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
