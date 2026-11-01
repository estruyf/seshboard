import type { ModelOption, OptionalProvider, SessionHostInfo } from '@seshboard/protocol/client';
import { PROVIDER_NAMES } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useProvider } from '../../state/providersStore.ts';
import { ComposerChipRow } from '../composer/ComposerChips.tsx';

/**
 * The chips under the message box in another provider's session (GitHub Copilot): its profile (which says who runs it),
 * its model, its effort (for a model that takes one, at the levels it has) and its mode (the provider's own modes),
 * which change while it runs here.
 */
export function ProviderSessionControls({ provider, profileId, sessionId, host, models }: { provider: OptionalProvider; profileId: string | null; sessionId: string; host: SessionHostInfo | null; models: ModelOption[] }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const info = useProvider(provider);
  const modes = info?.modes ?? [];
  const supports = info?.supports ?? [];
  if (!host) {
    return (
      <span className="min-w-0 truncate px-1.5 text-meta text-muted" data-session-elsewhere>
        Not running in Seshboard. Send a message to continue it here with {PROVIDER_NAMES[provider]}.
      </span>
    );
  }
  const value = host.model ?? '';
  const current = models.find((m) => m.value === value);
  return (
    <ComposerChipRow
      // A session keeps its profile.
      profile={profileId ? { value: profileId } : null}
      model={{
        value,
        label: value ? (models.find((m) => m.value === value)?.displayName ?? value) : 'Default model',
        onChange: (model) => void client?.call('session.setModel', { sessionId, model: model || null }),
        choices: [{ value: '', label: 'Default model', description: `What ${PROVIDER_NAMES[provider]} picks` }, ...models.map((m) => ({ value: m.value, label: m.displayName }))],
      }}
      effort={
        current?.supportsEffort && supports.includes('effort')
          ? {
              value: host.effort ?? '',
              onChange: (effort) => void client?.call('session.setEffort', { sessionId, effort: effort || null }),
              ...(current.efforts ? { levels: current.efforts } : {}),
              defaultDescription: 'The model’s own level',
            }
          : null
      }
      mode={modes.length ? { value: host.permissionMode, onChange: (mode) => void client?.call('session.setPermissionMode', { sessionId, mode }), choices: modes } : null}
    />
  );
}
