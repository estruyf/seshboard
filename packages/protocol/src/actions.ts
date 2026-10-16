import { z } from 'zod';
import { ACTION_ICONS } from './actionIcons.ts';

export { ACTION_ICONS, type ActionIcon } from './actionIcons.ts';

export const ProjectAction = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, 'Use lowercase letters, digits and dashes'),
  name: z.string().min(1).max(40),
  icon: z.enum(ACTION_ICONS).default('play'),
  /** `shell` runs in a terminal tab; `prompt` is sent to the session as a message. */
  type: z.enum(['shell', 'prompt']).default('shell'),
  command: z.string().min(1).max(10_000),
  /** Where shell actions run: the session's folder (its worktree, if any) or the project root. */
  cwd: z.enum(['session', 'project-root']).default('session'),
  /** Ask before running (for publish, deploy, …). */
  confirm: z.boolean().default(false),
  /** e.g. `cmd+shift+p`. */
  shortcut: z.string().max(40).nullable().default(null),
  /** Run automatically in a new worktree before Claude starts (e.g. `npm install`). */
  runOnWorktreeCreate: z.boolean().default(false),
  /** Shell actions: when it ends, its exit code and the end of its output go to the session as a message (queued while Claude works). */
  sendOutput: z.boolean().default(false),
});
export type ProjectAction = z.infer<typeof ProjectAction>;

/** `project`: yours, for this project. `global`: yours, every project. `shared`: from the repo's .switchboard.json. */
export const ActionScope = z.enum(['project', 'global', 'shared']);
export type ActionScope = z.infer<typeof ActionScope>;

export const ListedAction = ProjectAction.extend({
  scope: ActionScope,
  /** Shared actions run only after you've approved their exact command. */
  trusted: z.boolean(),
});
export type ListedAction = z.infer<typeof ListedAction>;

export const ActionSuggestion = z.object({
  name: z.string(),
  command: z.string(),
  type: z.enum(['shell', 'prompt']),
  icon: z.enum(ACTION_ICONS),
});
export type ActionSuggestion = z.infer<typeof ActionSuggestion>;

export const ActionRunResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('terminal'), terminalId: z.string() }),
  z.object({ kind: z.literal('prompt'), sessionId: z.string(), messageUuid: z.string() }),
]);
export type ActionRunResult = z.infer<typeof ActionRunResult>;
