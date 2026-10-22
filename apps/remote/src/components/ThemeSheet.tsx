import { useState, useSyncExternalStore } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { REMOTE_FEATURE_THEME, type RemoteTheme } from '@switchboard/protocol/remote-client';
import { nameOf, type Computer } from '../lib/computers.ts';
import { OWN_THEME, swatchOf, themeComputer, type ModeChoice } from '../lib/theme.ts';
import { chooseMode, chooseTheme, modeChoice, modeNow, subscribeMode, subscribeThemeChoice, themeChoice } from '../lib/themeApply.ts';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toasts.tsx';
import { Button } from './ui.tsx';

/** Appearance, worded as Settings › Theme on the computer. */
const MODES: readonly { value: ModeChoice; label: string }[] = [
  { value: 'system', label: 'Match System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Why a computer's theme can't be picked yet; null when it can. */
function unavailable(computer: Computer): string | null {
  if (computer.theme) return null;
  if (computer.state.kind === 'connected' && !computer.state.features.includes(REMOTE_FEATURE_THEME)) return 'Update Switchboard there to use its theme.';
  return computer.state.kind === 'connected' ? 'Shows once Switchboard is open there.' : 'Shows once it connects.';
}

/** Three dots of a theme's colours (background, accent, text), in the mode the page shows. */
function Swatch({ theme }: { theme: RemoteTheme | null }) {
  const mode = useSyncExternalStore(subscribeMode, modeNow);
  return (
    <span aria-hidden className="flex shrink-0 -space-x-1">
      {swatchOf(theme, mode).map((color, i) => (
        <span key={i} className="size-4 rounded-full border border-edge" style={{ background: color }} />
      ))}
    </span>
  );
}

/**
 * Theme, from the `⋯` menu: Appearance (light or dark as the phone is set, or always one of them), and the colours.
 * The phone can look like one of its computers, or keep its own look (Demo Time). The phone has one theme for all its
 * computers, so switching between them doesn't change the colours; by default it is the first one that sent its
 * theme. Sync now asks the computers for their theme again.
 */
export function ThemeSheet({ computers, onSync, onClose }: { computers: readonly Computer[]; onSync: () => Promise<boolean>; onClose: () => void }) {
  const choice = useSyncExternalStore(subscribeThemeChoice, themeChoice);
  const mode = useSyncExternalStore(subscribeMode, modeChoice);
  const [syncing, setSyncing] = useState(false);
  const picked = themeComputer(choice, computers) ?? OWN_THEME;
  const canSync = computers.some((c) => c.state.kind === 'connected' && c.state.features.includes(REMOTE_FEATURE_THEME));
  const sync = async () => {
    setSyncing(true);
    const synced = await onSync();
    setSyncing(false);
    if (!synced) toast('No computer answered', { detail: 'Open Switchboard there and try again.', tone: 'error' });
  };
  const row = (id: string, label: string, detail: string, theme: RemoteTheme | null, disabled = false) => {
    const isPicked = picked === id;
    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={isPicked}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && chooseTheme(id)}
        className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left active:bg-selected aria-disabled:opacity-60"
        data-remote-theme-option={id}
      >
        {disabled ? <span aria-hidden className="w-10 shrink-0" /> : <Swatch theme={theme} />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-body ${isPicked ? 'font-semibold' : 'font-medium'}`}>{label}</span>
          <span className="block truncate text-ui text-muted">{detail}</span>
        </span>
        <Check aria-hidden className={`size-4 shrink-0 text-accent-ink ${isPicked ? '' : 'invisible'}`} />
      </button>
    );
  };
  return (
    <Sheet title="Theme" onClose={onClose} hook="theme">
      <section className="flex flex-col gap-2 pb-4">
        <h3 id="theme-mode" className="text-meta font-semibold tracking-wide text-faint uppercase">
          Appearance
        </h3>
        <div role="radiogroup" aria-labelledby="theme-mode" className="grid grid-cols-3 gap-1 rounded-xl border border-edge bg-sidebar p-1" data-remote-theme-mode={mode}>
          {MODES.map((option) => {
            const isPicked = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isPicked}
                onClick={() => !isPicked && chooseMode(option.value)}
                className={`min-h-11 rounded-lg px-2 text-ui transition-[background-color,color] pointer-fine:min-h-8 ${isPicked ? 'bg-card font-semibold text-text shadow-sm' : 'text-muted active:bg-selected'}`}
                data-remote-theme-mode-option={option.value}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h3 id="theme-colours" className="text-meta font-semibold tracking-wide text-faint uppercase">
            Colours
          </h3>
          <Button variant="quiet" size="md" onClick={() => void sync()} disabled={!canSync || syncing} className="gap-1.5" data-remote-theme-sync>
            <RefreshCw aria-hidden className={`size-4 ${syncing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            Sync now
          </Button>
        </div>
        <div role="radiogroup" aria-labelledby="theme-colours" className="-mx-1 flex flex-col">
          {computers.map((c) => {
            const why = unavailable(c);
            return row(c.id, nameOf(c) || 'Your computer', why ?? c.theme!.name, c.theme, why !== null);
          })}
          {row(OWN_THEME, 'Demo Time', "Switchboard's own look", null)}
        </div>
      </section>
    </Sheet>
  );
}
