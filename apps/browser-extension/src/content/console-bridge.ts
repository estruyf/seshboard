import { CONSOLE_MESSAGE, type ConsoleEntry } from '../lib/payload.ts';

// Runs in the extension's own world on local pages: keeps the last errors console-main.ts reports, and gives them to
// the popup when it asks.

const MARK = '__seshboardConsole';
const MAX_ENTRIES = 50;

export default function main() {
  const entries: ConsoleEntry[] = [];
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const entry = (event.data as Record<string, unknown> | null)?.[MARK] as ConsoleEntry | undefined;
    if (!entry || typeof entry.message !== 'string') return;
    entries.push({ kind: entry.kind, message: entry.message, at: entry.at });
    if (entries.length > MAX_ENTRIES) entries.shift();
  };
  window.addEventListener('message', onMessage);
  const onAsk = (message: unknown) => {
    if ((message as { type?: string } | null)?.type !== CONSOLE_MESSAGE) return undefined;
    return Promise.resolve([...entries]);
  };
  browser.runtime.onMessage.addListener(onAsk);
  return () => {
    window.removeEventListener('message', onMessage);
    browser.runtime.onMessage.removeListener(onAsk);
  };
}
