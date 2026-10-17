import { Fragment, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { X } from 'lucide-react';
import type { PromptBlank } from '@switchboard/protocol/client';
import { matches } from '../../lib/shortcuts.ts';
import { submitKey } from '../newSession/startMenu.ts';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { BlankPopover } from './BlankPopover.tsx';
import { blankAria, chipLabel, fromSegments, toSegments, type FillState } from './fillModel.ts';
import { BLANK_ICONS, PromptIcon, ScopeTag } from './ScopeTag.tsx';

export interface PromptFillerHandle {
  /** Focuses the first blank with this name, or the first empty one (required first). */
  focusBlank(name?: string): void;
  /** Focuses the last blank (Shift+Tab from the text under the prompt). */
  focusLast(): void;
}

export interface PromptFillerProps {
  state: FillState;
  onChange(state: FillState): void;
  /** The name of the project the box is in, for the scope tag. */
  projectName: string;
  /** The project's root (GitHub) and the session's folder (branches, files). */
  root: string | null;
  cwd: string | null;
  disabled?: boolean;
  /** Clear ×: the box goes back to plain text. */
  onClear(): void;
  /** The send keys, from a blank or the text: the box sends, or jumps to a blank that is still empty. */
  onSend(): void;
  /** Tab after the last blank: on to the text under the prompt. */
  onLeave(): void;
  ref?: Ref<PromptFillerHandle>;
}

const plainKey = (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey && !event.altKey;

/** Where the caret is in a text run (null when it isn't in it). */
function caretIn(el: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !el.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

function caretTo(el: HTMLElement, where: 'start' | 'end'): void {
  el.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(where === 'start');
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * A saved prompt being filled in, in the message box: a header (its name, where it is kept, "Tab next blank", Clear ×)
 * over its text, with each blank as a chip. The text around the blanks edits like text; a chip is filled by typing
 * (a text blank) or from its popover. Tab and Shift+Tab move between blanks; Backspace in an empty one goes back.
 */
export function PromptFiller(props: PromptFillerProps) {
  const { state, onChange } = props;
  const segments = useMemo(() => toSegments(state.text), [state.text]);
  const chips = useRef<Array<HTMLElement | null>>([]);
  const runs = useRef<Array<HTMLSpanElement | null>>([]);
  const [open, setOpen] = useState<{ index: number; query: string } | null>(null);
  /** The chip with the focus, for the hint next to an empty issue or pull request. */
  const [focused, setFocused] = useState<number | null>(null);
  const stateNow = useRef(state);
  stateNow.current = state;

  const valueOf = (blank: PromptBlank, values = state.values) => values[blank.name] ?? '';

  const focusChip = (index: number) => {
    const el = chips.current[index];
    if (!el) return;
    el.focus();
    // A text blank: the caret goes to the end of what it holds.
    if (el instanceof HTMLInputElement) el.setSelectionRange(el.value.length, el.value.length);
  };

  /** The first empty blank (required before optional), searching from `after`, then from the start. */
  const firstEmpty = (values = stateNow.current.values, after = -1): number => {
    const blanks = segments.blanks;
    const order = [...blanks.keys()].filter((i) => i > after).concat([...blanks.keys()].filter((i) => i <= after));
    return order.find((i) => !blanks[i]!.optional && !valueOf(blanks[i]!, values).trim()) ?? order.find((i) => !valueOf(blanks[i]!, values).trim()) ?? -1;
  };

  useImperativeHandle(props.ref, () => ({
    focusBlank: (name) => {
      const index = name ? segments.blanks.findIndex((b) => b.name === name) : firstEmpty();
      if (index !== -1) requestAnimationFrame(() => focusChip(index));
    },
    focusLast: () => focusChip(segments.blanks.length - 1),
  }));

  const setText = (index: number, value: string) => {
    const texts = segments.texts.map((t, i) => (i === index ? value : t));
    onChange({ ...stateNow.current, text: fromSegments({ texts, blanks: segments.blanks }) });
  };

  const setValue = (name: string, value: string, display?: string) => {
    const { displays, values } = stateNow.current;
    const nextDisplays = { ...displays };
    if (display && display !== value) nextDisplays[name] = display;
    else delete nextDisplays[name];
    const next = { ...stateNow.current, values: { ...values, [name]: value }, displays: nextDisplays };
    stateNow.current = next;
    onChange(next);
    return next;
  };

  /** Moves to the blank `step` away; past the last one, to the text under the prompt. */
  const move = (index: number, step: 1 | -1): boolean => {
    const target = index + step;
    if (target >= segments.blanks.length) {
      props.onLeave();
      return true;
    }
    if (target < 0) return false;
    focusChip(target);
    return true;
  };

  /** Keys every chip shares; true when one was used. */
  const chipKey = (event: KeyboardEvent<HTMLElement>, index: number, empty: boolean): boolean => {
    if (event.key === 'Tab' && plainKey(event)) {
      if (move(index, event.shiftKey ? -1 : 1)) event.preventDefault();
      return true;
    }
    if (event.key === 'Backspace' && empty && plainKey(event)) {
      event.preventDefault();
      move(index, -1);
      return true;
    }
    return false;
  };

  const pick = (index: number, value: string, display?: string) => {
    const blank = segments.blanks[index]!;
    const next = setValue(blank.name, value, display);
    setOpen(null);
    // On to the next blank that is still empty; with none left, the chip keeps the focus (⌘↵ sends from there).
    const target = firstEmpty(next.values, index);
    requestAnimationFrame(() => focusChip(target === -1 ? index : target));
  };

  const runKey = (event: KeyboardEvent<HTMLSpanElement>, index: number) => {
    if (event.nativeEvent.isComposing) return;
    const el = event.currentTarget;
    if (event.key === 'Tab' && plainKey(event)) {
      // From the text, Tab goes to the blank after it, Shift+Tab to the one before.
      const target = event.shiftKey ? index - 1 : index;
      if (target >= 0 && target < segments.blanks.length) {
        event.preventDefault();
        focusChip(target);
      } else if (!event.shiftKey) {
        event.preventDefault();
        props.onLeave();
      }
      return;
    }
    if (matches(event.nativeEvent, 'composer.newline')) {
      event.preventDefault();
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (submitKey(event.nativeEvent)) {
      event.preventDefault();
      props.onSend();
      return;
    }
    const caret = caretIn(el);
    if (!caret || caret.start !== caret.end) return;
    const length = el.textContent?.length ?? 0;
    if ((event.key === 'ArrowLeft' || event.key === 'Backspace') && caret.start === 0 && index > 0 && plainKey(event)) {
      event.preventDefault();
      focusChip(index - 1);
    } else if (event.key === 'ArrowRight' && caret.start === length && index < segments.blanks.length && plainKey(event)) {
      event.preventDefault();
      focusChip(index);
    }
  };

  const chip = (blank: PromptBlank, index: number) => {
    const value = valueOf(blank);
    const empty = !value.trim();
    const display = state.displays[blank.name];
    const Icon = BLANK_ICONS[blank.type];
    const label = chipLabel(blank);
    const frame = `mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 align-baseline text-ui leading-snug outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${empty ? 'border-dashed border-accent-ink bg-accent/10 text-accent-ink' : 'border-edge bg-bg text-text'}`;
    const hooks = { 'data-blank': blank.name, 'data-blank-type': blank.type, 'data-blank-empty': empty || undefined };
    const ref = (el: HTMLElement | null) => {
      chips.current[index] = el;
    };
    // A text blank (and a choice written without options) is typed into, in the chip itself.
    if (blank.type === 'text' || (blank.type === 'choice' && blank.options.length === 0)) {
      return (
        <span className={frame} {...hooks}>
          <Icon size={11} aria-hidden className={`shrink-0 ${empty ? 'text-accent-ink' : 'text-muted'}`} />
          <input
            ref={ref}
            value={value}
            disabled={props.disabled}
            placeholder={`${label}${blank.optional ? ' (optional)' : ''}`}
            aria-label={blankAria(blank, value)}
            spellCheck
            onChange={(e) => setValue(blank.name, e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || chipKey(e, index, empty)) return;
              const el = e.currentTarget;
              if (submitKey(e.nativeEvent)) {
                e.preventDefault();
                props.onSend();
              } else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && el.selectionEnd === 0) {
                e.preventDefault();
                const run = runs.current[index];
                if (run) caretTo(run, 'end');
              } else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) {
                e.preventDefault();
                const run = runs.current[index + 1];
                if (run) caretTo(run, 'start');
              }
            }}
            className="field-sizing-content min-w-[4ch] max-w-[40ch] bg-transparent py-px text-text outline-none placeholder:text-accent-ink"
          />
        </span>
      );
    }
    const isOpen = open?.index === index;
    return (
      <Fragment>
      <span
        ref={ref}
        role="combobox"
        tabIndex={props.disabled ? -1 : 0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={blankAria(blank, value, display)}
        aria-disabled={props.disabled || undefined}
        className={`${frame} cursor-default py-px`}
        {...hooks}
        onFocus={() => setFocused(index)}
        onBlur={() => setFocused((f) => (f === index ? null : f))}
        onMouseDown={(e) => {
          if (props.disabled) return;
          e.preventDefault();
          e.currentTarget.focus();
          setOpen(isOpen ? null : { index, query: '' });
        }}
        onKeyDown={(e) => {
          if (props.disabled || e.nativeEvent.isComposing || chipKey(e, index, empty)) return;
          if ((e.key === 'Enter' && plainKey(e) && !e.shiftKey) || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen({ index, query: '' });
          } else if (submitKey(e.nativeEvent)) {
            e.preventDefault();
            props.onSend();
          } else if ((e.key === 'Backspace' || e.key === 'Delete') && !empty && plainKey(e)) {
            e.preventDefault();
            setValue(blank.name, '');
          } else if (e.key === 'ArrowLeft' && plainKey(e)) {
            e.preventDefault();
            const run = runs.current[index];
            if (run) caretTo(run, 'end');
          } else if (e.key === 'ArrowRight' && plainKey(e)) {
            e.preventDefault();
            const run = runs.current[index + 1];
            if (run) caretTo(run, 'start');
          } else if (e.key.length === 1 && plainKey(e)) {
            // Typing fills it: the popover opens with what was typed.
            e.preventDefault();
            setOpen({ index, query: blank.type === 'choice' ? '' : e.key });
          }
        }}
      >
        <Icon size={11} aria-hidden className={`shrink-0 ${empty ? 'text-accent-ink' : 'text-muted'}`} />
        <span className={`min-w-0 truncate ${!empty && (blank.type === 'branch' || blank.type === 'file') ? 'font-mono' : ''}`}>{empty ? `${label}${blank.optional ? ' (optional)' : ''}` : <Shown text={display || value} />}</span>
        {!empty && (blank.type === 'issue' || blank.type === 'pr') && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Clear ${label}`}
            className="-mr-0.5 rounded text-muted hover:text-text"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setValue(blank.name, '');
              focusChip(index);
            }}
          >
            <X size={11} aria-hidden />
          </span>
        )}
      </span>
        {/* What it takes, next to an empty issue or pull request while it has the focus. */}
        {empty && !isOpen && focused === index && HINTS[blank.type] && (
          <span className="mr-1 text-meta text-faint" aria-hidden data-blank-hint>
            {HINTS[blank.type]}
          </span>
        )}
        {isOpen && chips.current[index] && (
          <BlankPopover
            blank={blank}
            anchor={chips.current[index]!}
            value={value}
            initialQuery={open.query}
            root={props.root}
            cwd={props.cwd}
            onPick={(picked, shown) => pick(index, picked, shown)}
            onClose={(refocus) => {
              setOpen(null);
              if (refocus) requestAnimationFrame(() => focusChip(index));
            }}
            onTab={(back) => {
              setOpen(null);
              requestAnimationFrame(() => move(index, back ? -1 : 1));
            }}
          />
        )}
      </Fragment>
    );
  };

  return (
    <div data-saved-prompt-box>
      <div className="mb-1.5 flex min-w-0 items-center gap-2 text-meta" data-saved-prompt-header>
        <PromptIcon size={12} aria-hidden className="shrink-0 text-muted" />
        <span className="min-w-0 truncate text-ui font-semibold text-text">{state.prompt.name}</span>
        <ScopeTag scope={state.prompt.scope} projectName={props.projectName} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted @max-[420px]:hidden">
          <Kbd shortcut="composer.next-blank" />
          next blank
        </span>
        <Button variant="quiet" size="sm" onClick={props.onClear} disabled={props.disabled} data-tooltip="Back to plain text: empty blanks become their name in brackets" data-saved-prompt-clear>
          Clear
          <X size={12} aria-hidden />
        </Button>
      </div>
      <div className="max-h-60 overflow-y-auto text-body leading-relaxed break-words whitespace-pre-wrap text-text" data-saved-prompt-text>
        {segments.texts.map((text, i) => (
          <Fragment key={i}>
            <TextRun
              value={text}
              disabled={props.disabled}
              runRef={(el) => {
                runs.current[i] = el;
              }}
              onInput={(value) => setText(i, value)}
              onKeyDown={(e) => runKey(e, i)}
            />
            {i < segments.blanks.length && chip(segments.blanks[i]!, i)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** What an empty issue or pull request takes, next to it while it has the focus. */
const HINTS: Partial<Record<PromptBlank['type'], string>> = { issue: '← paste a link or type #', pr: '← number, URL or title' };

/** A filled chip's text: "#132 Support Claude Code Mods" with its number in bold. */
function Shown({ text }: { text: string }) {
  const match = /^(#\d+)(\s.*)?$/.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      <span className="font-semibold">{match[1]}</span>
      {match[2]}
    </>
  );
}

/** A run of the prompt's text, edited in place. It holds its own text while you type; a change from outside replaces it. */
function TextRun({ value, disabled, runRef, onInput, onKeyDown }: { value: string; disabled?: boolean; runRef(el: HTMLSpanElement | null): void; onInput(value: string): void; onKeyDown(event: KeyboardEvent<HTMLSpanElement>): void }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);
  return (
    <span
      ref={(el) => {
        ref.current = el;
        runRef(el);
      }}
      contentEditable={disabled ? false : 'plaintext-only'}
      // Out of the Tab order: Tab moves between blanks.
      tabIndex={-1}
      role="textbox"
      aria-multiline
      aria-label="Prompt text"
      spellCheck
      onInput={(e) => onInput(e.currentTarget.textContent ?? '')}
      onKeyDown={onKeyDown}
      className="outline-none empty:inline-block empty:min-w-1"
      data-prompt-run
    />
  );
}
