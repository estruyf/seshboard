import { createServer } from 'node:net';

/**
 * The first port after `taken` that nothing listens on at `127.0.0.1`, trying up to `tries` of them, or null. For
 * "Use port 47616" when Remote's port is in use: the button offers a port that is free now (another app may still
 * take it before you click, and starting there says so again).
 */
export async function nextFreePort(taken: number, tries = 20): Promise<number | null> {
  for (let port = taken + 1; port <= Math.min(65535, taken + tries); port++) if (await isFree(port)) return port;
  return null;
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve(true)));
  });
}
