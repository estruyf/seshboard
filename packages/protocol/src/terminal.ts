import { z } from 'zod';

/** `shell`: your login shell in the session's folder. `claude`: the real Claude Code TUI for the session. `action`: a project action's command. */
export const TerminalKind = z.enum(['shell', 'claude', 'action']);
export type TerminalKind = z.infer<typeof TerminalKind>;

export const TerminalInfo = z.object({
  id: z.string(),
  /** The session this terminal belongs to (panels are per session); null for the window's own terminal, outside sessions. */
  sessionId: z.string().nullable(),
  kind: TerminalKind,
  title: z.string(),
  cwd: z.string(),
  pid: z.number(),
  cols: z.number(),
  rows: z.number(),
  /** Null while running. */
  exitCode: z.number().nullable(),
  startedAt: z.number(),
});
export type TerminalInfo = z.infer<typeof TerminalInfo>;
