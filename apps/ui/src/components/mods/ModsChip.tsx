import { Puzzle } from 'lucide-react';
import { useRef, useState } from 'react';
import { drawsOf, useSessionMods } from '../../state/modsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Popover } from '../ui/Popover.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { modShown, withModShown } from './modVisibility.ts';

/**
 * The puzzle chip in the session header ("3 mods"): the mods in this session, what each draws, and a switch to show
 * or hide its UI here. Gone with Show mods off, or when the session has no mods.
 */
export function ModsChip({ sessionId, profileId }: { sessionId: string; profileId: string | null }) {
  const mods = useSessionMods(sessionId);
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const plugins = mods.state.plugins;
  if (!prefs.showMods || !mods.state.attached || plugins.length === 0) return null;
  const label = `${plugins.length} ${plugins.length === 1 ? 'mod' : 'mods'}`;
  const go = (section: 'mods' | 'diagnostics') => {
    setOpen(null);
    useSessions.getState().openSettings(section);
  };
  return (
    <div className="no-drag relative flex shrink-0 items-center @max-[420px]:hidden">
      <Button
        ref={button}
        variant="quiet"
        size="md"
        icon={<Puzzle size={14} aria-hidden />}
        selected={open !== null}
        aria-expanded={open !== null}
        aria-haspopup="dialog"
        onClick={() => {
          const rect = button.current!.getBoundingClientRect();
          setOpen(open ? null : { x: rect.right - 340, y: rect.bottom + 6 });
        }}
        data-tooltip="Mods in this session"
        data-mods-chip={plugins.length}
      >
        {label}
      </Button>
      {open && (
        <Popover x={open.x} y={open.y} width={340} anchor={button} onClose={() => setOpen(null)} className="overlay rounded-xl p-0" role="dialog" aria-label="Mods in this session" data-mods-popover>
          <h2 className="border-b border-edge px-3.5 py-2.5 text-ui font-semibold text-text">Mods in this session</h2>
          <ul className="max-h-80 overflow-y-auto">
            {plugins.map((plugin) => {
              const draws = drawsOf(mods, plugin);
              const shown = modShown(prefs, profileId, plugin);
              return (
                <li key={plugin} className="flex items-center gap-2.5 border-b border-edge px-3.5 py-2 last:border-b-0" data-mods-popover-row={plugin}>
                  <Puzzle size={14} className="shrink-0 text-muted" aria-hidden />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-ui text-text">{plugin}</span>
                    {draws.length > 0 && <span className="truncate text-meta text-muted">{draws.join(' · ')}</span>}
                  </span>
                  <span className="shrink-0 text-meta text-muted">Show its UI</span>
                  <Switch
                    checked={shown}
                    label={`Show ${plugin}'s UI`}
                    onChange={(on) => update({ hiddenMods: withModShown(prefs.hiddenMods, profileId ?? '', plugin, on) })}
                    dataAttrs={{ 'data-mod-switch': plugin }}
                  />
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-edge px-2 py-1.5">
            <Button variant="quiet" size="sm" onClick={() => go('mods')} data-mods-settings>
              Settings › Mods
            </Button>
            <Button variant="quiet" size="sm" onClick={() => go('diagnostics')} data-mods-logs>
              Logs
            </Button>
          </div>
        </Popover>
      )}
    </div>
  );
}
