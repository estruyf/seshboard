/*
 * Seshboard's canvas SDK (docs/canvases.md). A canvas is `.seshboard/canvases/<name>/canvas.mjs` in a project:
 *
 *   import { canvas, serve } from '@seshboard/canvas';
 *   serve(canvas({ api: 1, name: 'Notes', description: 'The notes of this project', open: async (ctx) => ({ url }) }));
 *
 * Seshboard starts the file as a Node process and resolves this import itself, so a canvas installs nothing. The two
 * talk over Node's IPC channel: stdout and stderr are the canvas's own, and go to its log.
 */
import { CANVAS_API, type CanvasChip, type CanvasCompose, type CanvasContext, type CanvasHostContext, type CanvasInfo, type CanvasLogLevel, type FromCanvas, type ToCanvas } from './wire.ts';

export { CANVAS_API };
export type { CanvasChip, CanvasCompose, CanvasContext, CanvasHostContext, CanvasLogLevel };

/** What a handler can ask of Seshboard. */
export interface CanvasHost {
  /** A line in the canvas's log. */
  log(message: string, level?: CanvasLogLevel): void;
  /**
   * Puts text and chips in the message box of the session that shows the canvas, for the person to read and send.
   * It never sends: a canvas can't spend the person's tokens.
   */
  compose(message: CanvasCompose): void;
  /** Where the canvas shows now: the folder, its branch, light or dark, the session beside it. Null until Seshboard said. */
  context(): CanvasHostContext | null;
  /** Called when that changes. Returns a function that stops it. */
  onContext(listener: (context: CanvasHostContext) => void): () => void;
}

/** What a handler gets. */
export interface CanvasHandlerContext extends CanvasContext {
  host: CanvasHost;
}

/** What `open` answers: the page to show, on this computer. */
export interface CanvasOpened {
  /** A page on `127.0.0.1` or `localhost`. */
  url: string;
  /** The panel's title, when it isn't the canvas's name. */
  title?: string;
}

/** Something the agent can ask the canvas to do. */
export interface CanvasAction {
  description: string;
  /** JSON Schema of the input. */
  input?: unknown;
  run(input: unknown, ctx: CanvasHandlerContext): unknown | Promise<unknown>;
}

export interface CanvasDefinition {
  /** The API version this canvas is written for. */
  api: typeof CANVAS_API;
  /** Its name on the rail and the panel, at most 40 characters. */
  name: string;
  /** One sentence for the agent and the trust question. */
  description: string;
  /** Starts (or finds) the page for this instance. Called again for the same instance, it answers with the same page. */
  open(ctx: CanvasHandlerContext): CanvasOpened | Promise<CanvasOpened>;
  /** The instance is done: stop its server. */
  close?(ctx: CanvasHandlerContext): void | Promise<void>;
  /** By name: lowercase letters, digits and underscores. */
  actions?: Record<string, CanvasAction>;
}

/** Declares a canvas. It only checks what would fail later anyway, with a message that says where. */
export function canvas(definition: CanvasDefinition): CanvasDefinition {
  if (!definition || typeof definition.open !== 'function') throw new Error('A canvas needs an open() that returns { url }.');
  return definition;
}

const describe = (definition: CanvasDefinition): CanvasInfo => ({
  api: definition.api,
  name: definition.name,
  description: definition.description,
  actions: Object.entries(definition.actions ?? {}).map(([name, action]) => ({ name, description: action.description, ...(action.input !== undefined ? { input: action.input } : {}) })),
});

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Runs the canvas for Seshboard: registers it, then answers open, close and the agent's actions. Started by hand
 * (`node canvas.mjs`, with no Seshboard on the other end) it opens one instance in the current folder and prints the
 * page's address, to try a canvas in a browser.
 */
export function serve(definition: CanvasDefinition): CanvasHost {
  const send = (message: FromCanvas) => void process.send?.(message);
  let latest: CanvasHostContext | null = null;
  const listeners = new Set<(context: CanvasHostContext) => void>();
  const host: CanvasHost = {
    log: (message, level = 'info') => (process.send ? send({ type: 'log', level, message: String(message) }) : void console.error(`[${level}] ${message}`)),
    compose: (compose) => (process.send ? send({ type: 'compose', compose }) : void console.error(`[compose] ${JSON.stringify(compose)}`)),
    context: () => latest,
    onContext: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const context = (ctx: CanvasContext): CanvasHandlerContext => ({ ...ctx, host });

  if (!process.send) {
    void Promise.resolve(definition.open(context({ instance: 'standalone', folder: process.cwd() }))).then(
      (opened) => console.log(opened.url),
      (error) => {
        console.error(errorText(error));
        process.exitCode = 1;
      },
    );
    return host;
  }

  const run = async (message: Exclude<ToCanvas, { type: 'context' }>): Promise<unknown> => {
    if (message.type === 'open') {
      const opened = await definition.open(context(message.ctx));
      return { url: opened?.url, title: opened?.title };
    }
    if (message.type === 'close') return void (await definition.close?.(context(message.ctx)));
    const action = definition.actions?.[message.name];
    if (!action) throw new Error(`This canvas has no action named ${message.name}.`);
    return (await action.run(message.input, context(message.ctx))) ?? null;
  };
  process.on('message', (raw) => {
    const message = raw as ToCanvas;
    if (message?.type === 'context') {
      latest = message.context;
      for (const listener of listeners) {
        try {
          listener(latest);
        } catch (error) {
          host.log(`onContext failed: ${errorText(error)}`, 'error');
        }
      }
      return;
    }
    if (!message || typeof message.id !== 'number') return;
    void run(message).then(
      (value) => send({ type: 'result', id: message.id, ok: true, value }),
      (error) => send({ type: 'result', id: message.id, ok: false, error: errorText(error) }),
    );
  });
  // Seshboard went away: so does the canvas, with whatever it started.
  process.on('disconnect', () => process.exit(0));
  send({ type: 'ready', canvas: describe(definition) });
  return host;
}
