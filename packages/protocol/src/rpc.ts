import type { z } from 'zod';
import type { RpcErrorCode, RpcErrorShape, Transport, WireMessage } from './wire.ts';

/** A contract: request/response methods plus server-pushed events, all described by zod schemas. */
export interface ContractShape {
  requests: Record<string, { params: z.ZodType; result: z.ZodType }>;
  events: Record<string, z.ZodType>;
}

export type MethodName<C extends ContractShape> = keyof C['requests'] & string;
export type EventName<C extends ContractShape> = keyof C['events'] & string;
export type ParamsOf<C extends ContractShape, M extends MethodName<C>> = z.input<C['requests'][M]['params']>;
export type ResultOf<C extends ContractShape, M extends MethodName<C>> = z.output<C['requests'][M]['result']>;
export type EventPayload<C extends ContractShape, E extends EventName<C>> = z.output<C['events'][E]>;

/** Per-connection context passed to every handler, e.g. to push events only to the caller. */
export interface HandlerContext<C extends ContractShape> {
  /** Sends an event to this connection only. */
  emit: RpcServer<C>['emit'];
  /** Runs `cleanup` when this connection goes away (window closed, engine detached). */
  onDispose(cleanup: () => void): void;
}

export type Handlers<C extends ContractShape> = {
  [M in MethodName<C>]: (
    params: z.output<C['requests'][M]['params']>,
    context: HandlerContext<C>,
  ) => Promise<z.input<C['requests'][M]['result']>> | z.input<C['requests'][M]['result']>;
};

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly details: unknown;

  constructor(code: RpcErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.details = details;
  }

  toShape(): RpcErrorShape {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface RpcServer<C extends ContractShape> {
  emit<E extends EventName<C>>(name: E, payload: z.input<C['events'][E]>): void;
  /** The context its handlers get: what a handler keeps per connection is found by it. */
  context: HandlerContext<C>;
  dispose(): void;
}

export interface ServeOptions {
  /** Called for handler failures that are not RpcErrors, e.g. to log them. */
  onUnexpectedError?: (method: string, error: unknown) => void;
}

/**
 * Serves `handlers` over `transport`. Params are validated before the handler
 * runs and results are parsed against the contract before they are sent.
 */
export function serveRpc<C extends ContractShape>(
  contract: C,
  transport: Transport,
  handlers: Handlers<C>,
  options: ServeOptions = {},
): RpcServer<C> {
  let disposed = false;
  const cleanups: Array<() => void> = [];

  const reply = (message: WireMessage) => {
    if (!disposed) transport.send(message);
  };

  const context: HandlerContext<C> = {
    emit: (name, payload) => reply({ kind: 'event', name, payload }),
    onDispose: (cleanup) => {
      if (disposed) cleanup();
      else cleanups.push(cleanup);
    },
  };

  const unsubscribe = transport.onMessage(async (message) => {
    if (message.kind !== 'request') return;
    const { id, method } = message;
    const spec = Object.hasOwn(contract.requests, method) ? contract.requests[method] : undefined;
    const handler = spec
      ? (handlers as Record<string, (p: unknown, c: HandlerContext<C>) => unknown>)[method]
      : undefined;
    if (!spec || !handler) {
      reply({ kind: 'response', id, ok: false, error: { code: 'METHOD_NOT_FOUND', message: `Unknown method: ${method}` } });
      return;
    }

    const params = spec.params.safeParse(message.params);
    if (!params.success) {
      reply({
        kind: 'response',
        id,
        ok: false,
        error: { code: 'INVALID_PARAMS', message: `Invalid params for ${method}`, details: params.error.issues },
      });
      return;
    }

    try {
      const raw = await handler(params.data, context);
      const result = spec.result.safeParse(raw);
      if (!result.success) {
        reply({
          kind: 'response',
          id,
          ok: false,
          error: { code: 'INVALID_RESULT', message: `Handler for ${method} returned an invalid result`, details: result.error.issues },
        });
        return;
      }
      reply({ kind: 'response', id, ok: true, result: result.data });
    } catch (error) {
      if (error instanceof RpcError) {
        reply({ kind: 'response', id, ok: false, error: error.toShape() });
        return;
      }
      options.onUnexpectedError?.(method, error);
      reply({
        kind: 'response',
        id,
        ok: false,
        error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  return {
    emit: context.emit,
    context,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          options.onUnexpectedError?.('dispose', error);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface RpcClient<C extends ContractShape> {
  call<M extends MethodName<C>>(method: M, params: ParamsOf<C, M>): Promise<ResultOf<C, M>>;
  on<E extends EventName<C>>(name: E, listener: (payload: EventPayload<C, E>) => void): () => void;
  /** Rejects every pending call with DISCONNECTED and stops listening. */
  dispose(): void;
}

export interface ClientOptions {
  timeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: RpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Typed client for a contract. Results are trusted (the server already parsed
 * them), so the client does no runtime validation on the hot path.
 */
export function createRpcClient<C extends ContractShape>(
  transport: Transport,
  options: ClientOptions = {},
): RpcClient<C> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let nextId = 1;
  let disposed = false;

  const unsubscribe = transport.onMessage((message) => {
    if (message.kind === 'response') {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new RpcError(message.error.code, message.error.message, message.error.details));
    } else if (message.kind === 'event') {
      for (const listener of listeners.get(message.name) ?? []) listener(message.payload);
    }
  });

  return {
    call(method, params) {
      if (disposed) return Promise.reject(new RpcError('DISCONNECTED', 'Client is disposed'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new RpcError('TIMEOUT', `${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        try {
          transport.send({ kind: 'request', id, method, params });
        } catch (error) {
          // A closed port or an uncloneable param throws here; fail now instead of leaving the call to time out.
          pending.delete(id);
          clearTimeout(timer);
          reject(new RpcError('DISCONNECTED', `${method} could not be sent: ${(error as Error).message}`));
        }
      });
    },
    on(name, listener) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      const entry = listener as (payload: unknown) => void;
      set.add(entry);
      return () => set.delete(entry);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new RpcError('DISCONNECTED', 'Connection to the engine was closed'));
      }
      pending.clear();
      listeners.clear();
    },
  };
}
