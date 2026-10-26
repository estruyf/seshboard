import { joinPath, type PromptScope, type SavedPrompt } from '@seshboard/protocol/client';
import { showInChanges } from '../../state/showInChanges.ts';
import { toast } from '../../state/toastStore.ts';
import { sameScope } from './fillModel.ts';
import { engineClient } from './savedPromptsStore.ts';

/** The project's shared settings file, where shared prompts are kept with its actions. */
export const SHARED_FILE = '.seshboard.json';

const client = () => {
  const c = engineClient();
  if (!c) throw new Error('Not connected to the engine');
  return c;
};

/** Where a prompt goes, in words: "every project", "switchboard, just for you", "switchboard, shared". */
export function placeName(scope: PromptScope, nameOf: (root: string) => string): string {
  if (scope.kind === 'global') return 'every project';
  return scope.kind === 'personal' ? `${nameOf(scope.root)}, just for you` : `${nameOf(scope.root)}, shared with the project`;
}

/**
 * Says that a prompt went into a project's shared file, or out of it: that changes a file in the repository, so the
 * toast says to commit it, with Show the change (Changes on that file) and Undo.
 */
export function announceShared(name: string, root: string, shared: boolean, nameOf: (root: string) => string, undo: () => void): void {
  const file = joinPath(root, SHARED_FILE);
  toast(shared ? `${name} is shared with ${nameOf(root)}` : `${name} is no longer shared with ${nameOf(root)}`, {
    body: "Commit the project's actions file so your team gets it.",
    icon: 'shared',
    data: { 'data-prompt-share-toast': shared ? 'shared' : 'unshared' },
    actions: [
      {
        label: 'Show the change',
        onSelect: () => {
          if (!showInChanges(root, file)) void engineClient()?.call('editors.open', { path: file }).catch(() => {});
        },
        data: { 'data-prompt-show-change': true },
      },
      { label: 'Undo', onSelect: undo, data: { 'data-prompt-undo': true } },
    ],
  });
}

/** Says where a prompt went: the shared toast when a project's file changed, otherwise a short one with Undo. */
export function announceMove(before: SavedPrompt, after: SavedPrompt, nameOf: (root: string) => string): void {
  const undo = () => void client().call('savedPrompts.move', { id: after.id, from: after.scope, to: before.scope }).catch((e: Error) => toast(`Couldn't undo: ${e.message}`));
  // The file that changed in the repository: the one it went to, or the one it left.
  const fileRoot = after.scope.kind === 'shared' ? after.scope.root : before.scope.kind === 'shared' ? before.scope.root : null;
  if (fileRoot) announceShared(before.name, fileRoot, after.scope.kind === 'shared', nameOf, undo);
  else toast(`Moved “${before.name}” to ${placeName(after.scope, nameOf)}`, { undo });
}

/** Moves a prompt and says so (a failure in a toast too). */
export async function movePrompt(prompt: SavedPrompt, to: PromptScope, nameOf: (root: string) => string): Promise<SavedPrompt | null> {
  if (sameScope(prompt.scope, to)) return prompt;
  try {
    const moved = (await client().call('savedPrompts.move', { id: prompt.id, from: prompt.scope, to })).prompt;
    announceMove(prompt, moved, nameOf);
    return moved;
  } catch (error) {
    toast(`Couldn't move “${prompt.name}”: ${(error as Error).message}`);
    return null;
  }
}

/** Deletes a prompt, with Undo (it comes back where it was, with its text). */
export async function deletePrompt(prompt: SavedPrompt): Promise<void> {
  try {
    await client().call('savedPrompts.delete', { id: prompt.id, scope: prompt.scope });
  } catch (error) {
    toast(`Couldn't delete “${prompt.name}”: ${(error as Error).message}`);
    return;
  }
  toast(`Deleted “${prompt.name}”`, {
    undo: () => void client().call('savedPrompts.save', { prompt: { id: prompt.id, name: prompt.name, text: prompt.text, scope: prompt.scope } }).catch((e: Error) => toast(`Couldn't undo: ${e.message}`)),
    data: { 'data-prompt-deleted-toast': true },
  });
}

/** A copy next to it, "<name> copy". */
export async function duplicatePrompt(prompt: SavedPrompt): Promise<void> {
  try {
    await client().call('savedPrompts.save', { prompt: { name: `${prompt.name} copy`.slice(0, 60), text: prompt.text, scope: prompt.scope } });
  } catch (error) {
    toast(`Couldn't duplicate “${prompt.name}”: ${(error as Error).message}`);
  }
}
