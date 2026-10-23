import type { SignedOut, SignInState } from '@switchboard/protocol';

export interface SignInsDeps {
  onChange(state: SignInState): void;
  now?: () => number;
}

/**
 * The Claude profiles whose login stopped working, and the sessions it stopped. Kept in memory only: after a restart, the
 * next turn says again if the login still fails. Cleared when a turn of the profile gets through or you sign in again.
 */
export class SignIns {
  private readonly profiles = new Map<string, SignedOut>();

  constructor(private readonly deps: SignInsDeps) {}

  state(): SignInState {
    return { profiles: [...this.profiles.values()] };
  }

  of(profileId: string): SignedOut | null {
    return this.profiles.get(profileId) ?? null;
  }

  /** The login failed a session's turn. */
  hit(profileId: string, sessionId: string, message: string | null): void {
    const before = this.profiles.get(profileId);
    this.profiles.set(profileId, {
      profileId,
      since: before?.since ?? this.deps.now?.() ?? Date.now(),
      message: message ?? before?.message ?? null,
      sessionIds: [...new Set([...(before?.sessionIds ?? []), sessionId])],
      terminalId: before?.terminalId ?? null,
    });
    this.emit();
  }

  /** A turn of the profile got through: its login works. */
  ok(profileId: string): void {
    if (this.profiles.delete(profileId)) this.emit();
  }

  /** Sign in started (a terminal id) or ended (null) for a signed-out profile. */
  signingIn(profileId: string, terminalId: string | null): void {
    const signedOut = this.profiles.get(profileId);
    if (!signedOut || signedOut.terminalId === terminalId) return;
    this.profiles.set(profileId, { ...signedOut, terminalId });
    this.emit();
  }

  /** You signed in again: forgets the profile and returns the sessions to continue. */
  signedIn(profileId: string): string[] {
    const signedOut = this.profiles.get(profileId);
    if (!signedOut) return [];
    this.profiles.delete(profileId);
    this.emit();
    return signedOut.sessionIds;
  }

  /** The session moved to the Trash: nothing to continue. */
  forget(sessionId: string): void {
    for (const signedOut of this.profiles.values()) {
      if (!signedOut.sessionIds.includes(sessionId)) continue;
      this.profiles.set(signedOut.profileId, { ...signedOut, sessionIds: signedOut.sessionIds.filter((id) => id !== sessionId) });
      this.emit();
      return;
    }
  }

  private emit(): void {
    this.deps.onChange(this.state());
  }
}
