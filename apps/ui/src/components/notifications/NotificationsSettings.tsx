import { Volume2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { resolveSound, type Preferences, type SoundKind, type SoundList } from '@switchboard/protocol/bridge';
import { currentPlatform } from '../../lib/platform.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Select } from '../ui/Select.tsx';
import { Slider } from '../ui/Slider.tsx';
import { Switch, Toggle } from '../ui/Toggle.tsx';

/** The preference each sound is saved in. */
const SOUND_PREF = { complete: 'soundComplete', needsInput: 'soundNeedsInput' } as const satisfies Record<SoundKind, keyof Preferences>;
/** The value None stands for in the dropdown (a sound's name is never empty). */
const NONE = '';

const percent = (volume: number) => `${Math.round(volume)}%`;

function Row({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-border py-3 first:border-t-0 first:pt-0" data-setting-row>
      <span className="min-w-0">
        <span className="block text-ui text-text">{label}</span>
        <span className="block text-meta text-muted">{detail}</span>
      </span>
      {children}
    </div>
  );
}

/** A sound's dropdown, with None first, and a button that plays it. Choosing a sound plays it too. */
function SoundPicker({ kind, label, list, play }: { kind: SoundKind; label: string; list: SoundList; play(id: string): void }) {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  // A sound this computer lacks (chosen on a Mac, imported on Windows) shows as the one that plays instead.
  const current = resolveSound(prefs[SOUND_PREF[kind]], list, kind);
  const hook = kind === 'complete' ? 'complete' : 'needs-input';
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Select<string>
        label={`${label} sound`}
        value={current ?? NONE}
        onChange={(value) => {
          update({ [SOUND_PREF[kind]]: value === NONE ? null : value });
          if (value !== NONE) play(value);
        }}
        options={[{ value: NONE, label: 'None' }, ...list.sounds.map((sound) => ({ value: sound, label: sound }))]}
        menuWidth={220}
        className="h-7 w-44 rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink/60"
        dataAttrs={{ [`data-sound-${hook}`]: true }}
      />
      <Button variant="quiet" iconOnly icon={<Volume2 size={14} aria-hidden />} aria-label={`Play ${label} sound`} disabled={!current} onClick={() => current && play(current)} data-sound-preview={hook} />
    </span>
  );
}

/** Settings › Notifications: system notifications on or off, and the sounds for a session that needs you or finishes. */
export function NotificationsSettings() {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const [list, setList] = useState<SoundList | null>(null);
  useEffect(() => {
    let live = true;
    void window.switchboard?.listSounds().then((sounds) => live && setList(sounds));
    return () => {
      live = false;
    };
  }, []);
  const play = (id: string, volume = prefs.soundVolume) => window.switchboard?.playSound(id, volume);
  const badge = currentPlatform() === 'win32' ? 'The dot on the taskbar button' : 'The Dock badge';

  return (
    <div className="grid gap-5" data-notification-settings>
      <Toggle
        label="Show notifications"
        detail={`When Claude needs you, finishes or stops with an error, and when a project action ends. ${badge} shows either way.`}
        checked={prefs.notifications}
        attr="data-notifications"
        onChange={(notifications) => update({ notifications })}
      />
      <div className="rounded-xl border border-border bg-card px-4 py-3.5">
        <label className="flex cursor-pointer items-center justify-between gap-6" data-setting-row>
          <span className="min-w-0">
            <span className="block text-ui text-text">Play sounds</span>
            <span className="block text-meta text-muted">A sound for the same moments, also with notifications off.</span>
          </span>
          <Switch checked={prefs.sounds} onChange={(sounds) => update({ sounds })} dataAttrs={{ 'data-sounds': true }} />
        </label>
        {/* Only what the switch turns on: hidden while sounds are off. */}
        {prefs.sounds && list && (
          <div className="mt-3 border-t border-border pt-3" data-sound-options>
            {list.sounds.length === 0 ? (
              <Notice inline>This computer has no system sounds to play.</Notice>
            ) : (
              <>
                <Row label="Session complete" detail="When Claude finishes a turn or stops with an error, and when a project action ends.">
                  <SoundPicker kind="complete" label="Session complete" list={list} play={play} />
                </Row>
                <Row label="Needs input" detail="When Claude asks for a permission, has a question or a plan.">
                  <SoundPicker kind="needsInput" label="Needs input" list={list} play={play} />
                </Row>
                <Row label="Volume" detail="For both sounds.">
                  <Slider
                    label="Volume"
                    value={Math.round(prefs.soundVolume * 100)}
                    min={0}
                    max={100}
                    step={5}
                    format={percent}
                    onChange={(value) => {
                      const soundVolume = value / 100;
                      update({ soundVolume });
                      // Let go at a new volume: hear it, with the sound that plays most.
                      const sound = resolveSound(prefs.soundComplete, list, 'complete') ?? resolveSound(prefs.soundNeedsInput, list, 'needsInput');
                      if (sound) play(sound, soundVolume);
                    }}
                    dataAttrs={{ 'data-sound-volume': true }}
                  />
                </Row>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
