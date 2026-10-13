import { CheckCircle2, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CLAUDE_SETUP_URL, claudeInstallOptions } from '../../lib/claudeUpdate.ts';
import { currentPlatform } from '../../lib/platform.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { CommandToCopy } from './ClaudeCodeUpdates.tsx';

/**
 * Switchboard runs the user's own `claude`; without one no session can start. Opens by itself at launch when the
 * engine can't find it (and from Settings → About), shows how to install it, and looks again on request.
 */
export function ClaudeInstallDialog() {
  const { state, installOpen, showInstall, check } = useClaudeUpdate();
  // Looking again: until the engine sends its next state, which it does after every search.
  const [looking, setLooking] = useState(false);
  const [lookedOnce, setLookedOnce] = useState(false);
  useEffect(() => setLooking(false), [state]);
  if (!installOpen || !state) return null;

  const platform = currentPlatform();
  const machine = platform === 'darwin' ? 'Mac' : 'PC';
  const found = state.status !== 'missing';
  const close = () => showInstall(false);
  const lookAgain = () => {
    setLooking(true);
    setLookedOnce(true);
    check();
  };

  return (
    <Dialog
      width="md"
      title={found ? 'Claude Code is installed' : 'Install Claude Code'}
      subtitle={found ? undefined : `Switchboard runs sessions with your own Claude Code, and can’t find it on this ${machine}.`}
      onClose={close}
      data-claude-install-dialog
      data-claude-install-found={found}
      footer={
        found ? (
          <Button variant="primary" onClick={close} data-claude-install-done>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close} data-claude-install-later>
              Not Now
            </Button>
            <Button variant="primary" disabled={looking} onClick={lookAgain} data-claude-install-check>
              {looking ? 'Looking…' : 'Check Again'}
            </Button>
          </>
        )
      }
      footerStart={
        found ? undefined : (
          <Button variant="quiet" icon={<ExternalLink size={13} aria-hidden />} onClick={() => void window.open(CLAUDE_SETUP_URL, '_blank')} data-claude-install-guide>
            Setup guide
          </Button>
        )
      }
    >
      {found ? (
        <div className="flex items-start gap-2 text-ui">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" aria-hidden />
          <p>
            Found {state.installedVersion ? `version ${state.installedVersion}` : 'Claude Code'} at <span className="font-mono">{state.path}</span>. If you haven’t signed in yet, run{' '}
            <code className="font-mono">claude</code> once in a terminal first.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 text-ui">
          <section className="grid gap-2">
            <h3 className="font-medium">1. Install it with one of these commands in a terminal</h3>
            {claudeInstallOptions(platform).map((option) => (
              <div key={option.label} className="grid gap-1" data-claude-install-option={option.label}>
                <span className="text-meta text-muted">{option.label}</span>
                <CommandToCopy command={option.command} />
              </div>
            ))}
          </section>
          <section className="grid gap-2">
            <h3 className="font-medium">2. Sign in</h3>
            <p className="text-muted">
              Run <code className="font-mono text-text">claude</code> once in a new terminal and follow the steps to log in.
            </p>
          </section>
          <section className="grid gap-2">
            <h3 className="font-medium">3. Come back here</h3>
            <p className="text-muted">Choose Check Again. Switchboard finds it the way your terminal does.</p>
          </section>
          {lookedOnce && !looking && (
            <Notice tone="caution" data-claude-install-still-missing>
              Still can’t find Claude Code. Open a new terminal and run <code className="font-mono">claude --version</code> to check that it’s installed.
            </Notice>
          )}
        </div>
      )}
    </Dialog>
  );
}
