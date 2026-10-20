import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import type { OpenAtLogin } from '@switchboard/protocol/bridge';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Toggle } from '../ui/Toggle.tsx';
import { openAtLoginDetail, openAtLoginUnavailable } from './openAtLogin.ts';

/**
 * Asks main how Open at login stands: when the page opens, and each time the window is focused again, since it can
 * be changed in the system's settings too.
 */
function useOpenAtLogin(): [OpenAtLogin | null, (state: OpenAtLogin) => void] {
  const [state, setState] = useState<OpenAtLogin | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => void window.switchboard?.openAtLogin().then((value) => live && setState(value), () => {});
    check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, []);
  return [state, setState];
}

/** Settings › General › On startup: whether Switchboard opens at login. The system keeps it, not the preferences. */
export function OpenAtLoginSetting() {
  const [state, setState] = useOpenAtLogin();
  const unavailable = state === 'unavailable';
  const set = (on: boolean) => {
    // Shown at once; the system's answer replaces it.
    setState(on ? 'on' : 'off');
    void window.switchboard?.setOpenAtLogin(on).then(setState, () => {});
  };

  return (
    <div className="grid gap-2.5">
      <Toggle
        label="Open at login"
        detail={unavailable ? openAtLoginUnavailable() : openAtLoginDetail()}
        checked={state === 'on' || state === 'needs-approval'}
        disabled={state === null || unavailable}
        attr="data-open-at-login"
        onChange={set}
      />
      {state === 'needs-approval' && (
        <Notice
          tone="caution"
          icon={<LogIn size={14} aria-hidden />}
          actions={
            <Button size="sm" onClick={() => window.switchboard?.openLoginItemsSettings()} data-open-login-items>
              Open System Settings
            </Button>
          }
          data-open-at-login-approval
        >
          macOS waits for you to allow Switchboard in System Settings › General › Login Items.
        </Notice>
      )}
    </div>
  );
}
