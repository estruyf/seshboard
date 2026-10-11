import { rmSync } from 'node:fs';

const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

/**
 * Deletes a folder and everything in it, retrying for a moment while Windows still holds a file in it open
 * (a process that just exited, the virus scanner reading a new file). `rmSync`'s own `maxRetries` doesn't
 * retry those on Windows. Elsewhere the first attempt succeeds, so it behaves like `rmSync`.
 */
export async function removeDir(dir: string, limitMs = 5_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRY_CODES.has(code) || Date.now() - started > limitMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
