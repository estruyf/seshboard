import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { PushPrefs, PushSupport } from '../lib/pushSupport.ts';
import { currentSupport, loadPrefs, markOffered, outdated, turnOff, turnOn, update, type PushComputers } from '../lib/push.ts';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toasts.tsx';
import { Button } from './ui.tsx';

/** The moments, worded as Settings › Notifications on the computer. */
const MOMENTS = [
  { key: 'needsYou', label: 'Needs you', detail: 'Claude asks for a permission, has a question or a plan.', dot: 'bg-warn' },
  { key: 'finished', label: 'Finished', detail: 'Claude finished a turn.', dot: 'bg-unread' },
] as const;

const HOME_SCREEN_STEPS = 'Tap Share, then Add to Home Screen. Open Seshboard from your Home Screen and turn notifications on there.';

/**
 * The one-time offer at the top of the list, after pairing. On an iPhone outside the Home Screen it explains how to
 * add it first, because iOS only allows notifications there.
 */
export function PushOffer({ push, onDone }: { push: PushComputers; onDone: () => void }) {
  const support = currentSupport();
  const [busy, setBusy] = useState(false);
  const close = () => {
    markOffered();
    onDone();
  };
  const on = async () => {
    if (!push.targets.length) return;
    setBusy(true);
    try {
      await turnOn(push);
      toast('Notifications are on');
      close();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Notifications didn't turn on.", { tone: 'error' });
      setBusy(false);
    }
  };
  return (
    <section aria-label="Get notified on this phone" className="mx-4 mt-3 flex flex-col gap-2 rounded-xl border border-border bg-card p-3" data-remote-push-offer>
      <div className="flex items-start gap-2.5">
        <Bell className="mt-0.5 size-4 shrink-0 text-unread" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold">Get notified on this phone</h2>
          {support === 'home-screen' ? (
            <>
              <p className="text-ui font-semibold text-text">Add it to your Home Screen first</p>
              <p className="text-ui text-muted">{HOME_SCREEN_STEPS}</p>
            </>
          ) : (
            <p className="text-ui text-muted">When a session needs you or finishes. Works when this page is closed.</p>
          )}
        </div>
        {support === 'home-screen' && (
          <Button variant="quiet" size="md" aria-label="Close" onClick={close} className="-mt-1 -mr-1.5 px-2!">
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>
      {support !== 'home-screen' && (
        <div className="flex gap-2">
          <Button onClick={close} className="flex-1">
            Not now
          </Button>
          <Button variant="primary" onClick={() => void on()} disabled={!push.targets.length || busy} className="flex-1" data-remote-push-on>
            Turn on
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * The offer on a wide screen: a one-time strip above the main view rather than a card in the list. The words say
 * "tab", since a computer's browser keeps the page in one.
 */
export function PushStrip({ push, onDone }: { push: PushComputers; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const close = () => {
    markOffered();
    onDone();
  };
  const on = async () => {
    if (!push.targets.length) return;
    setBusy(true);
    try {
      await turnOn(push);
      toast('Notifications are on');
      close();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Notifications didn't turn on.", { tone: 'error' });
      setBusy(false);
    }
  };
  return (
    <section aria-label="Get notified" className="flex items-center gap-3 border-b border-border bg-sidebar px-5 py-2" data-remote-push-strip>
      <Bell className="size-4 shrink-0 text-unread" aria-hidden />
      <p className="min-w-0 flex-1 text-ui">Get a notification when a session needs you or finishes, even when this tab is in the background.</p>
      <Button size="md" onClick={close}>
        Not now
      </Button>
      <Button variant="primary" size="md" onClick={() => void on()} disabled={!push.targets.length || busy} data-remote-push-on>
        Turn on
      </Button>
    </section>
  );
}

/** Whether to show the offer: once, where notifications can work, while they're off. */
export function shouldOffer(alreadyOffered: boolean): boolean {
  const support: PushSupport = currentSupport();
  return !alreadyOffered && !loadPrefs().on && (support === 'ready' || support === 'home-screen');
}

/** Why the switches can't change here, or null when they can: not on the Home Screen, blocked, no connection. */
export function pushNote(support: PushSupport, connected: boolean): string | null {
  if (support === 'home-screen') return HOME_SCREEN_STEPS;
  if (support === 'denied') return "Notifications are blocked for this page. Allow them in the browser's settings, then come back here.";
  if (support === 'unsupported') return "This browser can't show notifications from Seshboard Remote.";
  return connected ? null : 'Changing these needs the connection.';
}

/** Notifications on or off as a whole (Settings, the `⋯` menu). On with neither moment picked turns both on. */
export function switchPush(push: PushComputers, on: boolean): Promise<PushPrefs> {
  if (!on) return turnOff(push);
  const prefs = loadPrefs();
  return update(push, prefs.needsYou || prefs.finished ? {} : { needsYou: true, finished: true });
}

/** The look of a switch (the desktop's, apps/ui components/ui/Toggle.tsx, one size up for a finger). */
export function SwitchLook({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-accent' : 'bg-faint/40'}`}>
      <span className={`size-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none ${checked ? 'translate-x-4 bg-on-accent' : 'bg-white'}`} />
    </span>
  );
}

/** Notifications, from the sidebar's `⋯` menu on a wide screen: Needs you and Finished, as on the computer. */
export function NotificationsSheet({ push, onClose }: { push: PushComputers; onClose: () => void }) {
  const connected = push.targets.length > 0;
  const older = outdated(push);
  const support = currentSupport();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [busy, setBusy] = useState(false);
  const toggle = async (key: 'needsYou' | 'finished') => {
    if (!connected || busy) return;
    setBusy(true);
    // Off, a switch turns notifications on with just that moment; on, it changes that moment.
    const change = prefs.on ? { [key]: !prefs[key] } : { needsYou: key === 'needsYou', finished: key === 'finished' };
    try {
      setPrefs(await update(push, change));
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't reach your computer.", { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const note = pushNote(support, connected);
  return (
    <Sheet title="Notifications" subtitle="On this device, even when this page is closed." onClose={onClose} hook="notifications">
      {note && <p className="mb-3 rounded-lg bg-caution/10 px-3 py-2 text-ui text-text">{note}</p>}
      <div className="flex flex-col overflow-hidden rounded-xl border border-border">
        {MOMENTS.map((moment, i) => {
          const checked = prefs.on && prefs[moment.key];
          return (
            <button
              key={moment.key}
              type="button"
              role="switch"
              aria-checked={checked}
              disabled={support !== 'ready' || !connected || busy}
              onClick={() => void toggle(moment.key)}
              className={`flex min-h-14 items-center gap-3 px-3 py-2.5 text-left disabled:opacity-60 ${i > 0 ? 'border-t border-border' : ''}`}
              data-remote-push-switch={moment.key}
            >
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${moment.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-ui font-semibold">{moment.label}</span>
                <span className="block text-meta text-muted">{moment.detail}</span>
              </span>
              <SwitchLook checked={checked} />
            </button>
          );
        })}
      </div>
      {older.length > 0 && (
        <p className="mt-3 rounded-lg bg-caution/10 px-3 py-2 text-ui text-text" data-remote-push-outdated>
          {older.join(', ')} can't send notifications next to your other computers yet. Update Seshboard there to get them.
        </p>
      )}
      <p className="pt-3 text-meta text-faint">
        {push.paired > 1
          ? "Each of your computers sends them through your browser's push service, encrypted for this device. Nothing comes from the computer on screen while this page is open in front of you."
          : "Your computer sends them through your browser's push service, encrypted for this device. Nothing comes while this page is open in front of you."}
      </p>
    </Sheet>
  );
}
