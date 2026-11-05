import { AUTO_MODEL, type NewSessionEffort } from '@seshboard/protocol/client';
import { modelLabel } from '../../lib/autoModel.ts';
import { GLOBAL_EFFORT_DETAIL, GLOBAL_MODEL_DETAIL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { EFFORT_LABEL, EFFORTS } from '../newSession/route.ts';
import { Select } from '../ui/Select.tsx';

/** The first option of both menus: send nothing, so Claude Code picks from its own settings. */
const CLAUDE_DEFAULT = "Claude Code's default";

const select = 'h-7 shrink-0 rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink/60';

/**
 * Settings › General › New sessions: the global model and effort, the fallback behind a session's project and Claude
 * profile, as the global permission mode is.
 */
export function GlobalModelSettings() {
  const model = usePreferences((s) => s.prefs.newSessionModel);
  const effort = usePreferences((s) => s.prefs.newSessionEffort);
  const autoEnabled = usePreferences((s) => s.prefs.autoModel.enabled);
  const update = usePreferences((s) => s.update);
  const models = useHosts((s) => s.models);

  const modelOptions = [
    { value: '', label: CLAUDE_DEFAULT },
    // Auto stays listed while it is the saved choice, also with Auto off (sessions then start on Claude Code's default).
    ...(autoEnabled || model === AUTO_MODEL ? [{ value: AUTO_MODEL, label: autoEnabled ? 'Auto' : 'Auto (off)' }] : []),
    ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName })),
    // A model Claude Code no longer lists (or hasn't listed yet) still shows what is saved.
    ...(model && model !== AUTO_MODEL && !models.some((m) => m.value === model) ? [{ value: model, label: modelLabel(models, model) }] : []),
  ];
  const effortOptions: Array<{ value: NewSessionEffort; label: string }> = [{ value: '', label: CLAUDE_DEFAULT }, ...EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))];

  return (
    <>
      <div className="flex items-center justify-between gap-4" data-setting-row>
        <span>
          <span className="block text-ui">Global model</span>
          <span className="block text-meta text-muted">{GLOBAL_MODEL_DETAIL}</span>
        </span>
        <Select<string>
          label="Global model"
          value={model}
          onChange={(newSessionModel) => update({ newSessionModel })}
          options={modelOptions}
          menuWidth={220}
          className={select}
          dataAttrs={{ 'data-new-session-model': true }}
        />
      </div>
      <div className="flex items-center justify-between gap-4" data-setting-row>
        <span>
          <span className="block text-ui">Global effort</span>
          <span className="block text-meta text-muted">{GLOBAL_EFFORT_DETAIL}</span>
        </span>
        <Select<NewSessionEffort>
          label="Global effort"
          value={effort}
          onChange={(newSessionEffort) => update({ newSessionEffort })}
          options={effortOptions}
          menuWidth={220}
          className={select}
          dataAttrs={{ 'data-new-session-effort': true }}
        />
      </div>
    </>
  );
}
