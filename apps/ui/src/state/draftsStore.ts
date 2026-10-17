import { create } from 'zustand';
import type { ContextItem, ImageAttachment } from '@switchboard/protocol/client';
import { addChips, contextFromPrompt } from '../components/composer/contextItems.ts';
import { DRAFT_SETTLE_MS, isCountingDraft, nextDraft, settleFirstPrompts, type Draft, type DraftForm, type FirstPrompt, type SessionsSeen } from './drafts.ts';

export type ComposerDraft = Draft<ImageAttachment>;

/** Sessions about to be archived while one of them holds an unsent message: the dialog asks first. */
export interface ArchivePrompt {
  titles: string[];
  ids: string[];
  archive(): void;
}

interface DraftsState {
  /** By session id, or `new:<project folder>` for New session (see `newDraftKey`). */
  drafts: Record<string, ComposerDraft>;
  /** New sessions' first prompts by session id, out of sight until the session has a transcript or fails. */
  firstPrompts: Record<string, FirstPrompt<ImageAttachment>>;
  /** The saved drafts have been read (or there were none to read). */
  loaded: boolean;
  /** A message box should take focus with the caret at the end of its text (opened from the Unsent list or ⌘P). */
  focus: { key: string; nonce: number } | null;
  /** Text to quote at the end of a message box, which then takes focus (Quote in reply from the conversation). */
  quote: { key: string; text: string; nonce: number } | null;
  /** The Unsent messages popover: where it opens (its bottom-left corner when `above`). */
  list: { x: number; y: number; above: boolean } | null;
  archivePrompt: ArchivePrompt | null;
  /** The message box changed: keeps it (or forgets an empty one). */
  setDraft(key: string, draft: { text: string; attachments: ImageAttachment[] }): void;
  /** Adds context chips to a box (from the editor, a drop, the Add context picker); one that is there already isn't added again. */
  addContext(key: string, items: readonly ContextItem[]): void;
  /** Removes chips by id (the × on a chip, or the ones that were just sent). */
  removeContext(key: string, ids: readonly string[]): void;
  /** Replaces the text of a text chip (a pasted text, edited); empty text removes the chip. */
  editContextText(key: string, id: string, text: string): void;
  /** Puts text in a box for you (Edit and resend): it shows no "kept for you" line. */
  seedDraft(key: string, text: string): void;
  /** New session's choices for the prompt under `key`, kept with it while there is one. */
  setForm(key: string, form: DraftForm): void;
  removeDraft(key: string): void;
  removeDrafts(keys: readonly string[]): void;
  /** A New session prompt follows the project it moves to. */
  moveDraft(from: string, to: string): void;
  /** Keeps a new session's first prompt (as sent: its `@` mentions become chips again) until the session has a transcript. */
  keepFirstPrompt(sessionId: string, start: { cwd: string; prompt: string; attachments: ImageAttachment[]; form: DraftForm }): void;
  /** Moves first prompts on as sessions start, fail or turn out gone (`settleFirstPrompts`). */
  settleFirstPrompts(seen: SessionsSeen): void;
  /** Drafts read back after a restart; anything typed meanwhile wins. */
  load(drafts: Record<string, ComposerDraft>, firstPrompts?: Record<string, FirstPrompt<ImageAttachment>>): void;
  /** Drafts that changed in another window, by key (`null`: gone). That window settles them; this one takes them as they are. */
  applyRelayed(change: Record<string, ComposerDraft | null>): void;
  requestFocus(key: string): void;
  clearFocus(): void;
  requestQuote(key: string, text: string): void;
  clearQuote(): void;
  openList(at: { x: number; y: number; above: boolean }): void;
  closeList(): void;
  /** Archives right away, or first asks when one of the sessions holds an unsent message. */
  requestArchive(prompt: ArchivePrompt, needsAsking: boolean): void;
  closeArchivePrompt(): void;
}

/** One timer per draft: when it fires and the draft hasn't changed since, it counts. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const cancelTimer = (key: string) => {
  clearTimeout(timers.get(key));
  timers.delete(key);
};
let focusRequests = 0;

const without = (drafts: Record<string, ComposerDraft>, keys: readonly string[]) => {
  const next = { ...drafts };
  for (const key of keys) {
    cancelTimer(key);
    delete next[key];
  }
  return next;
};

export const useDrafts = create<DraftsState>()((set, get) => {
  const settleLater = (key: string, draft: ComposerDraft) => {
    cancelTimer(key);
    if (draft.counted) return;
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        const current = get().drafts[key];
        if (current === draft && isCountingDraft(current, Date.now())) set((s) => ({ drafts: { ...s.drafts, [key]: { ...current, counted: true } } }));
      }, DRAFT_SETTLE_MS),
    );
  };

  /** The draft under `key` with these chips (forgotten when nothing is left in it). */
  const writeContext = (key: string, previous: ComposerDraft | undefined, context: ComposerDraft['context'] & object) => {
    const next = nextDraft(previous, { text: previous?.text ?? '', attachments: previous?.attachments ?? [], context }, Date.now());
    if (next === previous) return;
    // Chips sent from the editor into an empty box are put there for you: no "kept for you" line when it opens.
    const draft = next && (!previous || previous.seeded) ? { ...next, seeded: true } : next;
    if (!draft) {
      set((s) => ({ drafts: without(s.drafts, [key]) }));
      return;
    }
    set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
    settleLater(key, draft);
  };

  return {
    drafts: {},
    firstPrompts: {},
    loaded: false,
    focus: null,
    quote: null,
    list: null,
    archivePrompt: null,
    setDraft: (key, value) => {
      const previous = get().drafts[key];
      const draft = nextDraft(previous, value, Date.now());
      if (draft === previous) return;
      if (!draft) {
        if (previous) set((s) => ({ drafts: without(s.drafts, [key]) }));
        return;
      }
      set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
      settleLater(key, draft);
    },
    addContext: (key, items) => {
      const previous = get().drafts[key];
      const context = addChips(previous?.context ?? [], items);
      writeContext(key, previous, context);
    },
    removeContext: (key, ids) => {
      const previous = get().drafts[key];
      if (!previous?.context?.some((chip) => ids.includes(chip.id))) return;
      writeContext(
        key,
        previous,
        previous.context.filter((chip) => !ids.includes(chip.id)),
      );
    },
    editContextText: (key, id, text) => {
      const previous = get().drafts[key];
      const chip = previous?.context?.find((c) => c.id === id);
      if (!previous?.context || !chip || chip.kind !== 'text' || chip.text === text) return;
      if (!text.trim()) return get().removeContext(key, [id]);
      writeContext(
        key,
        previous,
        previous.context.map((c) => (c.id === id ? { ...chip, text } : c)),
      );
    },
    seedDraft: (key, text) => {
      const draft: ComposerDraft = { text, attachments: [], updatedAt: Date.now(), counted: false, lostImages: 0, seeded: true };
      set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
      settleLater(key, draft);
    },
    setForm: (key, form) => {
      const draft = get().drafts[key];
      if (!draft || JSON.stringify(draft.form) === JSON.stringify(form)) return;
      // Same draft otherwise: a timer waiting on it still recognises it.
      const next = { ...draft, form };
      set((s) => ({ drafts: { ...s.drafts, [key]: next } }));
      if (!next.counted) settleLater(key, next);
    },
    removeDraft: (key) => get().removeDrafts([key]),
    removeDrafts: (keys) => {
      if (keys.some((key) => key in get().drafts)) set((s) => ({ drafts: without(s.drafts, keys) }));
    },
    moveDraft: (from, to) => {
      const draft = get().drafts[from];
      if (!draft || from === to) return;
      // The choices were the old project's; the new one starts from its own.
      const moved: ComposerDraft = { ...draft, form: undefined };
      set((s) => ({ drafts: { ...without(s.drafts, [from]), [to]: moved } }));
      settleLater(to, moved);
    },
    keepFirstPrompt: (sessionId, { cwd, prompt, attachments, form }) => {
      const { text, context } = contextFromPrompt(prompt, cwd);
      const chips = addChips([], context);
      const draft = { text, attachments, updatedAt: Date.now(), counted: true, lostImages: 0, form, startIn: cwd, ...(chips.length ? { context: chips } : {}) };
      set((s) => ({ firstPrompts: { ...s.firstPrompts, [sessionId]: { draft, restored: false } } }));
    },
    settleFirstPrompts: (seen) => {
      const { drafts, firstPrompts, loaded } = get();
      if (!loaded) return;
      const next = settleFirstPrompts(drafts, firstPrompts, seen);
      if (next) set(next);
    },
    load: (drafts, firstPrompts = {}) => set((s) => ({ drafts: { ...drafts, ...s.drafts }, firstPrompts: { ...firstPrompts, ...s.firstPrompts }, loaded: true })),
    applyRelayed: (change) => {
      const keys = Object.keys(change);
      if (keys.length === 0) return;
      set((s) => {
        const drafts = without(s.drafts, keys);
        for (const key of keys) {
          const draft = change[key];
          if (draft) drafts[key] = draft;
        }
        return { drafts };
      });
    },
    requestFocus: (key) => set({ focus: { key, nonce: ++focusRequests } }),
    clearFocus: () => set({ focus: null }),
    requestQuote: (key, text) => set({ quote: { key, text, nonce: ++focusRequests } }),
    clearQuote: () => set({ quote: null }),
    openList: (list) => set({ list }),
    closeList: () => set({ list: null }),
    requestArchive: (prompt, needsAsking) => (needsAsking ? set({ archivePrompt: prompt }) : prompt.archive()),
    closeArchivePrompt: () => set({ archivePrompt: null }),
  };
});
