import { useEffect, useState } from 'react';
import { DEFAULT_QUICK_START_SHORTCUT, type QuickStartStatus } from '@seshboard/protocol/client';
import { shortcutFromEvent } from '../../lib/shortcuts.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Toggle } from '../ui/Toggle.tsx';
import { BACKGROUND_LABEL, backgroundDetail, inUseMessage, NEEDS_YOU_DETAIL, NEEDS_YOU_LABEL, SHORTCUT_DETAIL, SHORTCUT_LABEL, shortcutProblem } from './quickStartCopy.ts';

/** How the global shortcut stands in main: registered, or taken by another app. */
function useQuickStartStatus(): QuickStartStatus | null {
  const [status, setStatus] = useState<QuickStartStatus | null>(null);
  useEffect(() => {
    let live = true;
    void window.seshboard?.quickStartStatus().then((s) => live && setStatus(s), () => {});
    const off = window.seshboard?.onQuickStartStatus(setStatus);
    return () => {
      live = false;
      off?.();
    };
  }, []);
  return status;
}

/**
 * Settings › General › Quick start: the global shortcut that opens the panel from any app (a key recorder, with
 * Reset), whether ↩ starts in the background, and whether the panel lists what needs you. Main registers the
 * shortcut and says when another app has it.
 */
export function QuickStartSettings() {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const status = useQuickStartStatus();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shortcut = prefs.quickStartShortcut;
  const taken = status && status.shortcut === shortcut && !status.registered;
  const message = error ?? (taken ? inUseMessage(shortcut) : null);
  return (
    <>
      <div className="grid gap-1" data-quick-start-setting={taken ? 'taken' : 'ok'}>
        <div className="flex items-center justify-between gap-4" data-setting-row>
          <span>
            <span className="block text-ui" id="quick-start-shortcut-label">
              {SHORTCUT_LABEL}
            </span>
            <span className="block text-meta text-muted">{SHORTCUT_DETAIL}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-labelledby="quick-start-shortcut-label quick-start-shortcut-value"
              aria-describedby={message ? 'quick-start-shortcut-error' : undefined}
              onClick={() => (setRecording(true), setError(null))}
              onBlur={() => setRecording(false)}
              onKeyDown={(event) => {
                if (!recording) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') return setRecording(false);
                const pressed = shortcutFromEvent(event.nativeEvent);
                if (!pressed) return;
                const problem = shortcutProblem(pressed);
                if (problem) return setError(problem);
                setError(null);
                setRecording(false);
                update({ quickStartShortcut: pressed });
              }}
              className={`flex h-7 items-center rounded-lg border px-2 text-ui outline-none ${recording ? 'border-accent-ink' : message ? 'border-error' : 'border-edge'}`}
              data-quick-start-shortcut
            >
              <span id="quick-start-shortcut-value">{recording ? <span className="text-accent-ink">Press keys, Esc cancels</span> : <Kbd keys={shortcut} tone="plain" className="text-text" />}</span>
            </button>
            {shortcut !== DEFAULT_QUICK_START_SHORTCUT && !recording && (
              <Button
                size="sm"
                onClick={() => {
                  setError(null);
                  update({ quickStartShortcut: DEFAULT_QUICK_START_SHORTCUT });
                }}
                data-quick-start-shortcut-reset
              >
                Reset
              </Button>
            )}
          </span>
        </div>
        {message && (
          <span id="quick-start-shortcut-error" role="alert" className="text-meta text-error" data-quick-start-shortcut-error>
            {message}
          </span>
        )}
      </div>
      <Toggle label={BACKGROUND_LABEL} detail={backgroundDetail()} checked={prefs.quickStartBackground} attr="data-quick-start-background" onChange={(quickStartBackground) => update({ quickStartBackground })} />
      <Toggle label={NEEDS_YOU_LABEL} detail={NEEDS_YOU_DETAIL} checked={prefs.quickStartNeedsYou} attr="data-quick-start-needs-you" onChange={(quickStartNeedsYou) => update({ quickStartNeedsYou })} />
    </>
  );
}
