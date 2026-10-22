import { AUTO_MODEL, type SessionHostInfo } from '@switchboard/protocol/client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { autoChipModel } from '../../lib/autoModel.ts';
import { useAutoPick } from '../../state/autoPickStore.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { findModelOption } from '../../lib/models.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useSavedSettings, type SavedSettings } from '../../state/savedSettingsStore.ts';
import { ComposerChipRow } from '../composer/ComposerChips.tsx';

/**
 * The chip row of a session running in this app (profile · model · effort · permission mode), in the
 * composer card's bottom-left corner. The profile can't change for a running session; its chip says
 * which one it bills to. Background tasks show as a green pill above the message box (TranscriptView).
 */
export function SessionControls({ host }: { host: SessionHostInfo }) {
  const connection = useEngineConnection();
  const models = useHosts((s) => s.models);
  const client = connection.status === 'connected' ? connection.client : null;
  const active = host.state !== 'closed' && host.state !== 'error';
  const disabled = !active || !client;
  // Claude Code reports full ids (`claude-opus-5-5`); show them as the alias row they resolve to.
  const modelOption = findModelOption(models, host.model);
  // Effort only applies to models that support it (unknown models get the benefit of the doubt).
  const supportsEffort = modelOption?.supportsEffort ?? true;
  // On the model Auto picked: the chip reads "Auto · Sonnet", and its menu explains the pick.
  const autoModel = autoChipModel(host.autoPick);
  // Still choosing: the chip reads Auto, without a model yet.
  const choosing = host.autoChoosing === true;
  const row = useRef<HTMLDivElement>(null);
  const openPopover = useAutoPick((s) => s.openPopover);

  return (
    <div ref={row} className="contents">
      <ComposerChipRow
        names={{ profile: 'session-profile', model: 'session-model', effort: 'effort', mode: 'permission-mode' }}
        disabled={disabled}
        profile={{ value: host.profileId }}
        model={{
          value: choosing ? AUTO_MODEL : (modelOption?.value ?? ''),
          label: choosing ? 'Auto' : (modelOption?.displayName ?? host.model ?? 'Default model'),
          choices: [...(modelOption ? [] : [{ value: '', label: host.model ?? 'Default model' }]), ...models.map((m) => ({ value: m.value, label: m.displayName, description: m.description }))],
          onChange: (model) => void client?.call('session.setModel', { sessionId: host.sessionId, model: model || null }),
          auto: autoModel,
          actions:
            autoModel !== null
              ? [
                  {
                    label: host.autoPick?.model ? `Why Auto picked ${autoModel}` : "Why Auto couldn't pick",
                    data: { 'data-auto-why-chip': true },
                    onSelect: () => {
                      const chip = row.current?.querySelector('[data-model-chip]');
                      if (chip) openPopover(host.sessionId, chip.getBoundingClientRect());
                    },
                  },
                ]
              : undefined,
        }}
        effort={supportsEffort ? { value: host.effort ?? '', onChange: (effort) => void client?.call('session.setEffort', { sessionId: host.sessionId, effort: effort || null }) } : null}
        mode={{ value: host.permissionMode, onChange: (mode) => void client?.call('session.setPermissionMode', { sessionId: host.sessionId, mode }) }}
      />
    </div>
  );
}

/**
 * The chip row of a session that isn't running here: what the next message resumes it with. A change is only saved,
 * so it takes effect when the session starts again. `note` goes after the chips (why the last run failed, say).
 */
export function SavedSessionControls({ sessionId, profileId, note }: { sessionId: string; profileId: string | null; note?: ReactNode }) {
  const connection = useEngineConnection();
  const models = useHosts((s) => s.models);
  const defaultProfile = useProfiles((s) => s.defaultId);
  const client = connection.status === 'connected' ? connection.client : null;
  const saved = useSavedSettings((s) => s.bySession[sessionId]) ?? null;
  const setSaved = useSavedSettings((s) => s.set);

  useEffect(() => {
    if (!client) return;
    let stale = false;
    client
      .call('session.savedSettings', { sessionId })
      .then((s) => !stale && setSaved(sessionId, s))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [client, sessionId]);

  /** Shows the change at once; when the engine refuses it, back to what is saved. */
  const change = (patch: Partial<SavedSettings>, call: () => Promise<unknown> | undefined) => {
    setSaved(sessionId, (s) => (s ? { ...s, ...patch } : s));
    void call()?.catch(() =>
      client
        ?.call('session.savedSettings', { sessionId })
        .then((s) => setSaved(sessionId, s))
        .catch(() => {}),
    );
  };

  const modelOption = findModelOption(models, saved?.model ?? null);
  const supportsEffort = modelOption?.supportsEffort ?? true;
  return (
    <>
      {saved && (
        <ComposerChipRow
          names={{ profile: 'session-profile', model: 'session-model', effort: 'effort', mode: 'permission-mode' }}
          disabled={!client}
          profile={{ value: profileId ?? defaultProfile }}
          model={{
            value: modelOption?.value ?? '',
            label: modelOption?.displayName ?? saved.model ?? 'Default model',
            choices: [...(modelOption ? [] : [{ value: '', label: saved.model ?? 'Default model' }]), ...models.map((m) => ({ value: m.value, label: m.displayName, description: m.description }))],
            onChange: (model) => change({ model: model || null }, () => client?.call('session.setModel', { sessionId, model: model || null })),
          }}
          effort={supportsEffort ? { value: saved.effort ?? '', onChange: (effort) => change({ effort: effort || null }, () => client?.call('session.setEffort', { sessionId, effort: effort || null })) } : null}
          mode={{ value: saved.permissionMode, onChange: (mode) => change({ permissionMode: mode }, () => client?.call('session.setPermissionMode', { sessionId, mode })) }}
        />
      )}
      {note}
    </>
  );
}
