import { useEffect, useState } from 'react';
import { Loader2, SquareTerminal } from 'lucide-react';
import type { ShellCommandState } from '@seshboard/protocol/bridge';
import { Button } from '../ui/Button.tsx';
import { currentPlatform } from '../../lib/platform.ts';
import { shellCommandAction, shellCommandStatus } from './shellCommand.ts';

/**
 * Settings › General › Shell command: installs `seshboard`, `sesh` and `switchboard`, so `seshboard .` in a terminal opens
 * New session in that folder. Main writes the files; it is asked again each time the window is focused, since the
 * files can be changed from a terminal too.
 */
export function ShellCommandSetting() {
  const [state, setState] = useState<ShellCommandState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => void window.seshboard?.shellCommand().then((result) => live && setState(result.state), () => {});
    check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, []);

  const next = state ? shellCommandAction(state) : null;
  const run = () => {
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    window.seshboard
      ?.shellCommand(next.action)
      .then((result) => {
        setState(result.state);
        setError(result.error);
      }, (failed: unknown) => setError(failed instanceof Error ? failed.message : String(failed)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="grid gap-1.5" data-shell-command={state?.status ?? 'loading'}>
      <div className="flex items-center justify-between gap-4" data-setting-row>
        <span>
          <span className="block text-ui">Shell command</span>
          {/* The same words as shellCommandDetail (Settings search), with the commands in monospace. */}
          <span className="block text-meta text-muted">
            Type <code className="font-mono">seshboard .</code> in a terminal to open New session in that folder. <code className="font-mono">sesh .</code> and{' '}
            <code className="font-mono">switchboard .</code> do the same.
            {currentPlatform() === 'linux' && ' ~/.local/bin has to be on your PATH.'}
          </span>
        </span>
        {next && (
          <Button size="sm" className="shrink-0" icon={busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <SquareTerminal size={12} aria-hidden />} aria-busy={busy} onClick={run} data-shell-command-action={next.action}>
            {busy ? next.busy : next.label}
          </Button>
        )}
      </div>
      {state && (
        <span className="text-meta text-muted" data-shell-command-status>
          {shellCommandStatus(state)}
        </span>
      )}
      {error && (
        <span className="text-meta text-error" role="alert" data-shell-command-error>
          {error}
        </span>
      )}
    </div>
  );
}
