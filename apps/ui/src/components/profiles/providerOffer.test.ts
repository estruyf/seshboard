import { describe, expect, it } from 'vitest';
import type { ProviderDetection } from '@seshboard/protocol/client';
import { needsOtherApps, offerText, readySessionsLine, shouldOffer, suggestedName } from './providerOffer.ts';

const found: ProviderDetection = { id: 'copilot', installed: true, version: '1.0.4', folder: '/Users/me/.copilot', folderExists: true, sessions: 38, signedIn: true, login: 'estruyf' };

describe('the offer to add a provider found on this computer', () => {
  it('shows when its CLI is installed, no profile uses it and it was not put away', () => {
    expect(shouldOffer(found, [{ provider: 'claude' }], [])).toBe(true);
  });

  it('stays away when the CLI is missing, a profile uses it, or after Not now', () => {
    expect(shouldOffer({ ...found, installed: false }, [{ provider: 'claude' }], [])).toBe(false);
    expect(shouldOffer(found, [{ provider: 'claude' }, { provider: 'copilot' }], [])).toBe(false);
    expect(shouldOffer(found, [{ provider: 'claude' }], ['copilot'])).toBe(false);
    expect(shouldOffer(null, [{ provider: 'claude' }], [])).toBe(false);
  });

  it('counts the sessions it would show, and leaves the count out when there are none', () => {
    expect(offerText(38)).toBe('Add it as a profile to see its 38 sessions here and start new ones.');
    expect(offerText(1)).toBe('Add it as a profile to see its 1 session here and start new ones.');
    expect(offerText(0)).toBe('Add it as a profile to start sessions with it here.');
  });
});

describe('Copilot is ready', () => {
  it('says how many sessions now show, and that Claude Code stays the default', () => {
    expect(readySessionsLine(38, 'Copilot')).toBe('38 sessions from Copilot CLI now show in the sidebar, marked with Copilot. Claude Code stays your default.');
    expect(readySessionsLine(1, 'Copilot')).toBe('1 session from Copilot CLI now shows in the sidebar, marked with Copilot. Claude Code stays your default.');
    expect(readySessionsLine(null, 'Copilot')).toBe('Its sessions show in the sidebar, marked with Copilot. Claude Code stays your default.');
  });

  it('points at Show sessions from other apps only when the sidebar hides them', () => {
    expect(needsOtherApps(38, 'switchboard')).toBe(true);
    expect(needsOtherApps(38, 'all')).toBe(false);
    expect(needsOtherApps(0, 'switchboard')).toBe(false);
  });
});

describe("a new profile's name", () => {
  it("is the provider's short name, numbered when taken", () => {
    expect(suggestedName('copilot', 'Copilot', [{ name: 'Personal' }])).toBe('Copilot');
    expect(suggestedName('copilot', 'Copilot', [{ name: 'Copilot' }])).toBe('Copilot 2');
    expect(suggestedName('claude', 'Claude', [])).toBe('Work');
  });
});
