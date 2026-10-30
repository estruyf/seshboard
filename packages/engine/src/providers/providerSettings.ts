import { existsSync } from 'node:fs';
import { PROVIDER_NAMES, type OptionalProvider, type ProvidersSnapshot } from '@seshboard/protocol';
import type { ProviderAdapter } from './provider.ts';

/** The app_state key with the allowed providers (a list of ids). */
export const ALLOWED_PROVIDERS_KEY = 'providers.allowed';

interface AppState {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/**
 * Which providers besides Claude Code the user allowed (Settings › Providers). A provider stays hidden until allowed,
 * so nothing of it is read before then.
 */
export class ProviderSettings {
  constructor(
    private readonly appState: AppState,
    private readonly providers: readonly ProviderAdapter[],
  ) {}

  allowed(): OptionalProvider[] {
    const stored = this.appState.get(ALLOWED_PROVIDERS_KEY);
    return Array.isArray(stored) ? this.providers.map((p) => p.id).filter((id) => stored.includes(id)) : [];
  }

  /** The providers whose sessions are read now. */
  allowedAdapters(): ProviderAdapter[] {
    const allowed = this.allowed();
    return this.providers.filter((p) => allowed.includes(p.id));
  }

  isAllowed(id: OptionalProvider): boolean {
    return this.allowed().includes(id);
  }

  /** Returns whether anything changed. */
  setAllowed(id: OptionalProvider, allowed: boolean): boolean {
    const current = this.allowed();
    if (current.includes(id) === allowed) return false;
    this.appState.set(ALLOWED_PROVIDERS_KEY, allowed ? [...current, id] : current.filter((p) => p !== id));
    return true;
  }

  snapshot(): ProvidersSnapshot {
    const allowed = this.allowed();
    return {
      providers: this.providers.map(({ id, folder, resumeCommand, driver }) => ({ id, name: PROVIDER_NAMES[id], allowed: allowed.includes(id), found: existsSync(folder), folder, resumeCommand, canStart: !!driver })),
    };
  }
}
