import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Bell, Check, ChevronLeft, ChevronRight, Laptop, Moon, Plug, PlugZap, Plus, Type } from 'lucide-react';
import { nameOf, type Computer } from '../lib/computers.ts';
import { computerRowLine, pairedAgo } from '../lib/computer.ts';
import { currentSupport, outdated, update, type PushComputers } from '../lib/push.ts';
import type { PushPrefs } from '../lib/pushSupport.ts';
import { TEXT_SIZES } from '../lib/textSize.ts';
import { chooseTextSize, subscribeTextSize, textSizeChoice } from '../lib/themeApply.ts';
import { TONE_DOT } from './ConnectionStatus.tsx';
import { pushNote, switchPush, SwitchLook } from './Notifications.tsx';
import { ColourChoices, ModeChoices } from './ThemeSheet.tsx';
import { toast } from './Toasts.tsx';
import { RoundButton } from './ui.tsx';

/** This build of the remote app (vite.config.ts); empty while developing. */
const BUILD: string = import.meta.env.VITE_APP_BUILD ?? '';
/** Where Send feedback goes. */
const ISSUES = 'https://github.com/estruyf/switchboard/issues';

/**
 * The Settings page: Appearance (Theme, its colours, Text size), Notifications, the paired computers (switch to
 * another, pair one more), Disconnect and Forget for the one on screen, and About. Opened from the drawer and from
 * Home's `⋯`; it is a route of its own, so the back gesture returns.
 */
export function SettingsView({
  computers,
  current,
  push,
  prefs,
  onPrefs,
  onSyncThemes,
  onSwitch,
  onAdd,
  onDisconnect,
  onConnect,
  onForget,
  onBack,
  banner,
}: {
  computers: readonly Computer[];
  /** The computer on screen: what Disconnect and Forget are about. */
  current: Computer;
  push: PushComputers;
  prefs: PushPrefs;
  /** The switches changed what the computers know (Connected keeps them for the `⋯` menu). */
  onPrefs: (prefs: PushPrefs) => void;
  onSyncThemes: () => Promise<boolean>;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onDisconnect: () => void;
  onConnect: () => void;
  onForget: () => void;
  onBack: () => void;
  banner: ReactNode;
}) {
  const textSize = useSyncExternalStore(subscribeTextSize, textSizeChoice);
  const [busy, setBusy] = useState(false);
  const support = currentSupport();
  const connected = push.targets.length > 0;
  const note = pushNote(support, connected);
  const older = outdated(push);
  const pushOn = prefs.on && (prefs.needsYou || prefs.finished);
  const onlyNeeds = pushOn && prefs.needsYou && !prefs.finished;
  const canChange = support === 'ready' && connected && !busy;
  const change = async (run: () => Promise<PushPrefs>) => {
    if (!canChange) return;
    setBusy(true);
    try {
      onPrefs(await run());
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't reach your computer.", { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const name = nameOf(current) || 'your computer';
  const now = Date.now();
  const appVersion = current.state.kind === 'connected' ? current.state.appVersion : '';

  return (
    <div className="flex h-full flex-col bg-bg" data-remote-settings>
      <header className="safe-top flex items-center gap-1 px-2 pb-2">
        <RoundButton aria-label="Back" onClick={onBack} data-remote-settings-back>
          <ChevronLeft aria-hidden />
        </RoundButton>
        <h1 className="min-w-0 flex-1 truncate pl-1 text-title font-semibold">Settings</h1>
      </header>
      {banner}
      <main className="safe-bottom min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pt-2 pb-6">
          <Group id="settings-appearance" title="Appearance">
            <Row icon={<Moon />}>
              <span id="settings-theme" className="flex-1 text-body">
                Theme
              </span>
              <ModeChoices labelledBy="settings-theme" compact />
            </Row>
            <ColourChoices computers={computers} onSync={onSyncThemes} inset />
            <Row icon={<Type />} border>
              <span id="settings-text-size" className="flex-1 text-body">
                Text size
              </span>
              <div role="radiogroup" aria-labelledby="settings-text-size" className="grid shrink-0 grid-cols-3 gap-0.5 rounded-lg border border-edge bg-sidebar p-0.5" data-remote-text-size={textSize}>
                {TEXT_SIZES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={option.value === textSize}
                    onClick={() => chooseTextSize(option.value)}
                    className={`min-h-9 rounded-md px-2 text-meta pointer-fine:min-h-6 ${option.value === textSize ? 'bg-card font-semibold text-text shadow-sm' : 'text-muted active:bg-selected'}`}
                    data-remote-text-size-option={option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Row>
          </Group>

          <Group id="settings-notifications" title="Notifications" note={note}>
            <SwitchRow icon={<Bell />} label="Push notifications" detail="When Claude needs you or finishes" checked={pushOn} disabled={!canChange} onToggle={() => void change(() => switchPush(push, !pushOn))} hook="push" />
            <SwitchRow
              label="Only when it needs me"
              checked={onlyNeeds}
              disabled={!canChange || !pushOn}
              onToggle={() => void change(() => update(push, onlyNeeds ? { finished: true } : { needsYou: true, finished: false }))}
              border
              hook="needs-you-only"
            />
            {older.length > 0 && (
              <p className="border-t border-border px-3 py-2 text-ui text-text" data-remote-push-outdated>
                {older.join(', ')} can't send notifications next to your other computers yet. Update Switchboard there to get them.
              </p>
            )}
          </Group>

          <Group id="settings-computers" title="Computers">
            {computers.map((c, i) => {
              const isCurrent = c.id === current.id;
              const line = computerRowLine(c.state, { encrypted: false });
              const content = (
                <>
                  <Laptop aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{nameOf(c) || 'Your computer'}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
                      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[line.tone]}`} />
                      <span className="truncate">
                        {line.text} · {pairedAgo(c.paired.pairedAt, now)}
                      </span>
                    </span>
                  </span>
                </>
              );
              const rowClass = `flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left ${i > 0 ? 'border-t border-border' : ''}`;
              return isCurrent ? (
                <div key={c.id} className={rowClass} aria-current="true" data-remote-settings-computer={c.id}>
                  {content}
                  <Check aria-label="On screen" role="img" className="size-4 shrink-0 text-ok" />
                </div>
              ) : (
                <button key={c.id} type="button" onClick={() => onSwitch(c.id)} aria-label={`Switch to ${nameOf(c) || 'your computer'}`} className={`${rowClass} active:bg-selected`} data-remote-settings-computer={c.id}>
                  {content}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
                </button>
              );
            })}
            <button type="button" onClick={onAdd} className="flex min-h-12 w-full items-center gap-3 border-t border-border px-3 text-left active:bg-selected" data-remote-settings-pair>
              <Plus aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="flex-1 text-body">Pair another computer</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
            </button>
          </Group>

          {current.state.kind !== 'unpaired' && (
            <Group id="settings-connection">
              {current.state.kind === 'disconnected' ? (
                <ActionRow icon={<PlugZap />} label={`Connect to ${name}`} detail="Your sessions show again once it connects." onClick={onConnect} hook="connect" />
              ) : (
                <ActionRow icon={<Plug />} label={`Disconnect from ${name}`} detail="Stays paired. Connect again any time." onClick={onDisconnect} hook="disconnect" />
              )}
              <button type="button" onClick={onForget} className="flex min-h-12 w-full items-center border-t border-border px-3 text-left text-body text-error active:bg-error/10" data-remote-settings-forget>
                Forget this computer…
              </button>
            </Group>
          )}

          <Group id="settings-about" title="About">
            <div className="flex min-h-12 items-center gap-3 px-3">
              <span className="flex-1 text-body">Version</span>
              <span className="text-ui text-muted tabular-nums" data-remote-settings-version>
                {BUILD || 'Development'}
              </span>
            </div>
            {appVersion && (
              <div className="flex min-h-12 items-center gap-3 border-t border-border px-3">
                <span className="min-w-0 flex-1 truncate text-body">Switchboard on {name}</span>
                <span className="text-ui text-muted tabular-nums">{appVersion}</span>
              </div>
            )}
            <a href={ISSUES} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center gap-3 border-t border-border px-3 active:bg-selected" data-remote-settings-feedback>
              <span className="flex-1 text-body">Send feedback</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
            </a>
          </Group>
        </div>
      </main>
    </div>
  );
}

/** A group of rows in a rounded box, with its heading in small capitals and a note under the heading. */
function Group({ id, title, note, children }: { id: string; title?: string; note?: string | null; children: ReactNode }) {
  return (
    <section aria-labelledby={title ? id : undefined} className="flex flex-col gap-1.5" data-remote-settings-group={id}>
      {title && (
        <h2 id={id} className="px-1 text-meta font-semibold tracking-wide text-faint uppercase">
          {title}
        </h2>
      )}
      {note && <p className="rounded-lg bg-caution/10 px-3 py-2 text-ui text-text">{note}</p>}
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">{children}</div>
    </section>
  );
}

function Row({ icon, border = false, children }: { icon?: ReactNode; border?: boolean; children: ReactNode }) {
  return (
    <div className={`flex min-h-12 items-center gap-3 px-3 py-1 ${border ? 'border-t border-border' : ''}`}>
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-muted [&>svg]:size-4">{icon}</span>}
      {children}
    </div>
  );
}

/** A real switch (`role="switch"`): the whole row toggles it. */
function SwitchRow({ icon, label, detail, checked, disabled, onToggle, border = false, hook }: { icon?: ReactNode; label: string; detail?: string; checked: boolean; disabled: boolean; onToggle: () => void; border?: boolean; hook: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onToggle} className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-60 ${border ? 'border-t border-border' : ''}`} data-remote-settings-switch={hook}>
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-muted [&>svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-body">{label}</span>
        {detail && <span className="block text-meta text-muted">{detail}</span>}
      </span>
      <SwitchLook checked={checked} />
    </button>
  );
}

function ActionRow({ icon, label, detail, onClick, hook }: { icon: ReactNode; label: string; detail: string; onClick: () => void; hook: string }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-selected" data-remote-settings-action={hook}>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted [&>svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{label}</span>
        <span className="block text-meta text-muted">{detail}</span>
      </span>
    </button>
  );
}
