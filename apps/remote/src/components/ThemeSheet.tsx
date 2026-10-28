import { useState, useSyncExternalStore } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { REMOTE_FEATURE_THEME, type RemoteTheme } from '@seshboard/protocol/remote-client';
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

/** The same, short enough for a row: the Settings page and the `⋯` menu. */
export const SHORT_MODES: readonly { value: ModeChoice; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/** Why a computer's theme can't be picked yet; null when it can. */
function unavailable(computer: Computer): string | null {
  if (computer.theme) return null;
  if (computer.state.kind === 'connected' && !computer.state.features.includes(REMOTE_FEATURE_THEME)) return 'Update Seshboard there to use its theme.';
  return computer.state.kind === 'connected' ? 'Shows once Seshboard is open there.' : 'Shows once it connects.';
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
 * Appearance as a segmented radio group: light or dark as the phone is set, or always one of them. `compact` fits it
 * in a row (the Settings page), with the short words.
 */
export function ModeChoices({ labelledBy, compact = false }: { labelledBy: string; compact?: boolean }) {
  const mode = useSyncExternalStore(subscribeMode, modeChoice);
  const options = compact ? SHORT_MODES : MODES;
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={`grid grid-cols-3 border border-edge bg-sidebar ${compact ? 'shrink-0 gap-0.5 rounded-lg p-0.5' : 'gap-1 rounded-xl p-1'}`} data-remote-theme-mode={mode}>
      {options.map((option) => {
        const isPicked = option.value === mode;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isPicked}
            onClick={() => !isPicked && chooseMode(option.value)}
            className={`transition-[background-color,color] ${compact ? 'min-h-9 rounded-md px-2.5 text-meta pointer-fine:min-h-6' : 'min-h-11 rounded-lg px-2 text-ui pointer-fine:min-h-8'} ${isPicked ? 'bg-card font-semibold text-text shadow-sm' : 'text-muted active:bg-selected'}`}
            data-remote-theme-mode-option={option.value}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The colours: one of the computers' themes, or the phone's own look (Demo Time), with Sync now, which asks the
 * computers for their theme again. `inset` lays the rows out for a grouped box (the Settings page).
 */
export function ColourChoices({ computers, onSync, inset = false }: { computers: readonly Computer[]; onSync: () => Promise<boolean>; inset?: boolean }) {
  const choice = useSyncExternalStore(subscribeThemeChoice, themeChoice);
  const [syncing, setSyncing] = useState(false);
  const picked = themeComputer(choice, computers) ?? OWN_THEME;
  const canSync = computers.some((c) => c.state.kind === 'connected' && c.state.features.includes(REMOTE_FEATURE_THEME));
  const sync = async () => {
    setSyncing(true);
    const synced = await onSync();
    setSyncing(false);
    if (!synced) toast('No computer answered', { detail: 'Open Seshboard there and try again.', tone: 'error' });
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
        className={`flex min-h-14 items-center gap-3 px-3 py-2 text-left active:bg-selected aria-disabled:opacity-60 ${inset ? 'border-t border-border' : 'rounded-lg'}`}
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
    <section className={`flex flex-col ${inset ? '' : 'gap-1'}`}>
      <div className={`flex items-center justify-between gap-3 ${inset ? 'min-h-12 border-t border-border pr-1 pl-10' : ''}`}>
        <h3 id="theme-colours" className={inset ? 'text-body' : 'text-meta font-semibold tracking-wide text-faint uppercase'}>
          Colours
        </h3>
        <Button variant="quiet" size="md" onClick={() => void sync()} disabled={!canSync || syncing} className="gap-1.5" data-remote-theme-sync>
          <RefreshCw aria-hidden className={`size-4 ${syncing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          Sync now
        </Button>
      </div>
      <div role="radiogroup" aria-labelledby="theme-colours" className={`flex flex-col ${inset ? '' : '-mx-1'}`}>
        {computers.map((c) => {
          const why = unavailable(c);
          return row(c.id, nameOf(c) || 'Your computer', why ?? c.theme!.name, c.theme, why !== null);
        })}
        {row(OWN_THEME, 'Demo Time', "Seshboard's own look", null)}
      </div>
    </section>
  );
}

/**
 * Theme, from the sidebar's `⋯` menu and the palette on a wide screen (a phone has it on the Settings page):
 * Appearance and the colours. The phone can look like one of its computers, or keep its own look (Demo Time). The
 * phone has one theme for all its computers, so switching between them doesn't change the colours; by default it is
 * the first one that sent its theme.
 */
export function ThemeSheet({ computers, onSync, onClose }: { computers: readonly Computer[]; onSync: () => Promise<boolean>; onClose: () => void }) {
  return (
    <Sheet title="Theme" onClose={onClose} hook="theme">
      <section className="flex flex-col gap-2 pb-4">
        <h3 id="theme-mode" className="text-meta font-semibold tracking-wide text-faint uppercase">
          Appearance
        </h3>
        <ModeChoices labelledBy="theme-mode" />
      </section>
      <ColourChoices computers={computers} onSync={onSync} />
    </Sheet>
  );
}
