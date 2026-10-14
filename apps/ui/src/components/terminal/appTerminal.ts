/**
 * The window's own terminal panel: the one ⌘J opens outside a session (Home, a project's page, Projects,
 * Usage, New session). Its tabs are the engine's terminals without a session. In the terminals store it is
 * keyed by `APP_TERMINAL` where a session's panel is keyed by the session id.
 */
export const APP_TERMINAL = '@app';

/** Where you are, as far as the terminal cares: the palette's views. */
export type TerminalView = 'home' | 'new-session' | 'session' | 'settings' | 'projects' | 'project' | 'usage';

/**
 * Whose panel ⌘J shows: the session's in a session view, the window's on the other views, and none in
 * Settings, a sheet over the view it opened from (which stays inert behind it).
 */
export function terminalOwner(view: TerminalView, sessionId: string | null): string | null {
  if (view === 'session') return sessionId;
  return view === 'settings' ? null : APP_TERMINAL;
}

/** The engine's session for a panel's terminals: null for the window's own. */
export function ownerSession(owner: string): string | null {
  return owner === APP_TERMINAL ? null : owner;
}

/**
 * The folder a new tab of the window's terminal starts in: the project on screen, or the folder New session
 * starts in. Null (the home folder) everywhere else.
 */
export function appTerminalFolder(view: TerminalView, place: { projectRoot: string | null; newSessionCwd: string | null }): string | null {
  if (view === 'project') return place.projectRoot;
  if (view === 'new-session') return place.newSessionCwd;
  return null;
}
