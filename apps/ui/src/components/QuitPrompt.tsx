import { useEffect, useRef, useState } from 'react';
import { cacheRewriteCost } from '@seshboard/protocol/client';
import { isActiveHost, useHosts } from '../state/hostsStore.ts';
import { usePreferences } from '../state/preferencesStore.ts';
import { useTerminals } from '../state/terminalsStore.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { openUnsentList } from './drafts/UnsentList.tsx';
import { useUnsent } from './drafts/useUnsent.ts';
import { quitSummary } from '../state/drafts.ts';
import { Kbd } from './ui/Kbd.tsx';
import { Checkbox } from './ui/Checkbox.tsx';
import { largeSessions, largeSessionsText } from './session/largeContext.ts';
import { useCostFormat } from './usage/useCost.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What quitting would stop, in one sentence (or null when nothing is open). Restarting to update asks with it too. */
export function useQuitImpact(): string | null {
  const hosts = useHosts((s) => s.hosts);
  const terminals = useTerminals((s) => s.terminals.size);
  const open = [...hosts.values()].filter(isActiveHost);
  const working = open.filter((h) => h.state === 'running' || h.state === 'starting' || h.state === 'needs-you').length;
  const parts: string[] = [];
  if (working > 0) parts.push(`${plural(working, 'session is', 'sessions are')} still working and will stop`);
  else if (open.length > 0) parts.push(`${plural(open.length, 'open session', 'open sessions')} will close (you can resume ${open.length === 1 ? 'it' : 'them'} later)`);
  if (terminals > 0) parts.push(`${plural(terminals, 'terminal tab', 'terminal tabs')} will close`);
  if (parts.length === 0) return null;
  const sentence = parts.join(', and ');
  return `${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * Settings › Usage › Large context on quitting: what to say about the open sessions with a large context, and whether
 * it is the one-time tip (Warn when quitting is off, and the prompt hasn't said yet that it can). Null when it says
 * nothing. Main hears whether it should ask because of it, so it does even with Ask before quitting off.
 */
function useQuitLargeContext(): { text: string; tip: boolean } | null {
  const hosts = useHosts((s) => s.hosts);
  const warning = usePreferences((s) => s.prefs.contextWarning);
  const format = useCostFormat();
  const large = warning.enabled && (warning.onQuit || !warning.quitTipShown) ? largeSessions(hosts.values(), warning, cacheRewriteCost) : [];
  const text = largeSessionsText(large, format);
  const ask = text !== null;
  useEffect(() => window.seshboard?.setQuitContext(ask), [ask]);
  return text ? { text, tip: !warning.onQuit } : null;
}

/** Asks before quitting when ⌘Q is pressed. Main quits straight away on a second ⌘Q. */
export function QuitPrompt() {
  const [open, setOpen] = useState(false);
  const answered = useRef(false);
  const impact = useQuitImpact();
  const unsent = useUnsent().length;
  const summary = quitSummary(impact, unsent);
  const large = useQuitLargeContext();
  // What the prompt said when it opened: ticking the tip's box doesn't make the paragraph go away.
  const [shown, setShown] = useState<{ text: string; tip: boolean } | null>(null);
  const onQuit = usePreferences((s) => s.prefs.contextWarning.onQuit);
  const update = usePreferences((s) => s.update);
  const largeRef = useRef(large);
  largeRef.current = large;

  useEffect(
    () =>
      window.seshboard?.onQuitRequested(() => {
        answered.current = false;
        const now = largeRef.current;
        setShown(now);
        // The tip is said once; from then on only Warn when quitting brings it back.
        if (now?.tip) update({ contextWarning: { quitTipShown: true } });
        setOpen(true);
      }),
    [],
  );

  if (!open) return null;
  const answer = (value: 'quit' | 'cancel') => {
    if (answered.current) return;
    answered.current = true;
    window.seshboard?.answerQuit(value);
  };

  const cancel = () => {
    answer('cancel');
    setOpen(false);
  };
  return (
    <ConfirmDialog
      title="Quit Seshboard?"
      body={
        <>
          {summary.length > 0 && <p data-quit-unsent={unsent || undefined}>{summary.join(' ')}</p>}
          {shown && (
            <div className={summary.length > 0 ? 'mt-2' : undefined} data-quit-large-context={shown.tip ? 'tip' : 'warning'}>
              <p>{shown.text}</p>
              {shown.tip && (
                <Checkbox checked={onQuit} onChange={(checked) => update({ contextWarning: { onQuit: checked } })} className="mt-2" dataAttrs={{ 'data-quit-warn-large': true }}>
                  Warn me about this every time I quit
                </Checkbox>
              )}
            </div>
          )}
          <p className={summary.length > 0 || shown ? 'mt-2' : undefined}>
            Press <Kbd shortcut="quit" /> again to quit.
          </p>
        </>
      }
      confirmLabel="Quit"
      // Show unsent stays in the app and opens the list; Escape just stays.
      secondary={
        unsent > 0
          ? {
              label: 'Show unsent',
              data: { 'data-quit-show-unsent': true },
              onSelect: () => {
                cancel();
                requestAnimationFrame(openUnsentList);
              },
            }
          : undefined
      }
      onConfirm={async () => answer('quit')}
      onClose={cancel}
    />
  );
}
