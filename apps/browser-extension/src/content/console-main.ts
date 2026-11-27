// Runs in the page's own world (MAIN) on local pages, from the start: records what goes wrong in the page (console.error,
// uncaught errors, rejected promises nobody handled, failed fetch calls) and hands each to console-bridge.ts, which
// keeps them for the popup. Nothing leaves the page until you tick Console errors and add them.

const MARK = '__seshboardConsole';
const MAX_TEXT = 2_000;

type Kind = 'error' | 'exception' | 'rejection' | 'network';

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function report(kind: Kind, message: string): void {
  window.postMessage({ [MARK]: { kind, message: message.slice(0, MAX_TEXT), at: Date.now() } }, '*');
}

export default function main() {
  const original = console.error;
  console.error = function (...args: unknown[]) {
    report('error', args.map(describe).join(' '));
    return original.apply(this, args);
  };
  const onError = (event: ErrorEvent) => report('exception', event.error ? describe(event.error) : `${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
  const onRejection = (event: PromiseRejectionEvent) => report('rejection', `Unhandled rejection: ${describe(event.reason)}`);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    try {
      const response = await originalFetch.call(this, input, init);
      if (response.status >= 400) report('network', `${method} ${url} → ${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      report('network', `${method} ${url} failed: ${describe(error)}`);
      throw error;
    }
  };
  return () => {
    console.error = original;
    window.fetch = originalFetch;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
