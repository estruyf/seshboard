import type { SlashCommand } from '@seshboard/protocol';

/** One of Copilot's slash commands, as `commands.list` gives it. */
export interface CopilotCommand {
  name: string;
  description?: string;
  aliases?: string[];
  input?: { hint?: string; required?: boolean };
  /** It can run while a turn is under way; otherwise it waits in Up next. */
  allowDuringAgentExecution?: boolean;
}

/**
 * Copilot's commands that Seshboard's own controls already are: the model chip, the mode chip (plan, autopilot,
 * permissions) and its own rename, which Copilot's would bypass.
 */
const SESHBOARD_HAS = new Set(['model', 'plan', 'autopilot', 'permissions', 'allow-all', 'yolo', 'rename']);

/** Copilot's commands for the message box's `/` list, without the ones Seshboard's controls are. */
export function commandList(commands: readonly CopilotCommand[]): SlashCommand[] {
  return commands.filter((c) => !SESHBOARD_HAS.has(c.name)).map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.input?.hint ?? '' }));
}

/** `/name rest` → the command and its input, when `name` is one of `commands` (by name or alias); null otherwise. */
export function parseCommand(text: string, commands: readonly CopilotCommand[]): { name: string; input: string } | null {
  const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  const command = commands.find((c) => c.name === name || c.aliases?.includes(name));
  return command && !SESHBOARD_HAS.has(command.name) ? { name: command.name, input: match[2]?.trim() ?? '' } : null;
}

/** What a command's result asks of the session: a prompt to send as a turn, words to show, a model to switch to. */
export interface CommandOutcome {
  prompt: string | null;
  note: string | null;
  model: string | null;
}

/**
 * Copilot's `SlashCommandInvocationResult` as what Seshboard does with it. Results that need Copilot's own terminal UI
 * (its model picker, a list to pick from) become a note saying what to do instead.
 */
export function commandOutcome(name: string, result: Record<string, unknown>): CommandOutcome {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const none: CommandOutcome = { prompt: null, note: null, model: null };
  switch (result.kind) {
    case 'agent-prompt':
      return { ...none, prompt: str(result.prompt), note: str(result.notice) };
    case 'text':
      return { ...none, note: str(result.text) };
    case 'completed':
      return { ...none, note: str(result.message) };
    case 'set-model':
      return { ...none, model: str(result.model), note: str(result.warning) };
    case 'add-timeline-entry': {
      const entry = (result.entry ?? {}) as Record<string, unknown>;
      return { ...none, note: str(entry.text) };
    }
    case 'select-subcommand': {
      const options = Array.isArray(result.options) ? result.options.map((o) => str((o as { name?: unknown }).name)).filter(Boolean) : [];
      return { ...none, note: options.length ? `/${name} takes one of: ${options.map((o) => `\`${o}\``).join(', ')}.` : str(result.title) };
    }
    case 'show-dialog':
      return { ...none, note: 'Pick the model with the model chip under the message box.' };
    default:
      return none;
  }
}
