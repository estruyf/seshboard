import { Brain, Check, Copy, GitFork, Pencil, Undo2 } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
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
  /** Remember this…: the text as a memory (yours, or Claude's), in a dialog first. */
  remember(text: string, from: 'user' | 'claude'): void;
}

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
 * Small toolbar that appears when you hover a message. It's invisible rather than removed the
 * rest of the time, so Tab still reaches its buttons and it shows up while one has focus.
 * On your prompt cards it floats over the card's top edge; under Claude's replies it's a row of
 * its own below the text, with its height kept, so it never covers the reply or makes it jump.
 * Copy is always there; fork, edit and rewind need the session view and a top-level message.
 */
export function MessageToolbar({ itemKey, kind, text, copyOnly = false }: { itemKey: string; kind: 'user' | 'command' | 'text'; text: string; copyOnly?: boolean }) {
  const context = useContext(MessageActionsContext);
  const actions = copyOnly ? null : context;
  const uuid = messageUuid(itemKey);
  const placement = kind === 'text' ? '-ml-1 mt-1 h-6' : 'absolute -top-3 right-2 z-10 rounded-md border border-border bg-card px-0.5 shadow-sm';
  return (
    <div
      role="toolbar"
      aria-label={kind === 'text' ? 'Actions for Claude’s message' : 'Actions for your message'}
      className={`pointer-events-none flex items-center gap-0.5 opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 ${placement}`}
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
      {text && <CopyAction text={text} label={kind === 'text' ? 'Copy as Markdown' : 'Copy message'} />}
    </div>
  );
}
