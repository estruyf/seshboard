import { z } from 'zod';

/**
 * A Claude profile's login stopped working: a turn failed because Claude Code was signed out or its login expired. The
 * login belongs to the profile, so it holds for every session of the profile until you sign in again or a turn gets
 * through.
 */
export const SignedOut = z.object({
  profileId: z.string(),
  /** When a turn first failed on it. */
  since: z.number(),
  /** Claude Code's own words ("OAuth token has expired · Please run /login"), when it sent some. */
  message: z.string().nullable(),
  /** The sessions whose turn it stopped: they continue by themselves once you have signed in. */
  sessionIds: z.array(z.string()),
  /** The terminal running `claude auth login` for this profile, while it runs. */
  terminalId: z.string().nullable(),
});
export type SignedOut = z.infer<typeof SignedOut>;

/** Every profile that is signed out. */
export const SignInState = z.object({ profiles: z.array(SignedOut) });
export type SignInState = z.infer<typeof SignInState>;
