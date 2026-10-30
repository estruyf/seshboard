import { useState } from 'react';
import type { ProviderInfo } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { tildify } from '../../lib/format.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { useProviders } from '../../state/providersStore.ts';
import { Notice } from '../ui/Notice.tsx';
import { Toggle } from '../ui/Toggle.tsx';

/** What allowing a provider does, or why it can't be allowed here. */
export function providerDetail(provider: Pick<ProviderInfo, 'name' | 'found' | 'folder'>, home: string | null): string {
  const folder = tildify(provider.folder, home);
  return provider.found
    ? `Read its sessions in ${folder}. Those started outside Seshboard show when the sidebar shows sessions from other apps.`
    : `No sessions found in ${folder}. Use ${provider.name} on this computer first.`;
}

/**
 * Settings › Providers: the agents besides Claude Code whose sessions Seshboard can show. Each stays hidden until
 * allowed here; their sessions are read-only for now.
 */
export function ProvidersSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  // Loaded and kept current by `useProvidersSync` (App).
  const providers = useProviders((s) => s.providers);
  const home = useHomeFolder();
  const [error, setError] = useState<string | null>(null);

  const setAllowed = (id: ProviderInfo['id'], allowed: boolean) => {
    if (!client) return;
    setError(null);
    void client.call('providers.setAllowed', { id, allowed }).then((snapshot) => useProviders.getState().set(snapshot), (e: Error) => setError(e.message));
  };

  return (
    <div className="grid gap-4" data-providers-settings>
      <Toggle label="Claude Code" detail="Always on. Start, resume and steer sessions." checked attr="data-provider-claude" onChange={() => {}} disabled />
      {providers.map((provider) => (
        <Toggle
          key={provider.id}
          label={provider.name}
          detail={providerDetail(provider, home)}
          checked={provider.allowed}
          attr={`data-provider-${provider.id}`}
          // Not found: nothing to show yet, but one allowed before can still be turned off.
          disabled={!provider.found && !provider.allowed}
          onChange={(allowed) => setAllowed(provider.id, allowed)}
        />
      ))}
      {error && (
        <Notice tone="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
    </div>
  );
}
