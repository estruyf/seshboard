/**
 * Render counts for the smoke test's budget step (`render budget`): how many times the sidebar, its rows, the conversation and
 * the message box render while a session streams. Counted only in a smoke build (`npm run smoke…` compiles
 * `__RENDER_COUNTS__` in; see electron.vite.config.ts), where each component says `if (RENDER_COUNTS) countRender('Name')`.
 * Everywhere else the constant is false and the call is removed, so a release carries none of it. A smoke build also
 * keeps the engine's port in `window.__smoke.enginePort` (`engine/connection.ts`), for the driver to send events through.
 */
declare const __RENDER_COUNTS__: boolean | undefined;

export const RENDER_COUNTS: boolean = typeof __RENDER_COUNTS__ !== 'undefined' && __RENDER_COUNTS__ === true;

/** Counts one render of `name` in `window.__renders`. */
export function countRender(name: string): void {
  const bag = ((window as unknown as { __renders?: Record<string, number> }).__renders ??= {});
  bag[name] = (bag[name] ?? 0) + 1;
}
