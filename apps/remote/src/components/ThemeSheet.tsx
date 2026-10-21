import { useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import { REMOTE_FEATURE_THEME, type RemoteTheme } from '@switchboard/protocol/remote-client';
import { nameOf, type Computer } from '../lib/computers.ts';
import { OWN_THEME, swatchOf, themeComputer } from '../lib/theme.ts';
import { chooseTheme, subscribeThemeChoice, themeChoice } from '../lib/themeApply.ts';
import { Sheet } from './Sheet.tsx';

/** Why a computer's theme can't be picked yet; null when it can. */
function unavailable(computer: Computer): string | null {
  if (computer.theme) return null;
  if (computer.state.kind === 'connected' && !computer.state.features.includes(REMOTE_FEATURE_THEME)) return 'Update Switchboard there to use its theme.';
  return computer.state.kind === 'connected' ? 'Shows once Switchboard is open there.' : 'Shows once it connects.';
}

/** Three dots of a theme's colours (background, accent, text), in the mode the phone is in. */
function Swatch({ theme }: { theme: RemoteTheme | null }) {
  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return (
    <span aria-hidden className="flex shrink-0 -space-x-1">
      {swatchOf(theme, dark ? 'dark' : 'light').map((color, i) => (
        <span key={i} className="size-4 rounded-full border border-edge" style={{ background: color }} />
      ))}
    </span>
  );
}

/**
 * Theme, from the `⋯` menu: the phone can look like one of its computers, or keep its own look (Demo Time). The
 * phone has one theme for all its computers, so switching between them doesn't change the colours; by default it is
 * the first computer's. Light or dark follows the phone.
 */
export function ThemeSheet({ computers, onClose }: { computers: readonly Computer[]; onClose: () => void }) {
  const choice = useSyncExternalStore(subscribeThemeChoice, themeChoice);
  const picked = themeComputer(choice, computers.map((c) => c.id)) ?? OWN_THEME;
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
    <Sheet title="Theme" subtitle="Light or dark follows this device." onClose={onClose} hook="theme">
      <div role="radiogroup" aria-label="Theme" className="-mx-1 flex flex-col">
        {computers.map((c) => {
          const why = unavailable(c);
          return row(c.id, nameOf(c) || 'Your computer', why ?? c.theme!.name, c.theme, why !== null);
        })}
        {row(OWN_THEME, 'Demo Time', 'The built-in look', null)}
      </div>
    </Sheet>
  );
}
