import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PARENT_MENTION } from '@seshboard/protocol/client';
import { filterChoices, insertMention, mentionQuery, promptParts } from './editorModel.ts';

/**
 * A step's prompt: a text box where `@parent` and `@<earlier step>` show as violet chips. Typing `@` opens the list of
 * what it can link (`choices`); arrow keys move, Enter or Tab puts one in, Escape closes the list (and only the list).
 * As in the trigger editor's prompt, the chips are drawn on a layer behind the text, so the text stays plain text.
 */
export function MentionPromptField({
  value,
  onChange,
  choices,
  id,
  describedBy,
  invalid,
  readOnly,
}: {
  value: string;
  onChange(value: string): void;
  /** `parent`, then the earlier steps that are sessions (`mentionChoices`). */
  choices: readonly string[];
  id: string;
  describedBy?: string;
  invalid?: boolean;
  readOnly?: boolean;
}) {
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const behind = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<{ start: number; query: string; active: number } | null>(null);
  const options = list ? filterChoices(choices, list.query) : [];
  const open = !!list && options.length > 0 && !readOnly;

  // As tall as its text, from three lines to twelve.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 66), 260)}px`;
  }, [value]);

  const look = (text: string, caret: number) => {
    const query = mentionQuery(text, caret);
    setList(query ? { start: query.start, query: query.query, active: 0 } : null);
  };
  const choose = (name: string) => {
    const el = ref.current;
    if (!el || !list) return;
    const { text, caret } = insertMention(value, list.start, el.selectionStart, name);
    onChange(text);
    setList(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || !list) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setList({ ...list, active: (list.active + step + options.length) % options.length });
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(options[list.active]!);
    } else if (event.key === 'Escape') {
      // The list takes Escape; Settings stays open.
      event.preventDefault();
      event.stopPropagation();
      setList(null);
    }
  };

  const box = 'col-start-1 row-start-1 w-full rounded-lg px-3 py-2.5 text-body leading-6 whitespace-pre-wrap break-words';
  return (
    <div className="relative grid">
      <div ref={behind} aria-hidden className={`${box} pointer-events-none overflow-hidden border border-transparent text-text`} data-pipeline-prompt-chips>
        {promptParts(value, choices).map((part, i) =>
          part.mention ? (
            // The same font and size as the text in front, so the chip sits exactly under it.
            <span key={i} className="rounded-[4px] bg-pipeline/15 text-pipeline shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-pipeline)_15%,transparent)]" data-pipeline-mention={part.mention}>
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
        {/* A last empty line still takes its height, as in the text box. */}
        {'​'}
      </div>
      <textarea
        ref={ref}
        id={id}
        value={value}
        rows={3}
        spellCheck
        readOnly={readOnly}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && list ? `${listId}-${list.active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          look(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') look(value, e.currentTarget.selectionStart);
        }}
        onBlur={() => setList(null)}
        onScroll={(e) => {
          if (behind.current) behind.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className={`${box} resize-none overflow-hidden border bg-transparent text-transparent caret-text outline-none selection:bg-accent/30 selection:text-transparent focus:border-accent-ink ${invalid ? 'border-error' : 'border-edge'}`}
        data-pipeline-prompt
      />
      {open && list && (
        <div id={listId} role="listbox" aria-label="Link a session" className="overlay absolute top-full left-3 z-10 mt-1 grid w-64 gap-px rounded-lg p-1" data-pipeline-mentions>
          {options.map((name, i) => (
            <div
              key={name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === list.active}
              // Chosen on the press, before the field loses focus and the list closes.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(name);
              }}
              onMouseEnter={() => setList({ ...list, active: i })}
              className={`flex cursor-default items-baseline gap-2 rounded-md px-2 py-1 text-ui ${i === list.active ? 'bg-accent/15' : ''}`}
              data-pipeline-mention-option={name}
            >
              <span className="text-pipeline">@{name}</span>
              <span className="min-w-0 truncate text-meta text-muted">{name === PARENT_MENTION ? 'The session you run it from' : 'An earlier step'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
