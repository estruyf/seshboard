import { useEffect, useRef, useState } from 'react';
import { RpcError, type McpAppCall } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useThemes } from '../../state/themeStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { createMcpAppHost, mcpAppPage, type McpAppHost, type McpAppHostContext } from './mcpAppHost.ts';
import { ToolDetails, type ToolItem } from './ToolDetails.tsx';
import { toolSummary } from './toolSummary.ts';
import { useDark } from './VisualBlock.tsx';
import { MAX_VISUAL_HEIGHT, mcpAppStyleVariables } from './visuals.ts';

/** The height each app drew at, by its tool call, so one scrolled away and back keeps its room while it loads again. */
const heights = new Map<string, number>();

/** Room for an app before it says how tall it is. */
const FIRST_HEIGHT = 120;

type View = 'app' | 'details';

const VIEWS = [
  { value: 'app', label: 'App', data: { 'data-mcp-app-view': 'app' } },
  { value: 'details', label: 'Details', data: { 'data-mcp-app-view': 'details' } },
] as const;

/**
 * A tool call whose MCP server draws it (an MCP App, `ui://…`): its page in the conversation, where the call was made,
 * with App | Details to see the call itself. Codex's sessions have them.
 */
export function McpAppBlock({ item, app, cwd, sessionId }: { item: ToolItem; app: McpAppCall; cwd: string | null; sessionId: string }) {
  const [view, setView] = useState<View>('app');
  const { label } = toolSummary(item.name, item.input, cwd);
  return (
    <div className="my-2 overflow-clip rounded-md border border-border" data-mcp-app={app.resourceUri}>
      <div className="flex items-center gap-1 border-b border-border bg-code py-1 pr-1 pl-3">
        <span className="mr-auto min-w-0 truncate text-ui text-muted select-none">{label}</span>
        <SegmentedControl<View> mode="radio" size="sm" label="Show as" value={view} onChange={setView} segments={VIEWS} />
      </div>
      {view === 'app' ? (
        <McpAppFrame item={item} app={app} title={label} sessionId={sessionId} />
      ) : (
        <div className="px-3 py-2">
          <ToolDetails item={item} cwd={cwd} sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}

type Page = { state: 'loading' } | { state: 'failed'; error: string } | { state: 'ready'; url: string };

const inputOf = (input: unknown): Record<string, unknown> => (input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {});

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The app's page, from its server through the engine, served by main from an address of its own with the policy the
 * server declared, in a frame sandboxed to scripts only. Seshboard is the page's host (`mcpAppHost.ts`): a tool it
 * calls that isn't read-only asks you first, and a message it sends goes in the message box for you to send.
 */
function McpAppFrame({ item, app, title, sessionId }: { item: ToolItem; app: McpAppCall; title: string; sessionId: string }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const ref = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<Page>({ state: 'loading' });
  const [height, setHeight] = useState(() => heights.get(item.id) ?? FIRST_HEIGHT);
  const [asking, setAsking] = useState<{ tool: string; answer(yes: boolean): void } | null>(null);
  const dark = useDark();
  const themeKey = usePreferences((s) => `${s.prefs.themeId}:${s.prefs.colorScheme}`);
  const theme = useThemes((s) => s.active);
  const host = useRef<McpAppHost | null>(null);

  // Load the page once per call: a read of the server through the engine, then an address from main.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setPage({ state: 'loading' });
    client
      .call('mcpApp.resource', { sessionId, server: app.server, uri: app.resourceUri, callId: app.callId })
      .then(async ({ contents }) => {
        const found = mcpAppPage(contents, app.resourceUri);
        if (!found) throw new Error(`${app.server} sent no page to show`);
        const bridge = window.seshboard;
        if (!bridge) throw new Error('Apps open in the Seshboard app only');
        return bridge.mcpAppDocument(found.html, found.csp);
      })
      .then(
        (url) => !cancelled && setPage({ state: 'ready', url }),
        (error: unknown) => !cancelled && setPage({ state: 'failed', error: errorText(error) }),
      );
    return () => {
      cancelled = true;
    };
  }, [client, sessionId, app.server, app.resourceUri, app.callId]);

  // What the host reads when the page asks: always the latest. The transcript hands over fresh copies of the same call
  // as it updates, so the host never restarts for those.
  const latest = useRef({ dark, client, result: app.result, input: item.input, name: item.name });
  latest.current = { dark, client, result: app.result, input: item.input, name: item.name };

  // The host, for the page at this address; it goes (and asks the page to wrap up) with the address or the view.
  const url = page.state === 'ready' ? page.url : null;
  useEffect(() => {
    if (!url) return;
    const frame = () => ref.current;
    const context = (): McpAppHostContext => {
      const style = frame() ? getComputedStyle(frame()!) : null;
      return {
        theme: latest.current.dark ? 'dark' : 'light',
        styles: { variables: style ? mcpAppStyleVariables((name) => style.getPropertyValue(name)) : {} },
        displayMode: 'inline',
        availableDisplayModes: ['inline'],
        containerDimensions: { maxHeight: MAX_VISUAL_HEIGHT },
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platform: 'desktop',
        toolInfo: { tool: { name: latest.current.name } },
      };
    };
    const engine = () => {
      if (!latest.current.client) throw new Error('Seshboard is not connected to its engine');
      return latest.current.client;
    };
    // A tool that changes things runs only once you said yes.
    const ask = (tool: string) => new Promise<boolean>((resolve) => setAsking({ tool, answer: resolve }));
    const created = createMcpAppHost({
      post: (message) => frame()?.contentWindow?.postMessage(message, '*'),
      context,
      toolInput: inputOf(latest.current.input),
      toolResult: latest.current.result,
      async callTool(name, args) {
        const call = (confirmed: boolean) => engine().call('mcpApp.callTool', { sessionId, server: app.server, tool: name, arguments: args as never, confirmed });
        try {
          return await call(false);
        } catch (error) {
          if (!(error instanceof RpcError) || error.code !== 'NEEDS_CONFIRMATION') throw error;
          if (!(await ask(error.message))) throw new Error(`You didn't allow ${error.message}`);
          return call(true);
        }
      },
      readResource: (uri) => engine().call('mcpApp.resource', { sessionId, server: app.server, uri, callId: app.callId }),
      openLink: (link) => void window.open(link, '_blank', 'noopener'),
      message: (text) => useDrafts.getState().requestQuote(sessionId, text, { plain: true }),
      resize(next) {
        heights.set(item.id, next);
        setHeight(next);
      },
      log: (level, data) => console.debug(`[mcp app ${app.server}] ${level}`, data),
    });
    host.current = created;
    const onMessage = (event: MessageEvent) => {
      if (frame() && event.source === frame()!.contentWindow) created.receive(event.data);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      created.teardown();
      host.current = null;
    };
  }, [url, sessionId, app.server, app.callId, item.id]);

  // The call finished while the page was open.
  useEffect(() => {
    if (app.result !== null) host.current?.setResult(app.result);
  }, [app.result]);

  // A new theme, or light and dark: read once the theme's style is applied (the next frame).
  useEffect(() => {
    const frame = requestAnimationFrame(() => host.current?.contextChanged());
    return () => cancelAnimationFrame(frame);
  }, [dark, themeKey, theme]);

  return (
    <div data-mcp-app-state={page.state}>
      {page.state === 'loading' && (
        <p className="flex items-center gap-2 px-3 py-2 text-ui text-muted" role="status" aria-busy="true">
          <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" aria-hidden />
          Opening {app.server}…
        </p>
      )}
      {page.state === 'failed' && (
        <p className="px-3 py-2 text-ui text-muted" role="status" data-mcp-app-failed="">
          Couldn't open this app: {page.error}. Details shows the call.
        </p>
      )}
      {page.state === 'ready' && (
        <iframe
          ref={ref}
          src={page.url}
          sandbox="allow-scripts"
          title={title}
          // The page's own default scheme, so its canvas stays see-through over the conversation: a frame whose scheme
          // differs from its page's gets an opaque white one, which hides the theme the page was given.
          style={{ height, colorScheme: 'normal' }}
          className="block w-full border-0"
          data-mcp-app-frame=""
        />
      )}
      {asking && (
        <ConfirmDialog
          title={`Run ${asking.tool}?`}
          body={`The ${app.server} app wants to run ${asking.tool}. It can change things on ${app.server}.`}
          confirmLabel="Run"
          data={{ 'data-mcp-app-confirm': app.server }}
          onConfirm={async () => {
            asking.answer(true);
            setAsking(null);
          }}
          onClose={() => {
            asking.answer(false);
            setAsking(null);
          }}
        />
      )}
    </div>
  );
}
