import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { BLANK_TYPE_LABELS, blankSource, freeBlankName, type BlankSpec, type BlankType, type PromptBlank } from '@switchboard/protocol/client';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { BlankForm } from './BlankForm.tsx';
import { chipLabel, fromSegments, insertBlank, removeBlank, replaceBlank, toSegments, type Segments } from './fillModel.ts';
import { BLANK_ICONS } from './ScopeTag.tsx';
import { detectSuggestions, type BlankSuggestion } from './suggestions.ts';

/** The Add blank menu, in this order. */
export const ADD_BLANK_TYPES: BlankType[] = ['issue', 'pr', 'branch', 'choice', 'text', 'file'];

/** What each type takes, on the right of the Add blank list. */
const ADD_BLANK_HINTS: Record<BlankType, string> = { issue: 'link or #', pr: 'open PRs', branch: 'local', choice: 'your options', text: 'anything', file: 'in the project' };

/** The name a new blank of each type starts with. */
const DEFAULT_NAMES: Record<BlankType, string> = { issue: 'issue', pr: 'pr', branch: 'branch', choice: 'choice', text: 'text', file: 'file' };

export interface PromptTextEditorProps {
  segments: Segments;
  onChange(segments: Segments): void;
  /** Save as prompt: links, branches and paths in the text show as suggestions a click turns into blanks. */
  suggest?: boolean;
  /** The project's local branches, so a branch without a usual prefix is found too. */
  branches?: readonly string[];
  /** The id of the text's label. */
  labelledBy?: string;
  /** On the right of the row under the text, after Add blank (the dialog's Cancel and Save). */
  actions?: ReactNode;
  /** Under the text, above that row: what the prompt asks for, or what is wrong with it. */
  status?: ReactNode;
}

/** Where the caret last was in the text: the run and the offset in it. */
interface Caret {
  run: number;
  offset: number;
}

function caretOffset(el: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !el.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.endContainer, range.endOffset);
  return before.toString().length;
}

function placeCaret(el: HTMLElement, offset: number): void {
  el.focus();
  const selection = window.getSelection();
  const node = el.firstChild;
  if (!selection) return;
  const range = document.createRange();
  if (node && node.nodeType === Node.TEXT_NODE) range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
  else range.selectNodeContents(el);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * A saved prompt's text in the editor: text you type, with each blank as a chip that opens a small form. "+ Add blank"
 * (or typing `{{`) puts a new one where the caret is.
 */
export function PromptTextEditor({ segments, onChange, suggest = false, branches = [], labelledBy, actions, status }: PromptTextEditorProps) {
  const runs = useRef<Array<HTMLSpanElement | null>>([]);
  const chips = useRef<Array<HTMLElement | null>>([]);
  const caret = useRef<Caret>({ run: segments.texts.length - 1, offset: segments.texts.at(-1)?.length ?? 0 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [form, setForm] = useState<number | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const now = useRef(segments);
  now.current = segments;

  const text = () => fromSegments(now.current);

  const setRun = (index: number, value: string) => onChange({ ...now.current, texts: now.current.texts.map((t, i) => (i === index ? value : t)) });

  const remember = (index: number) => {
    const el = runs.current[index];
    const offset = el ? caretOffset(el) : null;
    if (offset !== null) caret.current = { run: index, offset };
  };

  /** Puts a new blank at the caret; a choice and a text blank open their form, since their name and options matter. */
  const add = (type: BlankType) => {
    const at = caret.current.run < now.current.texts.length ? caret.current : { run: now.current.texts.length - 1, offset: now.current.texts.at(-1)!.length };
    const spec: BlankSpec = { name: freeBlankName(text(), DEFAULT_NAMES[type]), type, options: [], optional: false };
    const next = insertBlank(now.current, at.run, Math.min(at.offset, now.current.texts[at.run]!.length), spec);
    onChange(next);
    const index = at.run;
    caret.current = { run: index + 1, offset: 0 };
    requestAnimationFrame(() => {
      if (type === 'choice' || type === 'text') setForm(index);
      else {
        const run = runs.current[index + 1];
        if (run) placeCaret(run, 0);
      }
    });
  };

  const applySuggestion = (run: number, suggestion: BlankSuggestion) => {
    const spec: BlankSpec = { name: freeBlankName(text(), suggestion.name), type: suggestion.type, options: [], optional: false };
    const texts = now.current.texts.map((t, i) => (i === run ? `${t.slice(0, suggestion.start)}${t.slice(suggestion.end)}` : t));
    onChange(insertBlank({ texts, blanks: now.current.blanks }, run, suggestion.start, spec));
  };

  const openMenuAtCaret = () => {
    const selection = window.getSelection();
    const rect = selection && selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const fallback = addRef.current?.getBoundingClientRect();
    if (rect && (rect.left || rect.top)) setMenu({ x: rect.left, y: rect.bottom + 4 });
    else if (fallback) setMenu({ x: fallback.left, y: fallback.bottom + 4 });
  };

  const onRunInput = (index: number, el: HTMLSpanElement) => {
    const value = el.textContent ?? '';
    const offset = caretOffset(el) ?? value.length;
    // `{{` opens the Add blank list; the braces themselves go.
    if (value.slice(Math.max(0, offset - 2), offset) === '{{') {
      const without = `${value.slice(0, offset - 2)}${value.slice(offset)}`;
      el.textContent = without;
      placeCaret(el, offset - 2);
      caret.current = { run: index, offset: offset - 2 };
      setRun(index, without);
      openMenuAtCaret();
      return;
    }
    // Blanks written out (pasted, or typed to their closing braces) become chips.
    const written = toSegments(value);
    if (written.blanks.length) {
      const { texts, blanks } = now.current;
      const run = index + written.blanks.length;
      const tail = written.texts.at(-1)!;
      onChange({ texts: [...texts.slice(0, index), ...written.texts, ...texts.slice(index + 1)], blanks: [...blanks.slice(0, index), ...written.blanks, ...blanks.slice(index)] });
      caret.current = { run, offset: tail.length };
      requestAnimationFrame(() => {
        const el = runs.current[run];
        if (el) placeCaret(el, tail.length);
      });
      return;
    }
    caret.current = { run: index, offset };
    setRun(index, value);
  };

  const onRunKey = (event: KeyboardEvent<HTMLSpanElement>, index: number) => {
    if (event.nativeEvent.isComposing) return;
    const el = event.currentTarget;
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      document.execCommand('insertText', false, '\n');
      return;
    }
    const offset = caretOffset(el);
    if (offset === null) return;
    const length = el.textContent?.length ?? 0;
    if ((event.key === 'ArrowLeft' || event.key === 'Backspace') && offset === 0 && index > 0 && !event.shiftKey && window.getSelection()?.isCollapsed) {
      event.preventDefault();
      chips.current[index - 1]?.focus();
    } else if ((event.key === 'ArrowRight' || event.key === 'Delete') && offset === length && index < now.current.blanks.length && !event.shiftKey) {
      event.preventDefault();
      chips.current[index]?.focus();
    }
  };

  const onChipKey = (event: KeyboardEvent<HTMLSpanElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setForm(index);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      const offset = now.current.texts[index]!.length;
      onChange(removeBlank(now.current, index));
      requestAnimationFrame(() => {
        const run = runs.current[index];
        if (run) placeCaret(run, offset);
      });
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const run = runs.current[index];
      if (run) placeCaret(run, run.textContent?.length ?? 0);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const run = runs.current[index + 1];
      if (run) placeCaret(run, 0);
    }
  };

  const chip = (blank: PromptBlank, index: number) => {
    const Icon = BLANK_ICONS[blank.type];
    const problem = !blank.name ? 'Give this blank a name' : blank.type === 'choice' && blank.options.length === 0 ? 'A choice needs options' : null;
    return (
      <Fragment>
        <span
          ref={(el) => {
            chips.current[index] = el;
          }}
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-expanded={form === index}
          aria-label={`${BLANK_TYPE_LABELS[blank.type]} blank “${blank.name || 'no name'}”${blank.optional ? ', optional' : ''}. Enter edits it.`}
          className={`mx-0.5 inline-flex cursor-default items-center gap-1 rounded-md border px-1.5 py-px align-baseline text-ui leading-snug outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${problem ? 'border-dashed border-error text-error' : 'border-dashed border-accent-ink bg-accent/10 text-accent-ink'}`}
          data-tooltip={problem ?? blankSource(blank)}
          data-editor-blank={blank.name}
          onMouseDown={(e: ReactMouseEvent) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
            setForm(form === index ? null : index);
          }}
          onKeyDown={(e) => onChipKey(e, index)}
        >
          <Icon size={11} aria-hidden className="shrink-0 text-accent-ink" />
          <span>{blank.name ? chipLabel(blank) : 'name it'}</span>
          {blank.optional && <span className="text-faint">?</span>}
        </span>
        {form === index && chips.current[index] && (
          <BlankForm
            anchor={chips.current[index]!}
            spec={blank}
            onChange={(spec) => onChange(replaceBlank(now.current, index, spec))}
            onRemove={() => {
              setForm(null);
              onChange(removeBlank(now.current, index));
            }}
            onClose={(refocus) => {
              setForm(null);
              if (refocus) requestAnimationFrame(() => chips.current[index]?.focus());
            }}
          />
        )}
      </Fragment>
    );
  };

  const empty = segments.blanks.length === 0 && !segments.texts[0];
  const entries: MenuEntry[] = ADD_BLANK_TYPES.map((type) => {
    const Icon = BLANK_ICONS[type];
    return { label: BLANK_TYPE_LABELS[type], icon: <Icon size={13} aria-hidden />, hint: ADD_BLANK_HINTS[type], onSelect: () => add(type), data: { 'data-add-blank-type': type } };
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="relative max-h-72 min-h-28 overflow-y-auto rounded-md border border-edge bg-bg px-2.5 py-2 text-body leading-relaxed break-words whitespace-pre-wrap text-text focus-within:border-accent-ink/60"
        onMouseDown={(e) => {
          // A click on the empty part of the field goes to the end of the text.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          const last = runs.current[segments.texts.length - 1];
          if (last) placeCaret(last, last.textContent?.length ?? 0);
        }}
        role="group"
        aria-labelledby={labelledBy}
        data-prompt-editor
      >
        {empty && (
          <span className="pointer-events-none absolute top-2 left-2.5 text-faint" aria-hidden>
            Write the prompt. Type {'{{'} or use Add blank for a blank you fill in later.
          </span>
        )}
        {segments.texts.map((value, i) => (
          <Fragment key={i}>
            <EditorRun
              value={value}
              suggestions={suggest ? detectSuggestions(value, branches) : []}
              onApply={(s) => applySuggestion(i, s)}
              runRef={(el) => {
                runs.current[i] = el;
              }}
              onInput={(el) => onRunInput(i, el)}
              onKeyDown={(e) => onRunKey(e, i)}
              onCaret={() => remember(i)}
            />
            {i < segments.blanks.length && chip(segments.blanks[i]!, i)}
          </Fragment>
        ))}
      </div>
      {status}
      <div className="mt-1 flex items-center gap-2">
        <Button
          ref={addRef}
          size="sm"
          icon={<Plus size={12} aria-hidden />}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const rect = addRef.current!.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
          aria-haspopup="menu"
          data-add-blank
        >
          Add blank
          <ChevronDown size={12} aria-hidden />
        </Button>
        <span className="text-meta text-faint">or type {'{{'}</span>
        {actions && <span className="ml-auto flex items-center gap-2">{actions}</span>}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} label="Add blank" width={240} />}
    </div>
  );
}

/**
 * A run of the prompt's text. With suggestions (Save as prompt), it shows them marked until you click into it; a click
 * on a mark makes it a blank. While you type it holds its own text.
 */
function EditorRun({
  value,
  suggestions,
  onApply,
  runRef,
  onInput,
  onKeyDown,
  onCaret,
}: {
  value: string;
  suggestions: BlankSuggestion[];
  onApply(suggestion: BlankSuggestion): void;
  runRef(el: HTMLSpanElement | null): void;
  onInput(el: HTMLSpanElement): void;
  onKeyDown(event: KeyboardEvent<HTMLSpanElement>): void;
  onCaret(): void;
}) {
  const [editing, setEditing] = useState(false);
  const click = useRef<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const marks = suggestions.length > 0 && !editing;

  useLayoutEffect(() => {
    const el = ref.current;
    if (marks || !el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value, marks]);

  // Switched to typing by a click: the caret goes where the click was.
  useLayoutEffect(() => {
    if (!editing || !click.current || !ref.current) return;
    const { x, y } = click.current;
    click.current = null;
    ref.current.focus();
    const range = document.caretRangeFromPoint?.(x, y);
    if (range && ref.current.contains(range.startContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [editing]);

  if (marks) {
    const parts: Array<string | BlankSuggestion> = [];
    let at = 0;
    for (const s of suggestions) {
      if (s.start > at) parts.push(value.slice(at, s.start));
      parts.push(s);
      at = s.end;
    }
    if (at < value.length) parts.push(value.slice(at));
    return (
      <span
        key="marks"
        ref={(el) => {
          ref.current = el;
          runRef(el);
        }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('[data-blank-suggestion]')) return;
          click.current = { x: e.clientX, y: e.clientY };
          setEditing(true);
        }}
        onFocus={() => setEditing(true)}
        tabIndex={-1}
        data-prompt-run
      >
        {parts.map((part, i) =>
          typeof part === 'string' ? (
            part
          ) : (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onApply(part)}
              className="rounded-sm bg-link/12 px-0.5 text-link underline decoration-dotted underline-offset-2 hover:bg-link/20"
              data-tooltip={`Make this a ${BLANK_TYPE_LABELS[part.type].toLowerCase()} blank`}
              data-blank-suggestion={part.type}
            >
              {part.text}
            </button>
          ),
        )}
      </span>
    );
  }

  return (
    <span
      key="edit"
      ref={(el) => {
        ref.current = el;
        runRef(el);
      }}
      contentEditable="plaintext-only"
      role="textbox"
      aria-multiline
      aria-label="Prompt text"
      spellCheck
      onInput={(e) => onInput(e.currentTarget)}
      onKeyDown={onKeyDown}
      onKeyUp={onCaret}
      onMouseUp={onCaret}
      onFocus={onCaret}
      onBlur={() => {
        onCaret();
        if (suggestions.length) setEditing(false);
      }}
      className="outline-none empty:inline-block empty:min-w-1"
      data-prompt-run
    />
  );
}
