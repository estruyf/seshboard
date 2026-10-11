import { fileManagerName } from '../lib/platform.ts';
import { useState, type ReactNode } from 'react';
import { FolderOpen } from 'lucide-react';
import type { LogLevel } from '@switchboard/protocol/client';
import { useDiagnostics } from '../engine/useDiagnostics.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { CodeBlock } from './transcript/CodeBlock.tsx';
import { Markdown } from './transcript/Markdown.tsx';
import { Button } from './ui/Button.tsx';
import { Notice } from './ui/Notice.tsx';

const SAMPLE = `// Syntax highlighting loads on first use
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}`;

// A markdown block opens rendered, with a switch to its source.
const MARKDOWN_SAMPLE = '```markdown\n## Markdown blocks\n\nOpen **rendered**, with the source a click away.\n```';

type Tone = 'ok' | 'warn' | 'error' | 'idle';

const toneClass: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-error',
  idle: 'bg-faint',
};

function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${toneClass[tone]}`} />;
}

function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-ui font-medium text-muted">{title}</h3>
        {aside}
      </header>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-4 px-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 select-text truncate">{children}</dd>
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-ui">{children}</span>;

/** A path with a button that opens it in Finder: a folder opens, a file is selected in its folder. */
function PathValue({ path, label, onOpen, disabled, hook }: { path: string; label: string; onOpen: (path: string) => void; disabled: boolean; hook: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate font-mono text-ui" data-tooltip={path}>
        {path}
      </span>
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon={<FolderOpen size={14} aria-hidden />}
        aria-label={label}
        onClick={() => onOpen(path)}
        disabled={disabled}
        data-diagnostics-reveal={hook}
        className="shrink-0"
      />
    </span>
  );
}

const logTone: Record<LogLevel, string> = {
  debug: 'text-faint',
  info: 'text-muted',
  warn: 'text-warn',
  error: 'text-error',
};

export function EngineDiagnostics() {
  const connection = useEngineConnection();
  const { info, pingMs, logs, error, refreshPing } = useDiagnostics();
  const [openError, setOpenError] = useState<string | null>(null);
  const client = connection.status === 'connected' ? connection.client : null;

  const showInFinder = (path: string) => {
    if (!client) return;
    setOpenError(null);
    client.call('editors.open', { path, editorId: 'finder' }).catch((err: unknown) => setOpenError(err instanceof Error ? err.message : String(err)));
  };

  const connectionRow =
    connection.status === 'unavailable' ? (
      <span className="flex items-center gap-2">
        <Dot tone="error" /> Not running inside the Switchboard app
      </span>
    ) : connection.status === 'connecting' ? (
      <span className="flex items-center gap-2">
        <Dot tone="warn" /> Connecting…
      </span>
    ) : (
      <span className="flex items-center gap-2">
        <Dot tone="ok" /> Connected
        {connection.generation > 1 && <span className="text-muted">· reconnected {connection.generation - 1}×</span>}
      </span>
    );

  return (
    <div className="grid gap-4">
      {error && (
        <Notice tone="error">{error}</Notice>
      )}
      {openError && (
        <Notice tone="error" onDismiss={() => setOpenError(null)}>
          {openError}
        </Notice>
      )}

      <Card
        title="Engine"
        aside={
          <Button variant="quiet" size="sm" onClick={refreshPing} disabled={connection.status !== 'connected'}>
            Ping again
          </Button>
        }
      >
        <Row label="Status">{connectionRow}</Row>
        <Row label="Round trip">{pingMs === null ? 'Not measured' : <Mono>{pingMs.toFixed(2)} ms (median of 20)</Mono>}</Row>
        <Row label="Engine version">{info ? <Mono>{info.engineVersion}</Mono> : 'Unknown'}</Row>
      </Card>

      <Card title="Claude Code">
        <Row label="Binary">
          {!info ? (
            'Unknown'
          ) : info.claude ? (
            <span className="flex items-center gap-2">
              <Dot tone="ok" />
              <Mono>{info.claude.version ?? 'unknown version'}</Mono>
              <span className="truncate text-muted" data-tooltip={info.claude.path}>
                {info.claude.path}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Dot tone="error" /> Not found on your PATH. Install Claude Code, check that <Mono>claude</Mono> runs in Terminal, then reopen Switchboard.
            </span>
          )}
        </Row>
        <Row label="Config dir">
          {info ? (
            <PathValue path={info.paths.claudeConfigDir} label={`Open the config folder in ${fileManagerName()}`} onOpen={showInFinder} disabled={!client} hook="config-dir" />
          ) : (
            'Unknown'
          )}
        </Row>
        <Row label="Shell environment">
          {info ? (
            <span className="flex items-center gap-2">
              <Dot tone={info.shell.resolved ? 'ok' : 'warn'} />
              {info.shell.resolved ? 'Loaded from' : 'Fell back to app environment for'} <Mono>{info.shell.path}</Mono>
              <span className="text-muted">· {info.shell.durationMs} ms</span>
            </span>
          ) : (
            'Unknown'
          )}
        </Row>
      </Card>

      <Card title="Runtime">
        <Row label="Electron">{info ? <Mono>{info.versions.electron ?? 'n/a'}</Mono> : 'Unknown'}</Row>
        <Row label="Node">{info ? <Mono>{info.versions.node}</Mono> : 'Unknown'}</Row>
        <Row label="SQLite">{info ? <Mono>{info.versions.sqlite}</Mono> : 'Unknown'}</Row>
        <Row label="Cache database">
          {info ? (
            <PathValue path={info.paths.database} label={`Show the cache database in ${fileManagerName()}`} onOpen={showInFinder} disabled={!client} hook="database" />
          ) : (
            'Unknown'
          )}
        </Row>
      </Card>

      <Card title="Rendering">
        <div className="px-4 py-1" data-rendering-check>
          <CodeBlock code={SAMPLE} language="ts" />
          <Markdown text={MARKDOWN_SAMPLE} />
        </div>
      </Card>

      <Card title="Engine log">
        <div role="log" aria-label="Engine log" tabIndex={0} className="max-h-48 overflow-y-auto px-4 py-2 font-mono text-ui select-text">
          {logs.length === 0 ? (
            <p className="text-muted">No messages since this window connected.</p>
          ) : (
            logs.map((entry, i) => (
              <p key={i} className={logTone[entry.level]}>
                <span className="text-muted">{new Date(entry.at).toLocaleTimeString()}</span> {entry.message}
              </p>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
