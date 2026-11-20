import type { SavedPrompt, SlashCommand } from '@seshboard/protocol/client';
import { slashScore } from '../savedPrompts/fillModel.ts';

/** A row of the / menu over a remote message box: a saved prompt from this computer, or a command of the session there. */
export type RemoteSlashItem = { kind: 'prompt'; prompt: SavedPrompt } | { kind: 'command'; command: SlashCommand };

/**
 * What the / menu lists for `query`, as a local box does: saved prompts first (in their order while nothing is typed),
 * then the session's skills and commands, both matched by `slashScore`.
 */
export function remoteSlashItems(query: string, prompts: readonly SavedPrompt[], commands: readonly SlashCommand[]): RemoteSlashItem[] {
  const q = query.toLowerCase();
  const promptItems = prompts
    .map((prompt, order) => ({ prompt, score: slashScore(q, prompt.name, prompt.text), order }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => (q ? b.score! - a.score! : 0) || a.order - b.order)
    .slice(0, 20)
    .map(({ prompt }): RemoteSlashItem => ({ kind: 'prompt', prompt }));
  const commandItems = commands
    .map((command) => ({ command, score: slashScore(q, command.name, command.description) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score! - a.score! || a.command.name.localeCompare(b.command.name))
    .slice(0, 60)
    .map(({ command }): RemoteSlashItem => ({ kind: 'command', command }));
  return [...promptItems, ...commandItems];
}

/** The box's text after picking a command: `/name ` takes the place of the / and what was typed after it. */
export function withCommand(draft: string, start: number, end: number, name: string): { text: string; caret: number } {
  const insert = `/${name} `;
  return { text: `${draft.slice(0, start)}${insert}${draft.slice(end).replace(/^ /, '')}`, caret: start + insert.length };
}
