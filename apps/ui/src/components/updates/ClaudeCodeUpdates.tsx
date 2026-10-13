import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { claudeUpdateStatusText, INSTALL_METHOD_LABEL, newer as isNewer } from '../../lib/claudeUpdate.ts';
import { lastChecked } from '../../lib/updates.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { Button } from '../ui/Button.tsx';
import { Toggle } from '../ui/Toggle.tsx';


/** The command to run in a terminal, with a copy button. */
export function CommandToCopy({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card py-1 pr-1 pl-2.5" data-claude-update-command>
      <code className="min-w-0 flex-1 truncate font-mono text-ui">{command}</code>
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon={copied ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={13} aria-hidden />}
        onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
        data-tooltip={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy command'}
        className="shrink-0"
      />
    </div>
  );
}

/** Output of the running or last update, kept scrolled to the end while it runs. */
function UpdateOutput({ output, running }: { output: string; running: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (running && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [output, running]);
  return (
    <pre ref={ref} role="log" aria-label="Update output" tabIndex={0} className="max-h-48 overflow-y-auto rounded-md border border-border bg-card px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted" data-claude-update-output>
      {output || (running ? 'Starting…' : '')}
    </pre>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  );
}

/** Settings → About: the Claude Code that Switchboard runs, whether a newer one is out, and updating it. */
export function ClaudeCodeUpdates({ now }: { now: number }) {
  const { state, refused, check, update, dismiss, setEnabled, showInstall } = useClaudeUpdate();
  if (!state) return null;

  const busy = state.status === 'checking' || state.status === 'updating';
  const newer = state.latestVersion !== null && state.installedVersion !== null && isNewer(state.latestVersion, state.installedVersion) && (state.status === 'available' || state.status === 'error');
  const showManual = newer && !state.canUpdate && state.command;
  const failed = state.status === 'error';

  return (
    <div className="grid gap-3 border-t border-border pt-5" data-claude-updates data-claude-update-status={state.status} data-claude-update-quiet={state.quiet}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] font-medium">Claude Code</h3>
          <p role="status" className={`mt-0.5 text-ui ${failed ? 'text-error' : 'text-muted'}`} data-claude-update-text>
            {claudeUpdateStatusText(state)}
          </p>
          {state.quiet && state.status === 'available' && <p className="mt-0.5 text-[11.5px] text-muted">Claude Code’s own auto-updater is turned off, so Switchboard doesn’t show a notice for it.</p>}
          {state.status !== 'missing' && <p className="mt-0.5 text-[11.5px] text-muted">{lastChecked(state.checkedAt, now)}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {newer && state.canUpdate && (
            <Button variant="primary" disabled={busy} onClick={update} data-claude-update-run>
              {failed ? 'Try again' : `Update to v${state.latestVersion}`}
            </Button>
          )}
          {state.status === 'missing' ? (
            <Button variant="primary" onClick={() => showInstall(true)} data-claude-install-show>
              Install Claude Code…
            </Button>
          ) : (
            <Button disabled={busy} onClick={check} data-claude-update-check>
              Check for Updates
            </Button>
          )}
        </div>
      </div>

      {state.path && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ui" data-claude-install>
          <Row label="Installed">
            <span data-claude-installed-version={state.installedVersion ?? ''}>{state.installedVersion ? `v${state.installedVersion}` : 'unknown version'}</span>
          </Row>
          <Row label="Latest">{state.latestVersion ? `v${state.latestVersion} (${state.channel})` : 'Unknown'}</Row>
          <Row label="Installed with">{INSTALL_METHOD_LABEL[state.method]}</Row>
          <Row label="Path">
            <span className="font-mono text-[11.5px]" data-tooltip={state.path}>
              {state.path}
            </span>
          </Row>
        </dl>
      )}

      {showManual && (
        <div className="grid gap-1.5" data-claude-update-manual>
          <p className="text-ui text-muted">{state.manualReason} Run this in a terminal:</p>
          <CommandToCopy command={state.command!} />
        </div>
      )}

      {(state.status === 'updating' || state.output) && <UpdateOutput output={state.output} running={state.status === 'updating'} />}
      {refused && (
        <p role="alert" className="text-ui text-error">
          {refused}
        </p>
      )}
      {state.status === 'updated' && (
        <Button onClick={dismiss} className="justify-self-start">
          Done
        </Button>
      )}

      <Toggle
        label="Check for Claude Code updates automatically"
        detail="Shortly after Switchboard opens, then every few hours. Nothing is installed until you choose Update."
        checked={state.enabled}
        attr="data-claude-update-auto"
        onChange={setEnabled}
      />
    </div>
  );
}
