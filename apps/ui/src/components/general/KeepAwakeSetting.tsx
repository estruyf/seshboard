import { useEffect, useState } from 'react';
import { Coffee } from 'lucide-react';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Toggle } from '../ui/Toggle.tsx';
import { keepAwakeActive, keepAwakeDetail, keepAwakeLabel } from './keepAwake.ts';

/**
 * Asks main whether sleep is held off: after each change of the switch (main applies it before it answers), and each
 * time the window is focused again, since `caffeinate` can end by itself.
 */
function useKeepAwakeStatus(on: boolean): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () => void window.seshboard?.keepAwakeStatus().then((value) => live && setActive(value), () => {});
    check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, [on]);
  return active;
}

/** Settings › General › Keep this Mac awake: no sleep while Seshboard is open, so schedules, triggers and remote access keep working. */
export function KeepAwakeSetting() {
  const on = usePreferences((s) => s.prefs.keepAwake);
  const update = usePreferences((s) => s.update);
  const active = useKeepAwakeStatus(on);

  return (
    <div className="grid gap-1.5">
      <Toggle label={keepAwakeLabel()} detail={keepAwakeDetail()} checked={on} attr="data-keep-awake" onChange={(keepAwake) => update({ keepAwake })} />
      {on && active && (
        <span className="flex items-center gap-1.5 text-meta text-muted" data-keep-awake-status>
          <Coffee size={12} aria-hidden />
          {keepAwakeActive()}
        </span>
      )}
    </div>
  );
}
