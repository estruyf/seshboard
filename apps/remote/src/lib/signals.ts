/**
 * What the browser tab says, so it shows from another tab or the app switcher. Pure, with tests; `favicon.ts` draws
 * the dot.
 */

/** "(2) Seshboard Remote", or in a session "(2) Publish the beta · Seshboard". */
export function tabTitle(needsYou: number, sessionTitle: string | null): string {
  const count = needsYou > 0 ? `(${needsYou}) ` : '';
  return sessionTitle ? `${count}${sessionTitle} · Seshboard` : `${count}Seshboard Remote`;
}
