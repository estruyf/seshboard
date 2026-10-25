/**
 * `run` for a timer in the main process, logging what it throws instead: an exception there shows Electron's "A
 * JavaScript error occurred in the main process" dialog, for something (a notification's text, a theme's reload) the
 * app can do without.
 */
export function guarded(label: string, run: () => void, log: (message: string, error: unknown) => void = console.error): () => void {
  return () => {
    try {
      run();
    } catch (error) {
      log(`[main] ${label} failed`, error);
    }
  };
}
