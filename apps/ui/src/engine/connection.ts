import {
  createRpcClient,
  ENGINE_PORT_MESSAGE,
  messagePortTransport,
  type Contract,
  type RpcClient,
  type SeshboardBridge,
} from '@seshboard/protocol/client';
import { startLivenessMonitor, type LivenessMonitor } from './liveness.ts';

export type EngineClient = RpcClient<Contract>;

export type ConnectionState =
  /** Not running inside the desktop app (e.g. the UI opened in a browser). */
  | { status: 'unavailable' }
  | { status: 'connecting'; generation: number }
  /** `generation` increases on every reconnect, so effects can re-run against the new client. */
  | { status: 'connected'; client: EngineClient; generation: number };

/**
 * Owns the renderer's link to the engine. Asks the preload for a MessagePort,
 * and reconnects with a fresh port whenever the engine process restarts.
 */
export class EngineConnection {
  private state: ConnectionState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private awaitingPort = false;
  private liveness: LivenessMonitor | null = null;
  /** Connected, but the engine hasn't answered its last pings (it hangs). Cleared by the next answer or a reconnect. */
  private stalled = false;

  constructor(private readonly bridge: SeshboardBridge | undefined) {
    if (!bridge) {
      this.state = { status: 'unavailable' };
      return;
    }
    this.state = { status: 'connecting', generation: 0 };
    window.addEventListener('message', this.onWindowMessage);
    bridge.onEngineRestarted(() => this.connect());
    this.connect();
  }

  getSnapshot = (): ConnectionState => this.state;

  /** Whether the engine stopped answering while connected (see `liveness.ts`). Shares `subscribe`. */
  isStalled = (): boolean => this.stalled;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(state: ConnectionState): void {
    this.state = state;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private setStalled(stalled: boolean): void {
    if (this.stalled === stalled) return;
    this.stalled = stalled;
    this.notify();
  }

  /** Pings the engine while this client is connected, to notice an engine that hangs instead of crashing. */
  private watch(client: EngineClient): void {
    this.liveness?.stop();
    this.liveness = startLivenessMonitor({
      ping: () => client.call('system.ping', { sentAt: Date.now() }),
      onChange: (stalled) => this.setStalled(stalled),
      isHidden: () => document.visibilityState === 'hidden',
    });
  }

  private connect(): void {
    this.liveness?.stop();
    this.liveness = null;
    this.stalled = false;
    if (this.state.status === 'connected') this.state.client.dispose();
    this.awaitingPort = true;
    this.setState({ status: 'connecting', generation: ++this.generation });
    this.bridge!.requestEnginePort();
  }

  private onWindowMessage = (event: MessageEvent): void => {
    if (event.source !== window || event.data !== ENGINE_PORT_MESSAGE) return;
    const port = event.ports[0];
    if (!port) return;
    // Only the first port after a request is used; extras (from overlapping requests) are closed.
    if (!this.awaitingPort) {
      port.close();
      return;
    }
    this.awaitingPort = false;
    const client = createRpcClient<Contract>(messagePortTransport(port));
    this.watch(client);
    this.setState({ status: 'connected', client, generation: this.generation });
  };
}

export const engineConnection = new EngineConnection(window.seshboard);

// Calls in flight when the engine restarts fail with DISCONNECTED; the window reconnects and
// effects run again, so these are expected and must not surface as unhandled errors.
window.addEventListener('unhandledrejection', (event) => {
  if ((event.reason as { code?: unknown } | null)?.code === 'DISCONNECTED') event.preventDefault();
});
