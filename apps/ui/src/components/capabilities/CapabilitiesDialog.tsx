import { RefreshCw, RotateCw } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { Capabilities, McpServerInfo } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ProfileBadge } from '../profiles/ProfileBadge.tsx';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Switch } from '../ui/Toggle.tsx';

type Tab = 'mcp' | 'commands' | 'agents' | 'plugins';

/** `hint` says what to do about a server that isn't working, when Claude Code gave no error of its own. */
const MCP_TONE: Record<McpServerInfo['status'], { dot: string; label: string; hint?: string }> = {
  connected: { dot: 'bg-ok', label: 'Connected' },
  pending: { dot: 'bg-accent-ink animate-pulse', label: 'Connecting' },
  'needs-auth': { dot: 'bg-warn', label: 'Needs sign-in', hint: 'Sign in with /mcp in the Claude Code terminal (Terminal panel, then Claude Code).' },
  failed: { dot: 'bg-error', label: 'Failed', hint: 'Claude Code could not start it. Check its settings, then reconnect.' },
  disabled: { dot: 'bg-faint', label: 'Off' },
};

function Row({ title, meta, children, detail }: { title: ReactNode; meta?: ReactNode; children?: ReactNode; detail?: ReactNode }) {
  return (
    <div className="border-b border-edge px-4 py-2 last:border-b-0">
      <div className="flex min-h-6 items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-[12.5px]">{title}</div>
        {meta && <span className="shrink-0 text-meta text-muted">{meta}</span>}
        {children}
      </div>
      {detail && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{detail}</div>}
    </div>
  );
}

/**
 * What Claude can use in this session: MCP servers (turn on or off and reconnect when the
 * session runs here), skills and commands, agents and plugins.
 */
export function CapabilitiesDialog({ sessionId, cwd, profileId, onClose }: { sessionId: string; cwd: string; profileId: string | null; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('mcp');
  const [filter, setFilter] = useState('');
  const [version, setVersion] = useState(0);
  // The refresh button has a running session read its MCP servers and plugins again; a toggle only asks again.
  const [reloading, setReloading] = useState(false);
  const ids = useId();

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .call('session.capabilities', { sessionId, cwd, refresh: version > 0, reload: reloading })
      .then(
        (result) => !cancelled && (setCaps(result), setError(null)),
        (e: Error) => !cancelled && setError(`Couldn't ask Claude Code what's available: ${e.message}`),
      )
      .finally(() => !cancelled && setReloading(false));
    return () => {
      cancelled = true;
    };
    // `reloading` is only read with the `version` it was set with.
  }, [client, sessionId, cwd, version]);

  const reload = () => {
    if (reloading) return;
    setReloading(true);
    setVersion((v) => v + 1);
  };

  const mcp = async (server: string, action: 'enable' | 'disable' | 'reconnect') => {
    if (!client) return;
    setBusy(server);
    try {
      await client.call('session.mcp', { sessionId, server, action });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't ${action === 'reconnect' ? 'reconnect' : action === 'enable' ? 'turn on' : 'turn off'} ${server}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const needle = filter.trim().toLowerCase();
  const matches = (...texts: Array<string | null | undefined>) => !needle || texts.some((t) => t?.toLowerCase().includes(needle));
  const lists = useMemo(
    () => ({
      mcp: caps?.mcp.filter((s) => matches(s.name, s.scope, ...s.tools)) ?? [],
      commands: caps?.commands.filter((c) => matches(c.name, c.description)) ?? [],
      agents: caps?.agents.filter((a) => matches(a.name, a.description)) ?? [],
      plugins: caps?.plugins.filter((p) => matches(p.name, p.scope)) ?? [],
    }),
    // `matches` only reads `needle`.
    [caps, needle],
  );
  const tabs: Array<{ id: Tab; label: string; count: number | null }> = [
    { id: 'mcp', label: 'MCP servers', count: caps?.mcp.length ?? null },
    { id: 'commands', label: 'Skills & commands', count: caps?.commands.length ?? null },
    { id: 'agents', label: 'Agents', count: caps?.agents.length ?? null },
    { id: 'plugins', label: 'Plugins', count: caps?.plugins.length ?? null },
  ];
  const tabLabel = tabs.find((t) => t.id === tab)!.label;

  // ← → Home End move between the tabs and open the one they land on.
  const onTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === tab);
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setTab(tabs[next]!.id);
    document.getElementById(`${ids}-tab-${tabs[next]!.id}`)?.focus();
  };
  const subtitle = caps === null ? 'Asking Claude Code…' : caps.live ? 'Live from this session' : 'Read from this folder. Run the session here to turn MCP servers on or off.';

  return (
    <Dialog
      width="lg"
      placement="top"
      flush
      title="Tools"
      subtitle={subtitle}
      onClose={onClose}
      headerActions={
        <>
          {/* Plugins, MCP servers and skills differ per Claude profile. */}
          <ProfileBadge profileId={profileId} className="mr-1 text-meta" />
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<RefreshCw size={12} className={reloading ? 'animate-spin' : ''} />}
            data-tooltip={caps?.live ? 'Reload MCP servers and plugins' : 'Ask Claude Code again'}
            aria-label="Refresh"
            aria-busy={reloading}
            onClick={reload}
            data-capabilities-refresh
          />
        </>
      }
      data-capabilities
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-edge px-3 py-1.5">
        <div role="tablist" aria-label="Kind of tool" onKeyDown={onTabKey} className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${ids}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${ids}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              data-capabilities-tab={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2.5 py-1 text-ui ${tab === t.id ? 'bg-selected text-text' : 'text-muted hover:bg-border/45 hover:text-text'}`}
            >
              {t.label}
              {/* The smoke test reads the count from the tab's first span. */}
              {t.count !== null && <span className="ml-1.5 text-muted tabular-nums">{t.count}</span>}
            </button>
          ))}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          // Typing narrows the list straight away, so the field takes focus when the dialog opens.
          autoFocus
          placeholder="Filter"
          aria-label={`Filter ${tabLabel.toLowerCase()}`}
          spellCheck={false}
          className="ml-auto h-7 w-36 rounded-md border border-edge bg-bg px-2 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink/60"
        />
      </div>

      {error && (
        <p role="alert" className="border-b border-edge px-4 py-2 text-ui text-error">
          {error}
        </p>
      )}

      <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto outline-none" data-capabilities-list={tab}>
        {caps === null && !error && (
          <p role="status" className="p-4 text-ui text-muted">
            Loading…
          </p>
        )}
        {caps && tab === 'mcp' && (lists.mcp.length === 0 ? <p className="p-4 text-ui text-muted">No MCP servers{needle ? ' match' : ' configured'}.</p> : lists.mcp.map((server) => {
          const tone = MCP_TONE[server.status];
          return (
            <Row
              key={server.name}
              title={
                <span className="flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} data-tooltip={tone.label} role="img" aria-label={`${tone.label}:`} />
                  <span className="truncate font-medium">{server.name}</span>
                  {server.scope && <span className="shrink-0 rounded bg-border/60 px-1.5 text-[10.5px] text-muted">{server.scope}</span>}
                </span>
              }
              meta={server.status === 'connected' ? `${server.tools.length} tools` : tone.label}
              detail={server.error ?? tone.hint ?? (server.tools.length ? server.tools.slice(0, 12).join(', ') + (server.tools.length > 12 ? ', …' : '') : null)}
            >
              {caps.live && (
                <>
                  {server.status !== 'disabled' && (
                    <button type="button" data-tooltip="Reconnect" aria-label={`Reconnect ${server.name}`} disabled={busy === server.name} onClick={() => void mcp(server.name, 'reconnect')} className="flex size-6 items-center justify-center rounded text-faint hover:text-text disabled:opacity-40">
                      <RotateCw size={12} className={busy === server.name ? 'animate-spin' : ''} />
                    </button>
                  )}
                  {/* The switch's state (aria-checked) says on or off; its name says which server. */}
                  <Switch
                    checked={server.status !== 'disabled'}
                    label={server.name}
                    disabled={busy === server.name}
                    onChange={(on) => void mcp(server.name, on ? 'enable' : 'disable')}
                    dataAttrs={{ 'data-tooltip': server.status === 'disabled' ? 'Turn on' : 'Turn off' }}
                  />
                </>
              )}
            </Row>
          );
        }))}
        {caps && tab === 'commands' && (lists.commands.length === 0 ? <p className="p-4 text-ui text-muted">No skills or custom commands{needle ? ' match' : ''}.</p> : lists.commands.map((c) => (
          <Row key={c.name} title={<span className="font-mono">/{c.name}</span>} meta={c.argumentHint || undefined} detail={c.description} />
        )))}
        {caps && tab === 'agents' && (lists.agents.length === 0 ? <p className="p-4 text-ui text-muted">No agents{needle ? ' match' : ''}.</p> : lists.agents.map((a) => (
          <Row key={a.name} title={<span className="font-medium">{a.name}</span>} meta={a.model ?? undefined} detail={a.description} />
        )))}
        {caps && tab === 'plugins' && (lists.plugins.length === 0 ? <p className="p-4 text-ui text-muted">No plugins installed{needle ? ' that match' : ''}.</p> : lists.plugins.map((p) => (
          <Row key={p.name} title={<span className="font-medium">{p.name}</span>} meta={[p.version && `v${p.version}`, p.scope].filter(Boolean).join(' · ') || undefined} detail={p.path} />
        )))}
      </div>
    </Dialog>
  );
}
