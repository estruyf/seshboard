import type { ClaudeProfile, OptionalProvider, ProviderDetection } from '@seshboard/protocol/client';

/**
 * Settings › Profiles offers to add a provider found on this computer: its CLI is installed, no profile uses it yet,
 * and the offer wasn't put away with Not now.
 */
export function shouldOffer(detection: ProviderDetection | null, profiles: readonly Pick<ClaudeProfile, 'provider'>[], dismissed: readonly string[]): boolean {
  if (!detection?.installed) return false;
  return !profiles.some((p) => p.provider === detection.id) && !dismissed.includes(detection.id);
}

/** "38 sessions", "1 session". */
export const sessionCount = (count: number) => `${count} ${count === 1 ? 'session' : 'sessions'}`;

/** The offer's line under its title; the count only when the folder has sessions. */
export const offerText = (count: number) => (count > 0 ? `Add it as a profile to see its ${sessionCount(count)} here and start new ones.` : 'Add it as a profile to start sessions with it here.');

/**
 * Copilot is ready's line about the sidebar: how many of its sessions now show there (when Add profile used the folder
 * `providers.detect` counted), and that Claude Code stays the default.
 */
export function readySessionsLine(count: number | null, provider: string): string {
  const shown = count && count > 0 ? `${sessionCount(count)} from ${provider} CLI now ${count === 1 ? 'shows' : 'show'} in the sidebar, marked with ${provider}.` : `Its sessions show in the sidebar, marked with ${provider}.`;
  return `${shown} Claude Code stays your default.`;
}

/** The sessions a provider's CLI started show only with Show sessions from other apps on (none of them is Seshboard's). */
export const needsOtherApps = (count: number | null, scope: 'all' | 'switchboard') => scope !== 'all' && (count ?? 0) > 0;

/** Add profile's name for a provider's first profile ("Copilot"), then the provider's name with a number. */
export function suggestedName(provider: OptionalProvider | 'claude', short: string, profiles: readonly Pick<ClaudeProfile, 'name'>[]): string {
  if (provider === 'claude') return 'Work';
  const taken = new Set(profiles.map((p) => p.name.toLowerCase()));
  if (!taken.has(short.toLowerCase())) return short;
  for (let n = 2; ; n++) if (!taken.has(`${short} ${n}`.toLowerCase())) return `${short} ${n}`;
}
