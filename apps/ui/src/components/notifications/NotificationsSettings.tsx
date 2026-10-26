import { Bell, BellOff, Play, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NO_SOUND, resolveSound, type NotificationPermission, type SoundEvent, type SoundList } from '@seshboard/protocol/bridge';
import { currentPlatform } from '../../lib/platform.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Select } from '../ui/Select.tsx';
import { Slider } from '../ui/Slider.tsx';
import { Switch } from '../ui/Toggle.tsx';

/** The moments that play a sound, in the order the page lists them, with the sidebar's colour for each. */
const MOMENTS: Array<{ event: SoundEvent; label: string; detail: string; dot: string }> = [
  { event: 'needsYou', label: 'Needs you', detail: 'Claude asks for a permission, has a question or a plan.', dot: 'bg-warn' },
  { event: 'finished', label: 'Finished', detail: 'Claude finished a turn.', dot: 'bg-unread' },
  { event: 'error', label: 'Stopped with an error', detail: 'Claude stopped because something failed.', dot: 'bg-error' },
  { event: 'actionEnded', label: 'Project action ended', detail: 'A project action like Dev or Test stopped.', dot: 'bg-muted' },
];

const percent = (volume: number) => `${Math.round(volume)}%`;
/** Hovering down the list plays only the sound the pointer rests on. */
const HOVER_DELAY_MS = 120;

/** A card's first row: its icon, name and what it does, and the switch that turns it on. */
function CardHeader({ label, detail, icon, children }: { label: string; detail: string; icon: ReactNode; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3.5" data-setting-row>
      <span className="flex shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui font-semibold text-text">{label}</span>
        <span className="block text-meta text-muted">{detail}</span>
      </span>
      {children}
    </label>
  );
}

/** A row under a card's header; `off` dims it while the card's switch is off. */
function Row({ label, detail, off, className = '', children, ...data }: { label: string; detail?: string; off: boolean; className?: string; children: ReactNode } & Record<`data-${string}`, string | boolean>) {
  return (
    <div className={`flex items-center gap-3 border-t border-border px-4 py-2.5 ${off ? 'opacity-50' : ''} ${className}`} aria-disabled={off || undefined} data-setting-row {...data}>
      <span className="min-w-0 flex-1">
        <span className="block text-ui text-text">{label}</span>
        {detail && <span className="block text-meta text-muted">{detail}</span>}
      </span>
      {children}
    </div>
  );
}

/** Asks main whether the system lets Seshboard notify: when the page opens, and each time the window is focused again. */
function useNotificationPermission(): NotificationPermission {
  const [permission, setPermission] = useState<NotificationPermission>('unknown');
  useEffect(() => {
    let live = true;
    const check = () => void window.seshboard?.notificationPermission().then((value) => live && setPermission(value), () => {});
    check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, []);
  return permission;
}

/**
 * Settings › Notifications: a card for the system notifications and one for the sounds, each with its own switch.
 * Each moment has its own sound. Sounds off keeps the sounds picked, dimmed, for when they are turned on again.
 */
export function NotificationsSettings() {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const [list, setList] = useState<SoundList | null>(null);
  const permission = useNotificationPermission();
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    let live = true;
    void window.seshboard?.listSounds().then((sounds) => live && setList(sounds));
    return () => {
      live = false;
      clearTimeout(hover.current);
    };
  }, []);

  const { notifications, sounds } = prefs;
  const soundsOff = !sounds.enabled;
  const play = (id: string, volume = sounds.volume) => {
    clearTimeout(hover.current);
    window.seshboard?.playSound(id, volume);
  };
  const preview = (id: string) => {
    clearTimeout(hover.current);
    if (id !== NO_SOUND) hover.current = setTimeout(() => window.seshboard?.playSound(id, sounds.volume), HOVER_DELAY_MS);
  };
  // A sound this computer lacks (chosen on a Mac, imported on Windows) shows as the one that plays instead.
  const current = (event: SoundEvent) => (list ? resolveSound(sounds.byEvent[event], list, event) : null);
  const windows = currentPlatform() === 'win32';
  const systemSettings = windows ? 'Windows settings' : 'System Settings';
  // Newer macOS no longer tells us (see notificationPermission.ts), so the page points to the system's own setting.
  const cantTell = permission === 'unknown' && (windows || currentPlatform() === 'darwin');

  return (
    <div className="grid gap-4" data-notification-settings>
      {permission === 'blocked' && (
        <Notice
          tone="caution"
          icon={<BellOff size={14} aria-hidden />}
          actions={
            <Button size="sm" onClick={() => window.seshboard?.openNotificationSettings()} data-open-notification-settings>
              {windows ? 'Open Windows settings' : 'Open System Settings'}
            </Button>
          }
          data-notifications-blocked
        >
          Notifications are off for Seshboard in {systemSettings}. Sounds and the {windows ? 'taskbar dot' : 'Dock badge'} still work.
        </Notice>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Notifications" data-notifications-card>
        <CardHeader label="Notifications" detail="A system notification when Claude needs you, finishes or stops with an error, and when a project action ends." icon={<Bell size={16} aria-hidden />}>
          <Switch checked={notifications.enabled} onChange={(enabled) => update({ notifications: { enabled } })} dataAttrs={{ 'data-notifications-toggle': true }} />
        </CardHeader>
        <Row label="Check that they come through." detail={cantTell ? `Nothing showed up? Check that Seshboard is allowed to send notifications in ${systemSettings}.` : undefined} off={!notifications.enabled}>
          {cantTell && (
            <Button variant="quiet" size="sm" onClick={() => window.seshboard?.openNotificationSettings()} data-open-notification-settings-hint>
              {windows ? 'Open Windows settings' : 'Open System Settings'}
            </Button>
          )}
          <Button variant="quiet" size="sm" disabled={!notifications.enabled} onClick={() => window.seshboard?.testNotification()} data-notifications-test>
            Send a test notification
          </Button>
        </Row>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Sounds" data-sounds-card>
        <CardHeader label="Sounds" detail="A sound per moment. Works with notifications on or off." icon={<Volume2 size={16} aria-hidden />}>
          <Switch checked={sounds.enabled} onChange={(enabled) => update({ sounds: { enabled } })} dataAttrs={{ 'data-sounds-toggle': true }} />
        </CardHeader>
        {list && list.sounds.length === 0 ? (
          <div className="border-t border-border px-4 py-2.5 text-ui text-muted">
            <Notice inline>This computer has no system sounds to play.</Notice>
          </div>
        ) : (
          MOMENTS.map(({ event, label, detail, dot }) => {
            const sound = current(event);
            return (
              <div key={event} className={`flex items-center gap-3 border-t border-border px-4 py-2.5 ${soundsOff ? 'opacity-50' : ''}`} aria-disabled={soundsOff || undefined} data-setting-row data-sound-event={event}>
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui text-text">{label}</span>
                  <span className="block text-meta text-muted">{detail}</span>
                </span>
                <Select<string>
                  label={`${label} sound`}
                  value={list ? (sound ?? NO_SOUND) : sounds.byEvent[event]}
                  disabled={soundsOff || !list}
                  onChange={(value) => update({ sounds: { byEvent: { [event]: value } } })}
                  onHighlight={preview}
                  options={[{ value: NO_SOUND, label: 'None' }, ...(list?.sounds ?? []).map((id) => ({ value: id, label: id }))]}
                  menuWidth={200}
                  className="h-7 w-30 shrink-0 rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink/60"
                  dataAttrs={{ 'data-sound-picker': event }}
                />
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  icon={<Play size={12} aria-hidden />}
                  aria-label={sound ? `Play ${sound}` : `No sound for ${label}`}
                  disabled={soundsOff || !sound}
                  onClick={() => sound && play(sound)}
                  data-sound-preview={event}
                />
              </div>
            );
          })
        )}
        <Row label="Volume" off={soundsOff} className="bg-border/20">
          <Slider
            label="Volume"
            value={Math.round(sounds.volume * 100)}
            min={0}
            max={100}
            step={5}
            format={percent}
            disabled={soundsOff}
            onChange={(value) => {
              const volume = value / 100;
              update({ sounds: { volume } });
              // Let go at a new volume: hear it, with the first moment that has a sound.
              const sound = MOMENTS.map(({ event }) => current(event)).find((id) => id !== null);
              if (sound) play(sound, volume);
            }}
            dataAttrs={{ 'data-sound-volume': true }}
          />
        </Row>
      </section>
    </div>
  );
}
