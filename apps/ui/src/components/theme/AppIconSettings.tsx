import { Check, Info, RotateCcw } from 'lucide-react';
import { APP_ICONS, DEFAULT_APP_ICON, settingsTileFile, type AppIconKey } from '@seshboard/protocol/bridge';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useRemote } from '../../state/remoteStore.ts';
import { Button } from '../ui/Button.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { Toggle } from '../ui/Toggle.tsx';
import { appIconDetail, appIconNote } from './appIconCopy.ts';
import { Heading } from './Heading.tsx';

/** Each colourway's tile (128px, for 64px on a Retina screen), made by the icon script with the platform's corners. */
const TILES = import.meta.glob<string>('../../assets/app-icons/*.png', { eager: true, import: 'default' });
const tileOf = (key: AppIconKey) => TILES[`../../assets/app-icons/${settingsTileFile(key)}`];

/** One colourway: its icon and name; the chosen one has the accent frame, a tint and a check. */
function IconTile({ icon, selected, onSelect }: { icon: (typeof APP_ICONS)[number]; selected: boolean; onSelect(): void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={icon.label}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={`relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-1.5 pt-3 pb-2 ${selected ? 'border-accent-ink bg-accent/10' : 'border-transparent hover:bg-border/45'}`}
      data-app-icon={icon.key}
      data-app-icon-selected={selected || undefined}
    >
      <img src={tileOf(icon.key)} alt="" width={64} height={64} draggable={false} className="size-16" />
      <span className={`max-w-full truncate text-ui ${selected ? 'font-semibold text-text' : 'text-muted'}`}>{icon.label}</span>
      {selected && (
        <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-on-accent" aria-hidden>
          <Check size={11} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

/**
 * Settings › Theme › App icon: nine colourways of the icon in the Dock (macOS) or on the windows and the taskbar. A
 * pick applies at once, through main (`appIcon` in Preferences), which every window hears; with Remote set up, the
 * remote app can follow it.
 */
export function AppIconSettings() {
  const appIcon = usePreferences((s) => s.prefs.appIcon);
  const onRemote = usePreferences((s) => s.prefs.appIconOnRemote);
  const update = usePreferences((s) => s.update);
  // Set up: Remote is on, or a phone or browser is paired (another computer has no Home Screen).
  const remoteSetUp = useRemote((s) => !!s.status?.available && (s.status.settings.enabled || s.status.devices.some((device) => device.kind !== 'computer')));
  const pick = (key: AppIconKey) => update({ appIcon: key });

  return (
    <section className="grid gap-3 border-t border-border pt-6" aria-label="App icon" data-app-icon-settings>
      <Heading title="App icon" description={appIconDetail()}>
        {appIcon !== DEFAULT_APP_ICON && (
          <Button variant="quiet" icon={<RotateCcw size={14} aria-hidden />} onClick={() => pick(DEFAULT_APP_ICON)} data-app-icon-reset>
            Reset to Graphite
          </Button>
        )}
      </Heading>

      <RadioGroup label="App icon" className="grid grid-cols-5 gap-2">
        <div className="contents" data-app-icon-picker>
          {APP_ICONS.map((icon) => (
            <IconTile key={icon.key} icon={icon} selected={icon.key === appIcon} onSelect={() => pick(icon.key)} />
          ))}
        </div>
      </RadioGroup>

      {remoteSetUp && (
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <Toggle
            label="Use it on your phone too"
            detail="The remote app's icon and the browser tab. On a phone, add it to the Home Screen again to see the change."
            checked={onRemote}
            attr="data-app-icon-remote"
            onChange={(appIconOnRemote) => update({ appIconOnRemote })}
          />
        </div>
      )}

      <p className="flex items-start gap-1.5 text-meta text-muted" data-app-icon-note>
        <Info size={13} className="mt-px shrink-0 text-faint" aria-hidden />
        {appIconNote()}
      </p>
    </section>
  );
}
