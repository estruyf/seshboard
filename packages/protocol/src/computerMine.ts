/**
 * Whether a session on a paired computer is mine (docs/remote-access.md, Other computers): this computer started it
 * there (New session, Run on), or acted on it from here (sent it a message, answered its permission prompt or
 * question, started it again), or it is a sub-session of one of those. `mineHere` is what the engine remembers
 * (`Computer.mineHere`), the newest `COMPUTER_STARTED_MAX`. Once a session is mine it stays mine. The sidebar's
 * Mine filter and the "Only mine" notifications both use this, so they always agree. Plain TypeScript, for the
 * engine, main and the windows.
 */
export function isMine(sessionId: string, parentId: string | null | undefined, computer: { readonly mineHere: readonly string[] }): boolean {
  return computer.mineHere.includes(sessionId) || (!!parentId && computer.mineHere.includes(parentId));
}
