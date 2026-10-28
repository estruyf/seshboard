import { Info } from 'lucide-react';
import { AUTO_TIERS, tierLabel, type AutoLean, type AutoModelPrefs } from '@seshboard/protocol/client';
import { toggleTier } from '../../lib/autoModel.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Toggle } from '../ui/Toggle.tsx';

/** Settings › Conversation › Auto model. */
export function AutoModelSettings() {
  const prefs = usePreferences((s) => s.prefs.autoModel);
  const updatePrefs = usePreferences((s) => s.update);
  const update = (patch: Partial<AutoModelPrefs>) => updatePrefs({ autoModel: { ...prefs, ...patch } });
  const off = !prefs.enabled;
  return (
    <div className="grid gap-4" data-auto-model-settings>
      <Toggle
        label="Auto model"
        detail="Shows Auto in the model menu. Haiku reads only your prompt, never your files or memory."
        checked={prefs.enabled}
        attr="data-auto-model-enabled"
        onChange={(enabled) => update({ enabled })}
      />
      <div className={`grid gap-4 ${off ? 'opacity-50' : ''}`} aria-disabled={off || undefined}>
        <div className="flex items-center justify-between gap-4" data-setting-row>
          <span>
            <span className="block text-ui">Models it can pick</span>
            <span className="block text-meta text-muted">At least one.</span>
          </span>
          <div role="group" aria-label="Models it can pick" className="flex shrink-0 items-center gap-4">
            {AUTO_TIERS.map((tier) => {
              const checked = prefs.allowed.includes(tier);
              const last = checked && prefs.allowed.length === 1;
              return (
                <Checkbox
                  key={tier}
                  checked={checked}
                  disabled={off || last}
                  tooltip={last ? 'Auto needs at least one model' : undefined}
                  onChange={(on) => update({ allowed: toggleTier(prefs.allowed, tier, on) })}
                  dataAttrs={{ 'data-auto-model-allowed': tier }}
                >
                  <span className="text-ui">{tierLabel(tier)}</span>
                </Checkbox>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4" data-setting-row>
          <span>
            <span className="block text-ui">When in doubt</span>
            <span className="block text-meta text-muted">Which way to lean on a close call.</span>
          </span>
          <SegmentedControl<AutoLean>
            mode="radio"
            label="When in doubt"
            value={prefs.lean}
            onChange={(lean) => update({ lean })}
            segments={[
              { value: 'cheaper', label: 'Cheaper', disabled: off, data: { 'data-auto-model-lean': 'cheaper' } },
              { value: 'balanced', label: 'Balanced', disabled: off, data: { 'data-auto-model-lean': 'balanced' } },
              { value: 'stronger', label: 'Stronger', disabled: off, data: { 'data-auto-model-lean': 'stronger' } },
            ]}
            className="shrink-0"
          />
        </div>
        <Toggle
          label="Suggest a stronger model later"
          detail="When a session grows past its first prompt. Never switches by itself."
          checked={prefs.suggest}
          attr="data-auto-model-suggest"
          onChange={(suggest) => update({ suggest })}
        />
      </div>
      <Notice tone="info" icon={<Info size={13} aria-hidden />}>
        Each pick uses a few hundred to a few thousand Haiku tokens. They count toward your plan and show in Usage as Auto routing.
      </Notice>
    </div>
  );
}
