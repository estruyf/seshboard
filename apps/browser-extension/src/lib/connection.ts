import { BROWSER_HOST_NAME, createRpcClient, type BrowserHostMessage, type CompanionContract, type RpcClient, type Transport, type WireMessage } from '@seshboard/protocol/companion-client';

export type CompanionClient = RpcClient<CompanionContract>;

/**
 * How the extension reaches Seshboard. `no-host`: the browser can't start Seshboard's native messaging host (not
 * connected in Settings › Browser extension). The others are the host's own report.
 */
export type ConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected'; appVersion: string }
  | { kind: 'not-running'; canLaunch: boolean }
  | { kind: 'incompatible'; detail: string }
  | { kind: 'no-host'; detail: string };

export interface Connection {
  client: CompanionClient;
  state(): ConnectionState;
  onState(listener: (state: ConnectionState) => void): () => void;
  /** Resolves once the host reached Seshboard, or with the state that stopped it. */
  ready(timeoutMs?: number): Promise<ConnectionState>;
  /** Asks the host to open Seshboard; it connects once Seshboard is up. */
  launch(): void;
  close(): void;
}

/**
 * Opens a connection to Seshboard through the native messaging host: one host process for as long as the port is
 * open. Companion requests go through `client`, as the VS Code companion's do over its socket.
 */
export function connect(): Connection {
  let state: ConnectionState = { kind: 'connecting' };
  const stateListeners = new Set<(state: ConnectionState) => void>();
  const wireListeners = new Set<(message: WireMessage) => void>();
  const setState = (next: ConnectionState) => {
    state = next;
    for (const listener of stateListeners) listener(next);
  };

  const port = browser.runtime.connectNative(BROWSER_HOST_NAME);
  let open = true;
  port.onMessage.addListener((raw: unknown) => {
    const message = raw as BrowserHostMessage;
    if (message.type === 'wire') for (const listener of wireListeners) listener(message.message);
    else if (message.type === 'status') {
      if (message.state === 'connected') setState({ kind: 'connected', appVersion: message.appVersion ?? '' });
      else if (message.state === 'not-running') setState({ kind: 'not-running', canLaunch: message.canLaunch ?? false });
      else if (message.state === 'incompatible') setState({ kind: 'incompatible', detail: message.detail ?? 'Update Seshboard and the extension' });
      else setState({ kind: 'connecting' });
    }
  });
  port.onDisconnect.addListener((p) => {
    open = false;
    // Firefox says why on the port, Chrome in lastError.
    const error = (p as { error?: { message?: string } }).error?.message ?? (globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome?.runtime?.lastError?.message ?? 'The host closed';
    setState({ kind: 'no-host', detail: error });
  });

  const transport: Transport = {
    send: (message) => {
      if (open) port.postMessage({ type: 'wire', message } satisfies BrowserHostMessage);
    },
    onMessage: (listener) => {
      wireListeners.add(listener);
      return () => wireListeners.delete(listener);
    },
    close: () => {
      if (open) port.disconnect();
      open = false;
    },
  };
  const client = createRpcClient<CompanionContract>(transport, { timeoutMs: 15_000 });

  return {
    client,
    state: () => state,
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    ready(timeoutMs = 5_000) {
      if (state.kind !== 'connecting') return Promise.resolve(state);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          stop();
          resolve(state);
        }, timeoutMs);
        const stop = this.onState((next) => {
          if (next.kind === 'connecting') return;
          clearTimeout(timer);
          stop();
          resolve(next);
        });
      });
    },
    launch: () => {
      if (open) port.postMessage({ type: 'launch' } satisfies BrowserHostMessage);
    },
    close: () => {
      client.dispose();
      transport.close?.();
    },
  };
}
