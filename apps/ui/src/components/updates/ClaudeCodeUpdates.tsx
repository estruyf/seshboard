import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CLAUDE_UPDATE_COPY, claudeUpdateStatusText, INSTALL_METHOD_LABEL, newer as isNewer, providerUpdateCopy, type ToolUpdateCopy, type ToolUpdateState } from '../../lib/claudeUpdate.ts';
import { lastChecked } from '../../lib/updates.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { useProviderUpdates } from '../../state/providerUpdateStore.ts';
import { Button } from '../ui/Button.tsx';
import { Toggle } from '../ui/Toggle.tsx';


/** The command to run in a terminal, with a copy button. */
export function CommandToCopy({ command, hook = 'data-claude-update-command' }: { command: string; hook?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card py-1 pr-1 pl-2.5" {...{ [hook]: '' }}>
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
function UpdateOutput({ output, running, hook }: { output: string; running: boolean; hook: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (running && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [output, running]);
  return (
    <pre ref={ref} role="log" aria-label="Update output" tabIndex={0} className="max-h-48 overflow-y-auto rounded-md border border-border bg-card px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted" {...{ [hook]: '' }}>
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

interface ToolUpdatesProps {
  state: ToolUpdateState;
  copy: ToolUpdateCopy;
  /** The prefix of its `data-` hooks: `claude` gives `data-claude-updates`, `data-claude-update-run` and the rest. */
  hook: string;
  refused: string | null;
  check(): void;
  update(): void;
  dismiss(): void;
  setEnabled(enabled: boolean): void;
  /** What a missing CLI offers instead of Check for Updates (Claude Code's install dialog). */
  install?: () => void;
  now: number;
}

/** Settings → About: a CLI that Seshboard runs, whether a newer one is out, and updating it. */
function ToolUpdates({ state, copy, hook, refused, check, update, dismiss, setEnabled, install, now }: ToolUpdatesProps) {
  const data = (name: string, value: string | boolean = '') => ({ [`data-${hook}-${name}`]: value });
  const busy = state.status === 'checking' || state.status === 'updating';
  const newer = state.latestVersion !== null && state.installedVersion !== null && isNewer(state.latestVersion, state.installedVersion) && (state.status === 'available' || state.status === 'error');
  const showManual = newer && !state.canUpdate && state.command;
  const failed = state.status === 'error';

  return (
    <div className="grid gap-3 border-t border-border pt-5" {...data('updates')} {...data('update-status', state.status)} {...data('update-quiet', String(state.quiet))}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] font-medium">{copy.name}</h3>
          <p role="status" className={`mt-0.5 text-ui ${failed ? 'text-error' : 'text-muted'}`} {...data('update-text')}>
            {claudeUpdateStatusText(state, copy)}
          </p>
          {state.quiet && state.status === 'available' && <p className="mt-0.5 text-[11.5px] text-muted">{copy.name}’s own updates are turned off, so Seshboard doesn’t show a notice for it.</p>}
          {state.status !== 'missing' && <p className="mt-0.5 text-[11.5px] text-muted">{lastChecked(state.checkedAt, now)}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {newer && state.canUpdate && (
            <Button variant="primary" disabled={busy} onClick={update} {...data('update-run')}>
              {failed ? 'Try again' : `Update to v${state.latestVersion}`}
            </Button>
          )}
          {state.status === 'missing' && install ? (
            <Button variant="primary" onClick={install} {...data('install-show')}>
              Install {copy.name}…
            </Button>
          ) : (
            <Button disabled={busy} onClick={check} {...data('update-check')}>
              Check for Updates
            </Button>
          )}
        </div>
      </div>

      {state.path && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ui" {...data('install')}>
          <Row label="Installed">
            <span {...data('installed-version', state.installedVersion ?? '')}>{state.installedVersion ? `v${state.installedVersion}` : 'unknown version'}</span>
          </Row>
          <Row label="Latest">{state.latestVersion ? `v${state.latestVersion}${state.channel ? ` (${state.channel})` : ''}` : 'Unknown'}</Row>
          <Row label="Installed with">{INSTALL_METHOD_LABEL[state.method]}</Row>
          <Row label="Path">
            <span className="font-mono text-[11.5px]" data-tooltip={state.path}>
              {state.path}
            </span>
          </Row>
        </dl>
      )}

      {showManual && (
        <div className="grid gap-1.5" {...data('update-manual')}>
          <p className="text-ui text-muted">{state.manualReason} Run this in a terminal:</p>
          <CommandToCopy command={state.command!} hook={`data-${hook}-update-command`} />
        </div>
      )}

      {(state.status === 'updating' || state.output) && <UpdateOutput output={state.output} running={state.status === 'updating'} hook={`data-${hook}-update-output`} />}
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
        label={`Check for ${copy.name} updates automatically`}
        detail="Shortly after Seshboard opens, then every few hours. Nothing is installed until you choose Update."
        checked={state.enabled}
        attr={`data-${hook}-update-auto`}
        onChange={setEnabled}
      />
    </div>
  );
}

/** Settings → About: the Claude Code that Seshboard runs. */
export function ClaudeCodeUpdates({ now }: { now: number }) {
  const { state, refused, check, update, dismiss, setEnabled, showInstall } = useClaudeUpdate();
  if (!state) return null;
  return <ToolUpdates state={state} copy={CLAUDE_UPDATE_COPY} hook="claude" refused={refused} check={check} update={update} dismiss={dismiss} setEnabled={setEnabled} install={() => showInstall(true)} now={now} />;
}

/** Settings → About: the CLI of each other provider with a profile (GitHub Copilot CLI), as Claude Code's. */
export function ProviderUpdates({ now }: { now: number }) {
  const { updates, refused, check, update, dismiss, setEnabled } = useProviderUpdates();
  return updates.map((state) => (
    <ToolUpdates
      key={state.provider}
      state={state}
      copy={providerUpdateCopy(state)}
      hook={state.provider}
      refused={refused[state.provider] ?? null}
      check={() => check(state.provider)}
      update={() => update(state.provider)}
      dismiss={() => dismiss(state.provider)}
      setEnabled={(enabled) => setEnabled(state.provider, enabled)}
      now={now}
    />
  ));
}
