import { RpcError, type LogLevel, type OptionalProvider, type ProviderUpdateState } from '@seshboard/protocol';
import type { AppStateStore } from '../db/appState.ts';
import type { RunCommand, ToolUpdater } from '../system/toolUpdater.ts';

/** What every provider's update check gets from the engine. */
export interface ProviderUpdaterDeps {
  store: AppStateStore;
  ready: Promise<unknown>;
  onChange: (state: ProviderUpdateState) => void;
  log: (level: LogLevel, message: string) => void;
  allowUpdate?: boolean;
  run?: RunCommand;
}

/**
 * The update checks of other providers' CLIs (GitHub Copilot CLI), as Claude Code's: one for each provider with a
 * profile, made when its first profile is added and stopped when its last is removed (`sync`).
 */
export class ProviderUpdates {
  private readonly updaters = new Map<OptionalProvider, ToolUpdater<ProviderUpdateState>>();

  constructor(
    private readonly options: {
      /** The providers with a profile now. */
      providers: () => OptionalProvider[];
      create: (provider: OptionalProvider, onChange: () => void) => ToolUpdater<ProviderUpdateState>;
      /** Check by themselves, shortly after launch and every few hours (off in tests). */
      automatic: boolean;
      /** Every check's state, after any of them changed. */
      onChange: (updates: ProviderUpdateState[]) => void;
    },
  ) {}

  /** Starts the checks of providers that now have a profile, and stops the others'. */
  sync(): void {
    const wanted = new Set(this.options.providers());
    let changed = false;
    for (const [provider, updater] of this.updaters) {
      if (wanted.has(provider)) continue;
      updater.close();
      this.updaters.delete(provider);
      changed = true;
    }
    for (const provider of wanted) {
      if (this.updaters.has(provider)) continue;
      const updater = this.options.create(provider, () => this.options.onChange(this.list()));
      this.updaters.set(provider, updater);
      if (this.options.automatic) updater.start();
      changed = true;
    }
    if (changed) this.options.onChange(this.list());
  }

  list(): ProviderUpdateState[] {
    return [...this.updaters.values()].map((updater) => updater.state);
  }

  /** A provider's check; NOT_FOUND when it has no profile. */
  get(provider: OptionalProvider): ToolUpdater<ProviderUpdateState> {
    const updater = this.updaters.get(provider);
    if (!updater) throw new RpcError('NOT_FOUND', `No ${provider} profile, so its updates aren't checked`);
    return updater;
  }

  close(): void {
    for (const updater of this.updaters.values()) updater.close();
    this.updaters.clear();
  }
}
