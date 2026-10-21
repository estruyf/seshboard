import { BookmarkPlus, BookOpen, Brain, Check, ClipboardType, Copy, GitFork, Pencil, Undo2 } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { ariaKeysFor, keysFor, shortcutGlyphs } from '../../lib/shortcuts.ts';
import { Button } from '../ui/Button.tsx';
import { useFlash } from '../ui/useFlash.ts';

/** What you can do with a message in the transcript; provided by the session view. */
export interface MessageActions {
  /** A new session with the conversation up to and including this message. */
  fork(messageUuid: string): void;
  /** A new session up to just before this prompt, with the prompt in the message box to change. */
  edit(messageUuid: string, text: string): void;
  /** Undo the file changes Claude made since this prompt. */
  rewind(messageUuid: string): void;
  /** Whether this prompt has a message before it (the first one can't be edited by forking). */
  canEdit(messageUuid: string): boolean;
  /** Types a code block's command into the session's terminal; null when the session has no folder. */
  runCommand: ((command: string) => void) | null;
  /** Runs a code block's command in a tab of its own and sends its output to Claude when it ends; null without a folder. */
  runAndSend: ((command: string) => void) | null;
  /** Remember this…: the text as a memory (yours, or Claude's), in a dialog first. */
  remember(text: string, from: 'user' | 'claude'): void;
  /** Save as prompt…: a message you sent, in the saved prompt editor, its links, branches and paths offered as blanks. */
  savePrompt?(text: string): void;
  /** Reading mode for the turn's reply. */
  read?(turnKey: string): void;
  /** The replies that can be read, by the key of the turn's last reply: the turn they belong to and a word count. */
  readable?: ReadonlyMap<string, ReadableReply>;
}

/** A turn's last reply, as the Read button needs it. */
export interface ReadableReply {
  turnKey: string;
  /** Roughly, over the turn's text: enough to tell a long reply from a short one. */
  words: number;
}

/** From this many words a reply shows its Read button all the time, not only with the row. */
export const LONG_REPLY_WORDS = 400;

export const MessageActionsContext = createContext<MessageActions | null>(null);

/** The message's uuid: item keys are `<uuid>` or `<uuid>:<block>`. */
export const messageUuid = (key: string) => key.split(':')[0]!;

function Action({ title, onClick, children }: { title: string; onClick(): void; children: ReactNode }) {
  return (
    <Button variant="quiet" size="sm" iconOnly icon={children} aria-label={title} onClick={onClick} />
  );
}

/** Copies the message as it was written (Markdown for Claude's replies), then shows a check for a moment. */
function CopyAction({ text, label }: { text: string; label: string }) {
  const [copied, flash] = useFlash(1_500);
  return (
    <Action title={copied ? 'Copied' : label} onClick={() => void navigator.clipboard.writeText(text).then(() => flash('Copied'), () => {})}>
      {copied ? <Check size={13} className="text-ok" /> : <Copy size={12} />}
    </Action>
  );
}

/**
 * Copies Claude's reply formatted, for an app that doesn't read Markdown (email, Docs, Slack, Word): the rendered
 * reply as HTML, and the Markdown as plain text for a field that takes only text. The renderer loads on the first
 * copy; the clipboard gets it as a promise, so the write still counts as part of the click.
 */
function RichCopyAction({ text }: { text: string }) {
  const [copied, flash] = useFlash(1_500);
  const copy = () => {
    const html = import('./richText.tsx').then(({ replyHtml }) => new Blob([replyHtml(text)], { type: 'text/html' }));
    const item = new ClipboardItem({ 'text/html': html, 'text/plain': new Blob([text], { type: 'text/plain' }) });
    void navigator.clipboard.write([item]).then(() => flash('Copied'), () => {});
  };
  return (
    <Action title={copied ? 'Copied' : 'Copy as rich text'} onClick={copy}>
      {copied ? <Check size={13} className="text-ok" /> : <ClipboardType size={13} />}
    </Action>
  );
}

/**
 * How a message's actions show: invisible rather than removed, so Tab still reaches them and nothing jumps, until the
 * message (`group/message`) is hovered or one of them has focus.
 */
const REVEAL = 'pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100';

/**
 * The same for the row under a reply (`group/reply-row`: the actions, then the turn's line), so its parts show together:
 * while the reply is hovered, while anything in the row has keyboard focus (not a click's, which stays on the button after reading mode closes), and while the tokens' tooltip is open (it sits
 * outside the reply, so the pointer can rest on it).
 */
export const REVEAL_IN_REPLY_ROW =
  'pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-has-[:focus-visible]/reply-row:pointer-events-auto group-has-[:focus-visible]/reply-row:opacity-100 group-has-[[data-turn-tokens][aria-expanded=true]]/reply-row:pointer-events-auto group-has-[[data-turn-tokens][aria-expanded=true]]/reply-row:opacity-100';

/**
 * Small toolbar that appears when you hover a message. It's invisible rather than removed the
 * rest of the time, so Tab still reaches its buttons and it shows up while one has focus.
 * On your prompt cards it floats over the card's top edge; under Claude's replies it's a row of
 * its own below the text, with its height kept, so it never covers the reply or makes it jump.
 * Copy is always there (and Copy as rich text on Claude's replies); fork, edit and rewind need the session view
 * and a top-level message.
 */
export function MessageToolbar({ itemKey, kind, text, copyOnly = false }: { itemKey: string; kind: 'user' | 'command' | 'text'; text: string; copyOnly?: boolean }) {
  const context = useContext(MessageActionsContext);
  const actions = copyOnly ? null : context;
  const uuid = messageUuid(itemKey);
  // Under a reply it sits in the reply's row, with the turn's line after it, and shows with it.
  const placement = kind === 'text' ? `h-6 shrink-0 ${REVEAL_IN_REPLY_ROW}` : `absolute -top-3 right-2 z-10 rounded-md border border-border bg-card px-0.5 shadow-sm ${REVEAL}`;
  return (
    <div
      role="toolbar"
      aria-label={kind === 'text' ? 'Actions for Claude’s message' : 'Actions for your message'}
      className={`flex items-center gap-0.5 ${placement}`}
      data-message-actions
    >
      {actions && kind === 'user' && (
        <>
          <Action title="Undo file changes since this message" onClick={() => actions.rewind(uuid)}>
            <Undo2 size={13} />
          </Action>
          {actions.canEdit(uuid) && (
            <Action title="Edit and resend (in a new session)" onClick={() => actions.edit(uuid, text)}>
              <Pencil size={12} />
            </Action>
          )}
        </>
      )}
      {actions && kind === 'text' && (
        <Action title="Fork from here (a new session with the conversation up to this message)" onClick={() => actions.fork(uuid)}>
          <GitFork size={13} />
        </Action>
      )}
      {context && kind !== 'command' && text && (
        <Button variant="quiet" size="sm" iconOnly icon={<Brain size={13} />} aria-label="Remember this…" onClick={() => context.remember(text, kind === 'user' ? 'user' : 'claude')} data-remember-message />
      )}
      {context?.savePrompt && kind === 'user' && text && (
        <Button variant="quiet" size="sm" iconOnly icon={<BookmarkPlus size={13} />} aria-label="Save as prompt…" onClick={() => context.savePrompt!(text)} data-save-as-prompt />
      )}
      {text && <CopyAction text={text} label={kind === 'text' ? 'Copy as Markdown' : 'Copy message'} />}
      {text && kind === 'text' && <RichCopyAction text={text} />}
    </div>
  );
}

/**
 * Read: opens the turn's last reply in reading mode. Only the last reply of a turn that can be read has it (the
 * session view says which, `readable`). A long reply shows it all the time, since that is when it is wanted; a short
 * one shows with the row.
 */
export function ReadButton({ itemKey }: { itemKey: string }) {
  const actions = useContext(MessageActionsContext);
  const reply = actions?.readable?.get(itemKey);
  if (!actions?.read || !reply) return null;
  return (
    <Button
      variant="quiet"
      size="sm"
      icon={<BookOpen size={13} />}
      aria-keyshortcuts={ariaKeysFor('read.toggle')}
      data-tooltip={`Read this reply (${shortcutGlyphs(keysFor('read.toggle'))})`}
      className={`h-6 shrink-0 ${reply.words >= LONG_REPLY_WORDS ? '' : REVEAL_IN_REPLY_ROW}`}
      onClick={() => actions.read!(reply.turnKey)}
      data-read-button
      data-turn-key={reply.turnKey}
    >
      Read
    </Button>
  );
}
