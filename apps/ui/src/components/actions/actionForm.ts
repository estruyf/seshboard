import type { ActionScope, ActionSuggestion, ListedAction, ProjectAction } from '@switchboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { formatShortcut, normalizeShortcut, reservedShortcuts, sameShortcut } from '../../lib/shortcuts.ts';

/** The form's state: an action plus where it is saved. `shared` only appears read-only. */
export type ActionDraft = ProjectAction & { scope: ActionScope };

export const EMPTY_DRAFT: ActionDraft = {
  id: '',
  name: '',
  icon: 'play',
  type: 'shell',
  command: '',
  cwd: 'session',
  confirm: false,
  shortcut: null,
  runOnWorktreeCreate: false,
  scope: 'project',
};

export const NAME_MAX = 40;
export const COMMAND_MAX = 10_000;

/** The variables a command or prompt can use, in the order the Insert chips show them. */
export const ACTION_VARIABLES = ['branch', 'cwd', 'projectRoot', 'worktreeName', 'sessionId', 'sessionTitle'] as const;

/** The id an action gets from its name (the protocol allows lowercase letters, digits and dashes). */
export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'action'
  );
}

/** A stable key for an action in the list (ids are only unique within a scope). */
export const actionKey = (a: { scope: ActionScope; id: string }) => `${a.scope}:${a.id}`;

/**
 * The list with `saved` in place of the action it was edited from (`previous`), or added at the end
 * when it is new, so pills and menus show a save at once instead of after the list reloads.
 */
export function applySavedAction(actions: ListedAction[], saved: ListedAction, previous: { scope: ActionScope; id: string } | null): ListedAction[] {
  const keys = new Set([actionKey(saved), ...(previous ? [actionKey(previous)] : [])]);
  const at = actions.findIndex((a) => keys.has(actionKey(a)));
  const rest = actions.filter((a) => !keys.has(actionKey(a)));
  // Nothing before `at` was removed (it is the first match), so the index still holds in `rest`.
  if (at < 0) return [...rest, saved];
  return [...rest.slice(0, at), saved, ...rest.slice(at)];
}

/** The list without one action, for a delete that shows before the list reloads. */
export const withoutAction = (actions: ListedAction[], removed: { scope: ActionScope; id: string }) => actions.filter((a) => actionKey(a) !== actionKey(removed));

/** Splits the list into the actions you can edit and the read-only ones from .switchboard.json. */
export function groupActions(actions: ListedAction[]): {
  yours: ListedAction[];
  shared: ListedAction[];
} {
  return {
    yours: actions.filter((a) => a.scope !== 'shared'),
    shared: actions.filter((a) => a.scope === 'shared'),
  };
}

/** Suggestions not already added as an action, and how many are hidden behind "N more…". */
export function visibleSuggestions(suggestions: ActionSuggestion[], actions: ListedAction[], expanded: boolean, limit = 4): { shown: ActionSuggestion[]; hidden: number } {
  const used = new Set(actions.map((a) => a.command));
  const open = suggestions.filter((s) => !used.has(s.command));
  if (expanded || open.length <= limit) return { shown: open, hidden: 0 };
  return { shown: open.slice(0, limit), hidden: open.length - limit };
}

export interface DraftErrors {
  name?: string;
  command?: string;
  shortcut?: string;
}

/**
 * Checks the form before it goes to the engine, so people see which field to fix instead of a
 * protocol error. `editing` is the action being changed, so keeping its own name isn't a clash.
 */
export function validateDraft(draft: ActionDraft, actions: ListedAction[], editing: { scope: ActionScope; id: string } | null): DraftErrors {
  const errors: DraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Give the action a name.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters.`;
  else if (!(editing && editing.scope === draft.scope)) {
    // An edit in the same scope keeps its id, so only new ids can clash.
    const id = slug(name);
    const clash = actions.find((a) => a.scope === draft.scope && a.id === id);
    if (clash) errors.name = `“${clash.name}” already uses this name.`;
  }
  const command = draft.command.trim();
  if (!command) errors.command = draft.type === 'shell' ? 'Enter the command to run.' : 'Enter what to ask Claude.';
  else if (command.length > COMMAND_MAX) errors.command = 'This is too long to save.';
  if (draft.shortcut) {
    // The action being edited keeps its own shortcut (also when it moves to the other scope).
    const other = actions.find((a) => a.shortcut && sameShortcut(a.shortcut, draft.shortcut!) && !(editing && a.scope === editing.scope && a.id === editing.id));
    if (reservedShortcuts().has(normalizeShortcut(draft.shortcut))) errors.shortcut = `${formatShortcut(draft.shortcut)} is used by Switchboard.`;
    else if (other) errors.shortcut = `“${other.name}” already uses ${formatShortcut(draft.shortcut)}.`;
  }
  return errors;
}

/** A save failure as a sentence people can act on; protocol validation messages mean nothing to them. */
export function friendlySaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/^Invalid params/i.test(message)) return 'Couldn’t save: check the name and command.';
  return `Couldn’t save: ${message}`;
}

/** Puts `${name}` in place of the selection and returns the new text and where the cursor goes. */
export function insertVariable(text: string, start: number, end: number, name: string): { text: string; cursor: number } {
  const token = `\${${name}}`;
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return {
    text: text.slice(0, from) + token + text.slice(to),
    cursor: from + token.length,
  };
}

/** The last folder of a path, as the dialog's subtitle. */
export const projectName = (root: string) => basename(root);
