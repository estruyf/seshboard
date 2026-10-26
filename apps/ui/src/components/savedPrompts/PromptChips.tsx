import { byMostUsed } from '@seshboard/protocol/client';
import { useDrafts } from '../../state/draftsStore.ts';
import { Pill } from '../ui/Pill.tsx';
import { useSavedPrompts } from './savedPromptsStore.ts';
import { PromptIcon } from './ScopeTag.tsx';

/** How many prompts New session shows as chips; the others are in the / menu. */
export const PROMPT_CHIPS = 4;

/**
 * New session's saved prompts above the message box: the most used for the picked project first, then "All prompts…",
 * which opens the / menu. Nothing when there are none.
 */
export function PromptChips({ root, draftKey }: { root: string | null; draftKey: string | undefined }) {
  const { prompts } = useSavedPrompts(root);
  if (prompts.length === 0 || draftKey === undefined) return null;
  const top = byMostUsed(prompts).slice(0, PROMPT_CHIPS);
  return (
    <div className="-mb-3 flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Saved prompts" data-saved-prompt-chips>
      {top.map((prompt) => (
        <Pill
          key={`${prompt.scope.kind}:${prompt.id}`}
          icon={<PromptIcon size={12} aria-hidden className="text-muted" />}
          onClick={() => useDrafts.getState().requestPrompt(draftKey, prompt)}
          shrink
          data-tooltip={prompt.text.length > 160 ? `${prompt.text.slice(0, 159)}…` : prompt.text}
          data-saved-prompt-chip={prompt.id}
        >
          <span className="truncate">{prompt.name}</span>
        </Pill>
      ))}
      <button type="button" className="rounded px-1.5 py-0.5 text-ui text-muted hover:text-text" onClick={() => useDrafts.getState().requestPrompt(draftKey, null)} data-saved-prompt-all>
        All prompts…
      </button>
    </div>
  );
}
