import { Gauge } from 'lucide-react';
import { CURRENCIES, RATES_DATE, type CurrencyCode } from '@switchboard/protocol/client';
import { usePreferences } from '../../state/preferencesStore.ts';
import { openUsage } from '../../state/usageViewStore.ts';
import { Button } from '../ui/Button.tsx';
import { Select } from '../ui/Select.tsx';
import { Toggle } from '../ui/Toggle.tsx';

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c.code as CurrencyCode, label: `${c.code} · ${c.name}` }));

/** "16 October 2026", the day the exchange rates are from, in the system's own date format. */
const ratesDay = () => new Date(`${RATES_DATE}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** Settings › Usage: the cost estimate next to the usage bars, and the way to the Usage view. */
export function UsageSettings() {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  return (
    <>
      <div className="flex items-center justify-between gap-4" data-setting-row data-usage-view-setting>
        <span>
          <span className="block text-ui">Usage view</span>
          <span className="block text-meta text-muted">Which sessions, projects and models used your plan, and how your limits filled up over time.</span>
        </span>
        <Button size="md" icon={<Gauge size={14} aria-hidden />} onClick={() => openUsage()} className="shrink-0" data-settings-open-usage>
          Open usage
        </Button>
      </div>
      <Toggle
        label="Show estimated cost"
        detail="What your tokens would cost at Anthropic's API prices: after the 5-hour and weekly bars, next to Context under a session's message box, and in the Usage view. Your plan is not billed per token, so this is never a charge."
        checked={prefs.showCost}
        attr="data-show-cost"
        onChange={(showCost) => update({ showCost })}
      />
      <div className="flex items-center justify-between gap-4" data-setting-row>
        <span>
          <span className="block text-ui">Currency</span>
          <span className="block text-meta text-muted">The estimate is worked out in US dollars and converted at the exchange rates of {ratesDay()}.</span>
        </span>
        <Select<CurrencyCode>
          label="Currency of the estimated cost"
          value={prefs.costCurrency}
          onChange={(costCurrency) => update({ costCurrency })}
          options={CURRENCY_OPTIONS}
          disabled={!prefs.showCost}
          menuWidth={220}
          className="h-7 shrink-0 rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink/60"
          dataAttrs={{ 'data-cost-currency': true }}
        />
      </div>
    </>
  );
}
