import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { blanksOf, promptPreview, type SavedPrompt } from '@seshboard/protocol/client';
import { useDrafts } from '../../state/draftsStore.ts';
import { tokenAtCaret } from '../composer/tokens.ts';
import { blanksLeft, fillMessage, scopeKey, slashScore, startFill, type FillState } from '../savedPrompts/fillModel.ts';
import type { PromptFillerHandle } from '../savedPrompts/PromptFiller.tsx';
import { engineClient, useSavedPrompts } from '../savedPrompts/savedPromptsStore.ts';
import { PromptIcon, ScopeTag } from '../savedPrompts/ScopeTag.tsx';

interface Menu {
  /** Where the / is, and where the caret was after what was typed after it: the part a pick takes out. */
  start: number;
  end: number;
  items: SavedPrompt[];
  active: number;
}

/**
 * Saved prompts in a message box for another computer (a session's, or New session's): the / menu, the prompt over the
 * box to fill in, and New session's chips (`useDrafts().requestPrompt` with `key`).
 * Saved prompts live on this computer; the ones for every project are offered, as a project's belong to a folder here.
 */
export function useRemoteSavedPrompts({ key, draft, setDraft, areaRef, initialFill, disabled }: { key: string; draft: string; setDraft(text: string): void; areaRef: RefObject<HTMLTextAreaElement | null>; initialFill?: FillState; disabled: boolean }) {
  const { prompts } = useSavedPrompts(undefined);
  const [fill, setFill] = useState<FillState | null>(initialFill ?? null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const fillerRef = useRef<PromptFillerHandle>(null);
  const left = fill ? blanksLeft(fill) : [];

  const updateMenu = (value: string, caret: number) => {
    const token = tokenAtCaret(value, caret);
    if (!token || token.kind !== 'slash') return setMenu(null);
    const items = prompts
      .map((prompt, order) => ({ prompt, score: slashScore(token.query.toLowerCase(), prompt.name, prompt.text), order }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => (token.query ? b.score! - a.score! : 0) || a.order - b.order)
      .slice(0, 20)
      .map(({ prompt }) => prompt);
    setMenu(items.length ? { start: token.start, end: caret, items, active: 0 } : null);
  };
  /** The prompt goes over the box, to be filled in: its first blank gets the focus, else the box. */
  const startPrompt = (prompt: SavedPrompt) => {
    setFill(startFill(prompt));
    requestAnimationFrame(() => (blanksOf(prompt.text).length ? fillerRef.current?.focusBlank() : areaRef.current?.focus()));
  };
  /**
   * The / and what was typed after it go. From where the menu was opened, not the caret: the caret isn't always where
   * the typing left it by the time the pick lands (seen with a click on the list).
   */
  const choose = (prompt: SavedPrompt) => {
    if (!menu) return;
    setDraft(`${draft.slice(0, menu.start)}${draft.slice(menu.end).replace(/^ /, '')}`.trim());
    setMenu(null);
    startPrompt(prompt);
  };
  const clearFill = () => {
    setFill(null);
    requestAnimationFrame(() => areaRef.current?.focus());
  };

  // New session's chips (and All prompts…) ask the box by its key, as they do a local one.
  const request = useDrafts((s) => (s.promptRequest?.key === key ? s.promptRequest : null));
  useEffect(() => {
    if (!request || disabled) return;
    useDrafts.getState().clearPromptRequest();
    if (request.prompt) return startPrompt(request.prompt);
    // All prompts…: the / menu, as if / was typed at the start.
    const el = areaRef.current;
    if (!el) return;
    const value = draft.startsWith('/') ? draft : `/${draft ? ` ${draft}` : ''}`;
    setDraft(value);
    el.focus();
    requestAnimationFrame(() => {
      el.setSelectionRange(1, 1);
      updateMenu(value, 1);
    });
  }, [request, disabled]);

  /** Arrows, Enter, Tab and Escape while the / menu is open; true when the key was the menu's. */
  const onMenuKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!menu) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setMenu({ ...menu, active: (menu.active + step + menu.items.length) % menu.items.length });
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
      event.preventDefault();
      choose(menu.items[menu.active]!);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenu(null);
      return true;
    }
    return false;
  };

  /**
   * The message to send: the filled-in prompt with the box's text after it. Null, after focusing it, while a blank is
   * still empty.
   */
  const message = (): string | null => {
    if (fill && left.length) {
      fillerRef.current?.focusBlank(left[0]);
      return null;
    }
    return (fill ? fillMessage(fill, draft) : draft).trim();
  };
  /** Sent: the prompt leaves the box (unless another was picked meanwhile) and counts as used. */
  const sent = (sentFill: FillState | null) => {
    setFill((current) => (current === sentFill ? null : current));
    if (sentFill) void engineClient()?.call('savedPrompts.used', { id: sentFill.prompt.id, scope: sentFill.prompt.scope }).catch(() => {});
  };

  return { fill, setFill, fillerRef, left, menu, setMenu, updateMenu, choose, clearFill, onMenuKey, message, sent, hasPrompts: prompts.length > 0 };
}

/** The / menu over a remote message box. */
export function SavedPromptMenu({ menu, onChoose, projectName }: { menu: Menu; onChoose(prompt: SavedPrompt): void; projectName: string }) {
  return (
    <ul className="absolute right-0 bottom-full left-0 z-10 mb-2 max-h-72 overflow-y-auto rounded-lg border overlay" role="listbox" aria-label="Saved prompts" data-palette>
      <li role="presentation" className="px-3 pt-2 pb-1 text-meta font-semibold tracking-wide text-faint uppercase" data-palette-heading>
        Saved prompts
      </li>
      {menu.items.map((prompt, i) => (
        <li
          key={`${scopeKey(prompt.scope)}:${prompt.id}`}
          role="option"
          aria-selected={i === menu.active}
          onMouseDown={(e) => {
            e.preventDefault();
            onChoose(prompt);
          }}
          className={`flex w-full cursor-default items-baseline gap-3 px-3 py-1.5 text-left hover:bg-accent/10 ${i === menu.active ? 'bg-accent/15' : ''}`}
          data-saved-prompt-option={prompt.id}
        >
          <PromptIcon size={12} aria-hidden className="shrink-0 self-center text-muted" />
          <span className="shrink-0 text-ui font-semibold text-text">{prompt.name}</span>
          <span className="min-w-0 flex-1 truncate text-meta text-muted">{promptPreview(prompt.text)}</span>
          <ScopeTag scope={prompt.scope} projectName={projectName} className="self-center" />
        </li>
      ))}
    </ul>
  );
}
