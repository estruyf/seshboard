import { parseRunBriefs } from '@seshboard/protocol/client';
import type { DisplayItem } from '../transcript/displayItems.ts';
import { matches } from '../../lib/shortcuts.ts';

/** `older` is ↑ (further back), `newer` is ↓ (towards your draft). */
export type HistoryDirection = 'older' | 'newer';

/** What to put in the message box after a step through the history. */
export interface Recall {
  text: string;
  caret: number;
  /** The message shown, 0 for the newest; -1 when it's your draft again. */
  index: number;
  total: number;
}

/**
 * Prompt history for the message box, like Claude Code's: ↑ brings back earlier messages, ↓ goes
 * forward again, and past the newest one your draft comes back as you left it. A recalled message
 * that you edit is your text from then on: browsing on keeps it as the draft.
 */
export class PromptHistory {
  private entries: readonly string[];
  /** The message shown; -1 while the box holds your own text. */
  private index = -1;
  private draft = '';
  private draftCaret = 0;
  /** The text last put in the box, to tell whether you edited it since. */
  private shown = '';

  /** `entries` newest first. */
  constructor(entries: readonly string[] = []) {
    this.entries = entries;
  }

  get browsing(): boolean {
    return this.index >= 0;
  }

  /** New messages (one landed in the transcript): browsing stays on the message it shows, wherever that moved. */
  setEntries(entries: readonly string[]): void {
    if (this.browsing) {
      const at = entries.indexOf(this.entries[this.index]!);
      this.index = at !== -1 ? at : Math.min(this.index, entries.length - 1);
    }
    this.entries = entries;
  }

  /** One step older or newer, from the box's current `text` and `caret`. Null when there is nowhere to go. */
  recall(direction: HistoryDirection, text: string, caret: number): Recall | null {
    if (!this.browsing) {
      if (direction === 'newer' || this.entries.length === 0) return null;
      this.draft = text;
      this.draftCaret = caret;
      return this.show(0);
    }
    if (text !== this.shown) {
      this.draft = text;
      this.draftCaret = caret;
    }
    if (direction === 'older') return this.index + 1 < this.entries.length ? this.show(this.index + 1) : null;
    if (this.index > 0) return this.show(this.index - 1);
    return this.backToDraft();
  }

  /**
   * Where the caret goes before a step, as in any text field: in your own text ↑ takes it to the start
   * of the box first and ↓ to the end, and only the next press steps. A recalled message you haven't
   * edited steps at once. Null: step now.
   */
  caretFirst(direction: HistoryDirection, text: string, caret: number): number | null {
    if (this.browsing && text === this.shown) return null;
    const edge = direction === 'older' ? 0 : text.length;
    return caret === edge ? null : edge;
  }

  /**
   * Esc while browsing: your draft comes back. Null when not browsing, or when you edited the recalled
   * message (it's your text now): Esc then keeps its usual meaning.
   */
  escape(text: string): Recall | null {
    if (!this.browsing) return null;
    if (text !== this.shown) {
      this.index = -1;
      return null;
    }
    return this.backToDraft();
  }

  /** The box was emptied or filled from elsewhere (sent, a link's prompt): start over. */
  reset(): void {
    this.index = -1;
    this.draft = '';
    this.draftCaret = 0;
    this.shown = '';
  }

  private show(index: number): Recall {
    this.index = index;
    const text = this.entries[index]!;
    this.shown = text;
    return { text, caret: text.length, index, total: this.entries.length };
  }

  private backToDraft(): Recall {
    this.index = -1;
    return { text: this.draft, caret: Math.min(this.draftCaret, this.draft.length), index: -1, total: this.entries.length };
  }
}

/** What a screen reader hears after a step: "Earlier message 2 of 14", or that the draft is back. */
export function recallAnnouncement(recall: Recall): string {
  return recall.index === -1 ? 'Back to your draft' : `Earlier message ${recall.index + 1} of ${recall.total}`;
}

/** Drops an entry that is the same as the one just before it. */
function withoutRepeats(entries: string[]): string[] {
  return entries.filter((entry, i) => i === 0 || entry !== entries[i - 1]);
}

/**
 * Your messages in a session, newest first: typed prompts and slash commands as you sent them.
 * Tool results, permission answers, agent reports and notices are other kinds of items; a message
 * with only images has no text to bring back.
 */
export function sessionHistory(items: readonly DisplayItem[]): string[] {
  const entries: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    // A pipeline run's brief went with a message to its parent: ↑ brings back what you typed (sending links the run again).
    const text = item.kind === 'user' && !item.subagent ? parseRunBriefs(item.text).text : item.kind === 'command' ? (item.args ? `${item.name} ${item.args}` : item.name) : '';
    if (text.trim()) entries.push(text);
  }
  return withoutRepeats(entries);
}

/** The parts of a key press that decide where ↑ and ↓ go. */
export interface ArrowKey {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}

export type ArrowRoute = { kind: 'palette'; active: number } | { kind: 'history'; direction: HistoryDirection } | null;

/**
 * Where ↑ or ↓ goes in the message box. The / and @ list comes first and keeps the keys while it's open;
 * then the history, only with no modifier held and the caret at the edge `atEdge` checks (first line
 * for ↑, last line for ↓, nothing selected). Null: the key does what it does in any text field.
 */
export function routeArrow(event: ArrowKey, palette: { active: number; count: number } | null, atEdge: (direction: HistoryDirection) => boolean): ArrowRoute {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return null;
  if (event.isComposing) return null;
  if (palette && palette.count > 0) {
    const step = event.key === 'ArrowDown' ? 1 : -1;
    return { kind: 'palette', active: (palette.active + step + palette.count) % palette.count };
  }
  if (!matches(event, 'composer.history')) return null;
  const direction = event.key === 'ArrowUp' ? 'older' : 'newer';
  return atEdge(direction) ? { kind: 'history', direction } : null;
}
