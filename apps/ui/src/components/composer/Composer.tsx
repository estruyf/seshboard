import { ImagePlus, Paperclip } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { joinPath, type ContextItem, type ImageAttachment, type SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { attachmentsAfterSend, textAfterSend } from './afterSend.ts';
import { AttachmentThumbs, DropOverlay } from './Attachments.tsx';
import { promptWithContext, type ContextChip } from './contextItems.ts';
import { ContextTray } from './ContextTray.tsx';
import { useComposerTargets } from '../../state/composerTargets.ts';
import { hasContent } from '../../state/drafts.ts';
import { useDrafts, type ComposerDraft } from '../../state/draftsStore.ts';
import { onFirstLine, onLastLine, textareaRows } from './caretLine.ts';
import { PromptHistory, recallAnnouncement, routeArrow, type Recall } from './promptHistory.ts';
import { tokenAtCaret } from './tokens.ts';
import { useAttachments } from './useAttachments.ts';
import { ariaKeysFor, formatKeys, keysFor, localizeKeys, matches, type ShortcutId } from '../../lib/shortcuts.ts';
import { submitKey } from '../newSession/startMenu.ts';

type PaletteItem = { value: string; label: string; detail: string };
interface Palette {
  kind: 'slash' | 'file';
  /** Where the token being completed starts (the `/` or `@`). */
  start: number;
  items: PaletteItem[];
  active: number;
}

export interface ComposerProps {
  /**
   * Keeps what is typed and attached under this key in the drafts store (a session's id, or New session's
   * `new:<folder>`), so it's still there after you open another session, and (the text) after a restart.
   * When the key changes, the box shows that key's draft.
   */
  draftKey?: string;
  /** New session: when the key changes to one without a draft, what is in the box moves along to it rather than being left behind. */
  carryOver?: boolean;
  /** The box opened with a kept draft (on mount, or when the key changed to one). */
  onDraftLoaded?(draft: ComposerDraft): void;
  /** It holds a draft kept from before: a slightly stronger border, until it is edited. */
  restored?: boolean;
  /** Earlier messages, newest first, that ↑ on the first line brings back. */
  history?: readonly string[];
  /** Replaces the text whenever `seq` changes (a prompt from a `switchboard://` link, or clearing it), and the images when it has `attachments` (a prompt moved over from the palette). */
  preset?: { text: string; attachments?: ImageAttachment[]; seq: number };
  cwd: string | null;
  commands: SlashCommand[];
  placeholder: string;
  /** Claude is busy: Enter queues, Esc interrupts. */
  running?: boolean;
  submitLabel?: string;
  disabledReason?: string | null;
  autoFocus?: boolean;
  /** Changing it focuses the prompt again (New session asked for while already open). */
  focusRequest?: number;
  /** Changing it sends what is in the box, as Enter would (New session's Start anyway). */
  submitRequest?: number;
  /** Compact controls in the card's bottom-left corner in place of the hint line (the model, mode and effort chips). */
  controls?: ReactNode;
  /** Buttons in the card's bottom-right corner, before attach (a session's Tools). */
  actions?: ReactNode;
  /** Right before Stop and Send: the ring that stands in for the session footer while the terminal is open below. */
  meter?: ReactNode;
  /** A shortcut shown on the submit button, like `⌘↵`. */
  submitHint?: string;
  /** A taller prompt that is the main thing on screen. */
  large?: boolean;
  /** The card's border colour in place of the theme's (New session: the picked project's). */
  frameColor?: string | null;
  /** Say next to the attach button that images can be pasted or dropped (an empty session). */
  dropHint?: boolean;
  /** Called with the prompt's text whenever it changes (typing, completions, presets, sending). */
  onTextChange?(text: string): void;
  /** Called with the images in the box whenever they change. */
  onAttachmentsChange?(attachments: ImageAttachment[]): void;
  /**
   * A second way to send what is in the box (New session's Add to queue), on its own shortcut and through
   * `submitControl`. Like `onSubmit`, returning `false` keeps the prompt; otherwise the box empties.
   */
  secondary?: { shortcut: ShortcutId; onSubmit(text: string, attachments: ImageAttachment[]): Promise<void | false> };
  /** Takes the Send button's place (New session's Start with its menu), with what it needs to send what is in the box. */
  submitControl?(api: SubmitApi): ReactNode;
  /** Returning `false` means nothing was sent (the focus limit asked and you cancelled): the prompt stays as it is. */
  onSubmit(text: string, attachments: ImageAttachment[], requested?: boolean): Promise<void | false> | void | false;
  onInterrupt?(): void;
  onCycleMode?(): void;
}

/** What `submitControl` gets from the message box. */
export interface SubmitApi {
  /** Why nothing can be sent (connecting, no folder yet). */
  blocked: string | null;
  sending: boolean;
  /** Something to send: text, images or context. */
  hasMessage: boolean;
  /** Text or context: what `secondary` needs (images go along, but can't be queued on their own). */
  hasText: boolean;
  /** Sends as Enter does. */
  submit(): void;
  /** Sends through `secondary`. */
  submitSecondary(): void;
  /** Sends through another action (New session's Start in a new worktree); returning `false` keeps the prompt. */
  submitWith(send: (text: string, attachments: ImageAttachment[]) => Promise<void | false>): void;
}

const NO_CHIPS: ContextChip[] = [];

/** Focus is in another text field, or in a menu or dialog: a late focus request must not take it away. */
function isTypingElsewhere(prompt: HTMLElement): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || active === prompt) return false;
  return active.matches('input, textarea, select, [contenteditable]') || !!active.closest('[role=menu], [role=dialog], [role=alertdialog], [role=listbox]');
}

export function Composer(props: ComposerProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [saved] = useState(() => (props.draftKey === undefined ? undefined : useDrafts.getState().drafts[props.draftKey]));
  const [text, setText] = useState(saved?.text ?? '');
  const [palette, setPalette] = useState<Palette | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const draftKey = props.draftKey;
  // The chips live in the drafts store, not here: context from the editor arrives there while the box isn't on screen.
  const chips = useDrafts((s) => (draftKey !== undefined ? s.drafts[draftKey]?.context : undefined)) ?? NO_CHIPS;
  const addContext = draftKey !== undefined ? (items: readonly ContextItem[]) => useDrafts.getState().addContext(draftKey, items) : undefined;
  const { attachments, setAttachments, addFiles, onPaste, drop } = useAttachments({ initial: saved?.attachments, rootRef, textareaRef: ref, cwd: props.cwd, disabledReason: props.disabledReason, setText, onNotice: setNotice, onContext: addContext });
  /** Bumped whenever the palette's input moves on: a file search that answers after that is dropped. */
  const searchSeq = useRef(0);
  const ids = useId();
  const history = useRef<PromptHistory | null>(null);
  history.current ??= new PromptHistory(props.history);
  /** Read out after ↑ or ↓ brings back a message (screen readers only). */
  const [announcement, setAnnouncement] = useState('');
  const closePalette = () => {
    ++searchSeq.current;
    setPalette(null);
  };

  /** The caret goes to the end of the text, once the box can take it (a kept draft, or a request from the Unsent list). */
  const caretToEnd = (focus: boolean) =>
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.disabled) return;
      if (focus) el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });

  /** A preset applied in this commit: the draft key changing with it (a link's folder) must not load that folder's draft over it. */
  const presetApplied = useRef(false);
  const presetSeq = props.preset?.seq;
  useEffect(() => {
    if (presetSeq === undefined) return;
    presetApplied.current = true;
    const value = props.preset!.text;
    setText(value);
    if (props.preset!.attachments) setAttachments(props.preset!.attachments);
    history.current!.reset();
    closePalette();
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el && !el.disabled) {
        el.focus();
        el.setSelectionRange(value.length, value.length);
      }
    });
  }, [presetSeq]);

  useEffect(() => history.current!.setEntries(props.history ?? []), [props.history]);

  const onTextChange = props.onTextChange;
  useEffect(() => onTextChange?.(text), [text, onTextChange]);
  const onAttachmentsChange = props.onAttachmentsChange;
  useEffect(() => onAttachmentsChange?.(attachments), [attachments, onAttachmentsChange]);

  const onDraftLoaded = useRef(props.onDraftLoaded);
  onDraftLoaded.current = props.onDraftLoaded;
  // Opened with a kept draft: say so, with the caret at its end.
  useEffect(() => {
    if (saved && hasContent(saved)) {
      onDraftLoaded.current?.(saved);
      caretToEnd(false);
    }
  }, []);
  const lastKey = useRef(draftKey);
  useEffect(() => {
    const store = useDrafts.getState();
    if (draftKey === lastKey.current) {
      if (draftKey !== undefined) store.setDraft(draftKey, { text, attachments });
      return;
    }
    const previous = lastKey.current;
    lastKey.current = draftKey;
    const fromPreset = presetApplied.current;
    presetApplied.current = false;
    // The preset's text is written under the new key on the next pass.
    if (fromPreset || draftKey === undefined) return;
    const target = store.drafts[draftKey];
    if (target && hasContent(target)) {
      setText(target.text);
      setAttachments(target.attachments);
      history.current!.reset();
      closePalette();
      onDraftLoaded.current?.(target);
      caretToEnd(false);
    } else if (props.carryOver && previous !== undefined && store.drafts[previous]) store.moveDraft(previous, draftKey);
    else if (!props.carryOver) {
      setText('');
      setAttachments([]);
    }
  }, [draftKey, text, attachments]);
  useEffect(() => {
    presetApplied.current = false;
  });

  // Opened from the Unsent list or ⌘P: focus, caret at the end.
  const focusRequest = useDrafts((s) => (draftKey !== undefined && s.focus?.key === draftKey ? s.focus.nonce : null));
  // A box that can't take focus yet (connecting, its folder not known yet) keeps the request until it can.
  useEffect(() => {
    if (focusRequest === null || props.disabledReason) return;
    useDrafts.getState().clearFocus();
    caretToEnd(true);
  }, [focusRequest, props.disabledReason]);

  // Mounting with autoFocus, or a new focusRequest, focuses the prompt. While the prompt is disabled
  // (engine connecting, no folder yet) the request waits, and is dropped if by then the user is typing
  // somewhere else, like the folder filter.
  const pendingFocus = useRef(!!props.autoFocus);
  const lastRequest = useRef(props.focusRequest);
  useEffect(() => {
    const el = ref.current;
    const asked = props.focusRequest !== lastRequest.current;
    lastRequest.current = props.focusRequest;
    if (asked) pendingFocus.current = true;
    if (!pendingFocus.current || !el || props.disabledReason) return;
    pendingFocus.current = false;
    if (!asked && isTypingElsewhere(el)) return;
    el.focus();
  }, [props.focusRequest, props.disabledReason]);

  const updatePalette = (value: string, caret: number) => {
    // Any edit makes an earlier file search stale, whatever this one turns out to be.
    const seq = ++searchSeq.current;
    const token = tokenAtCaret(value, caret);
    if (!token) return setPalette(null);
    if (token.kind === 'slash') {
      const q = token.query.toLowerCase();
      const items = props.commands
        .filter((c) => c.name.toLowerCase().includes(q) || (q.length > 2 && c.description.toLowerCase().includes(q)))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
        .slice(0, 60)
        .map((c) => ({ value: `/${c.name}`, label: `/${c.name}`, detail: c.argumentHint ? `${c.argumentHint} · ${c.description}` : c.description }));
      return setPalette(items.length ? { kind: 'slash', start: token.start, items, active: 0 } : null);
    }
    if (!client || !props.cwd) return setPalette(null);
    client.call('files.search', { cwd: props.cwd, query: token.query, limit: 8 }).then(
      ({ files }) => {
        if (seq !== searchSeq.current) return;
        const items = files.map((f) => ({ value: `@${f}`, label: f.slice(f.lastIndexOf('/') + 1), detail: f }));
        setPalette(items.length ? { kind: 'file', start: token.start, items, active: 0 } : null);
      },
      () => {},
    );
  };

  // The palette's Add context… and the picker add to this box while it is on screen.
  const cwd = props.cwd;
  useEffect(() => {
    if (draftKey === undefined) return;
    useComposerTargets.getState().register({ key: draftKey, cwd });
    return () => useComposerTargets.getState().unregister(draftKey);
  }, [draftKey, cwd]);
  const openPicker = () => {
    if (draftKey !== undefined && cwd && !props.disabledReason) useComposerTargets.getState().openPicker({ key: draftKey, cwd });
  };

  const choose = (item: PaletteItem) => {
    const el = ref.current;
    if (!el || !palette) return;
    const caret = el.selectionStart;
    // A file from the @ list becomes a chip; the @ and what was typed after it go.
    if (palette.kind === 'file' && addContext && cwd) {
      const next = `${text.slice(0, palette.start)}${text.slice(caret).replace(/^ /, '')}`;
      setText(next);
      closePalette();
      addContext([{ kind: 'file', path: joinPath(cwd, item.value.slice(1)), directory: false }]);
      requestAnimationFrame(() => el.setSelectionRange(palette.start, palette.start));
      return;
    }
    const next = `${text.slice(0, palette.start)}${item.value} ${text.slice(caret)}`;
    setText(next);
    closePalette();
    const position = palette.start + item.value.length + 1;
    requestAnimationFrame(() => el.setSelectionRange(position, position));
  };

  /** `requested`: sent through `submitRequest` rather than Enter or the button. `send`: the secondary action instead of `onSubmit`. */
  const submit = async (requested = false, send: (value: string, attachments: ImageAttachment[]) => Promise<void | false> | void | false = (value, sent) => props.onSubmit(value, sent, requested)) => {
    if (sending || props.disabledReason) return;
    const sentText = text;
    const sentChips = chips;
    // The chips go with the message: files as @ mentions after what you typed, text in fenced blocks.
    const value = promptWithContext(text, sentChips, cwd);
    const sentAttachments = attachments;
    if (!value && sentAttachments.length === 0) return;
    setSending(true);
    setNotice(null);
    closePalette();
    try {
      if ((await send(value, sentAttachments)) === false) return;
      if (draftKey !== undefined && sentChips.length) useDrafts.getState().removeContext(draftKey, sentChips.map((chip) => chip.id));
      // The box stays editable while sending: keep whatever was typed or attached in the meantime.
      setText((current) => textAfterSend(current, sentText));
      history.current!.reset();
      setAttachments((current) => attachmentsAfterSend(current, sentAttachments));
      closePalette();
    } catch (error) {
      // The text stays in the box, so trying again is one Enter away.
      setNotice(`Not sent: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  // Start anyway (New session) sends what is in the box from outside it.
  const lastSubmitRequest = useRef(props.submitRequest);
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (props.submitRequest === lastSubmitRequest.current) return;
    lastSubmitRequest.current = props.submitRequest;
    void submitRef.current(true);
  }, [props.submitRequest]);

  /** Puts a recalled message (or the draft) in the box, caret where it says, and reads out where you are. */
  const applyRecall = (recall: Recall) => {
    const el = ref.current;
    setText(recall.text);
    // A trailing no-break space makes a repeated message a change, so it's read out again.
    const said = recallAnnouncement(recall);
    setAnnouncement((current) => (current.replace(/\u00a0$/, '') === said ? `${said}\u00a0` : said));
    requestAnimationFrame(() => el?.setSelectionRange(recall.caret, recall.caret));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const el = event.currentTarget;
    const route = routeArrow(
      { key: event.key, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing },
      palette && { active: palette.active, count: palette.items.length },
      (direction) => (direction === 'older' ? onFirstLine : onLastLine)(el.value, el.selectionStart, el.selectionEnd, textareaRows(el)),
    );
    if (route?.kind === 'palette') {
      event.preventDefault();
      setPalette({ ...palette!, active: route.active });
      requestAnimationFrame(() => listRef.current?.children[route.active]?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    if (route?.kind === 'history') {
      const recall = history.current!.recall(route.direction, el.value, el.selectionStart);
      // At the oldest message ↑ does nothing; with no history at all it moves the caret as usual.
      if (recall || history.current!.browsing) event.preventDefault();
      if (recall) applyRecall(recall);
      return;
    }
    if (palette) {
      // ⌃⇥ moves to another session; it never picks a command.
      if (event.key === 'Enter' || (event.key === 'Tab' && !event.ctrlKey)) {
        event.preventDefault();
        choose(palette.items[palette.active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
        return;
      }
    }
    if (event.key === 'Escape' && history.current!.browsing) {
      // Browsing earlier messages, Esc puts your draft back; only after that does it stop Claude.
      const recall = history.current!.escape(el.value);
      if (recall) {
        event.preventDefault();
        applyRecall(recall);
        return;
      }
    }
    const send = submitKey(event.nativeEvent, props.secondary?.shortcut);
    if (matches(event.nativeEvent, 'composer.add-context') && addContext) {
      event.preventDefault();
      openPicker();
    } else if (send) {
      event.preventDefault();
      void (send === 'secondary' ? submitSecondary() : submit());
    } else if (matches(event.nativeEvent, 'claude.stop') && props.running) {
      // With a dialog, menu or popover open, Escape closes that; it must never also stop Claude.
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [data-context-breakdown]')) return;
      event.preventDefault();
      props.onInterrupt?.();
    } else if (matches(event.nativeEvent, 'mode.cycle') && props.onCycleMode) {
      event.preventDefault();
      props.onCycleMode();
    }
  };

  const disabled = !!props.disabledReason;
  const submitSecondary = () => (props.secondary ? submit(false, (value, sent) => props.secondary!.onSubmit(value, sent)) : Promise.resolve());
  const hasText = !!text.trim() || chips.length > 0;
  const hasMessage = hasText || attachments.length > 0;
  const attach = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        data-attach-input
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon={<ImagePlus size={15} />}
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        data-tooltip="Attach images (or paste / drop them). Dropped files and folders are added as context."
        aria-label="Attach images"
        data-attach
      />
      {addContext && (
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={<Paperclip size={14} />}
          onClick={openPicker}
          disabled={disabled || !cwd}
          shortcut="composer.add-context"
          aria-label="Add context"
          data-add-context
        />
      )}
    </>
  );

  return (
    <div ref={rootRef} className="relative" onFocusCapture={() => draftKey !== undefined && useComposerTargets.getState().register({ key: draftKey, cwd })}>
      <DropOverlay drop={drop} />
      {palette && (
        // Focus stays in the message box (aria-activedescendant points at the highlighted option), so the
        // options are plain list items rather than buttons that Tab could land on.
        <ul
          ref={listRef}
          id={`${ids}-palette`}
          className="absolute right-0 bottom-full left-0 z-10 mb-2 max-h-72 overflow-y-auto rounded-lg border overlay"
          role="listbox"
          aria-label={palette.kind === 'slash' ? 'Commands' : 'Files'}
          data-palette
        >
          {palette.items.map((item, i) => (
            <li
              key={item.value}
              id={`${ids}-option-${i}`}
              role="option"
              aria-selected={i === palette.active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              className={`flex w-full cursor-default items-baseline gap-3 px-3 py-1.5 text-left hover:bg-accent/10 ${i === palette.active ? 'bg-accent/15' : ''}`}
            >
              <span className="shrink-0 font-mono text-ui">{item.label}</span>
              <span className="min-w-0 truncate text-meta text-muted">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Disabled dims the text, not the card: the chips' menus open from inside it and must stay readable. */}
      <div
        className={`rounded-xl border bg-card px-3 pt-2.5 pb-2 shadow-sm transition-colors ${props.restored ? 'border-edge' : 'border-border'} ${disabled ? '' : 'focus-within:border-accent-ink/60'}`}
        style={props.frameColor ? { borderColor: props.frameColor } : undefined}
      >
        <ContextTray
          chips={chips}
          cwd={cwd}
          className="mb-2"
          onRemove={(id) => {
            if (draftKey !== undefined) useDrafts.getState().removeContext(draftKey, [id]);
            ref.current?.focus();
          }}
        />
        <AttachmentThumbs
          attachments={attachments}
          className="mb-2"
          onRemove={(i) => {
            setAttachments((current) => current.filter((_, j) => j !== i));
            ref.current?.focus();
          }}
        />
        {/* Grows with the content up to max-h-80, then scrolls. CSS sizes it: collapsing it to measure scrollHeight
            made the conversation above taller for a moment, and the browser clamped its scroll position. */}
        <textarea
          data-composer
          data-history={props.history?.length ?? 0}
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={props.disabledReason ?? props.placeholder}
          aria-label="Message to Claude"
          aria-describedby={`${ids}-hint`}
          aria-keyshortcuts={props.running && props.onInterrupt ? ariaKeysFor('claude.stop') : undefined}
          // While the / or @ list is open, ↑ ↓ move through it without leaving the box.
          aria-autocomplete="list"
          aria-controls={palette ? `${ids}-palette` : undefined}
          aria-activedescendant={palette ? `${ids}-option-${palette.active}` : undefined}
          spellCheck
          onChange={(e) => {
            setText(e.target.value);
            updatePalette(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            // A search still on its way must not reopen the list after focus left; the open list waits a moment so a click on it lands.
            ++searchSeq.current;
            setTimeout(() => setPalette(null), 100);
          }}
          className={`block field-sizing-content max-h-80 w-full resize-none bg-transparent leading-relaxed text-text outline-none placeholder:text-faint disabled:opacity-60 ${props.large ? 'min-h-24 px-1 pt-1 text-title font-normal' : 'text-body'}`}
        />
        {props.controls && notice && (
          <p role="alert" className="mt-1 truncate text-meta text-error" data-tooltip={notice}>
            {notice}
          </p>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="sr-only" role="status" aria-live="polite" data-history-announcer>
            {announcement}
          </span>
          {props.controls ? (
            <div className="-ml-1.5 flex min-w-0 flex-1 items-center">
              {/* What goes into the message comes first; a thin line, then the chips that set how it runs. */}
              <div className="flex shrink-0 items-center gap-0.5">{attach}</div>
              <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-border" />
              {props.controls}
              {/* The keys still get read out with the message box; the chips take the hint's place on screen. */}
              <span id={`${ids}-hint`} className="sr-only">
                {props.running ? `Esc stops Claude.${props.secondary ? ` ${formatKeys(keysFor(props.secondary.shortcut))} sends now.` : ''}` : `/ for commands, @ for files${props.onCycleMode ? ', ⇧Tab to change mode' : ''}.`}
              </span>
            </div>
          ) : (
            <span id={`${ids}-hint`} className="min-w-0 truncate text-meta text-muted">
              {notice ? (
                <span role="alert" className="text-error" data-tooltip={notice}>
                  {notice}
                </span>
              ) : props.running ? (
                `Esc to stop Claude · messages wait for Claude to finish${props.secondary ? ` · ${formatKeys(keysFor(props.secondary.shortcut))} sends now` : ''}`
              ) : (
                `/ for commands · @ for files${props.onCycleMode ? ` · ${localizeKeys('⇧Tab')} to change mode` : ''}`
              )}
            </span>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {props.dropHint && !text && attachments.length === 0 && !disabled && <span className="text-meta text-muted @max-[860px]:hidden">Paste or drop images and files</span>}
            {props.actions}
            {/* Without chips the hint line holds the left; the attach buttons stay on the right. */}
            {!props.controls && attach}
            {props.meter}
            {props.running && props.onInterrupt && (
              <Button size="lg" icon={<span className="size-2 rounded-[2px] bg-current" aria-hidden />} shortcut="claude.stop" kbdHideNarrow onClick={props.onInterrupt} data-tooltip={`Stop Claude (${formatKeys(keysFor('claude.stop'))})`} data-composer-stop>
                Stop
              </Button>
            )}
            {props.submitControl ? (
              props.submitControl({
                blocked: props.disabledReason ?? null,
                sending,
                hasMessage,
                hasText,
                submit: () => void submit(),
                submitSecondary: () => void submitSecondary(),
                submitWith: (send) => void submit(false, send),
              })
            ) : (
              // A disabled button gets no hover, so the reason it's unavailable sits on this wrapper.
              <span className="flex" data-tooltip={!sending ? (props.disabledReason ?? (!hasMessage ? 'Type a message first' : undefined)) : undefined}>
                <Button
                  variant="primary"
                  size="lg"
                  kbd={props.submitHint && !sending ? props.submitHint : undefined}
                  data-composer-submit
                  onClick={() => void submit()}
                  disabled={disabled || sending || !hasMessage}
                  className="disabled:pointer-events-none"
                >
                  {sending ? 'Sending…' : (props.submitLabel ?? (props.running ? 'Queue' : 'Send'))}
                </Button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
