import { usePreferences } from '../../state/preferencesStore.ts';
import { costText } from '../usageFormat.ts';

/**
 * How estimated costs read in the currency of Settings › Usage ("≈$3.20"), or null while Show estimated cost is off:
 * views leave their cost out then. An unknown cost (a computer on an older Switchboard) reads as an empty string.
 */
export function useCostFormat(): ((usd: number | null | undefined) => string) | null {
  const show = usePreferences((s) => s.prefs.showCost);
  const currency = usePreferences((s) => s.prefs.costCurrency);
  if (!show) return null;
  return (usd) => (usd === null || usd === undefined ? '' : costText(usd, currency));
}
