import { X } from 'lucide-react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Button } from './Button.tsx';

export type NoticeTone = 'neutral' | 'info' | 'accent' | 'caution' | 'warn' | 'error' | 'success';

// Tinted, never outlined (a card holds a decision or input; a notice only says something). The tints work on the
// app's background, the sidebar, cards and dialogs alike. High contrast drops tints, so there the border comes back.
const BOX: Record<NoticeTone, string> = {
  // A neutral grey from the text colour, so the quiet box shows on white dialogs as well as on the app's background.
  neutral: 'bg-text/6 text-muted',
  // Something worth reading that you didn't ask about: tinted, so it stands out on a card too.
  info: 'bg-link/10 text-text',
  // A limit reached (the focus limit in New session): the yellow tint, not a warning.
  accent: 'bg-accent/15 text-text',
  // Something outside Seshboard stops a feature (notifications turned off in the system's settings).
  caution: 'bg-caution/10 text-text',
  warn: 'bg-warn/10 text-text',
  error: 'bg-error/10 text-error',
  success: 'bg-ok/10 text-text',
};
const ICON: Record<NoticeTone, string> = { neutral: 'text-muted', info: 'text-link', accent: 'text-accent-ink', caution: 'text-caution', warn: 'text-warn', error: 'text-error', success: 'text-ok' };

interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  /**
   * `neutral` (the default) for a quiet note or an empty state; `info` for something worth reading you
   * didn't ask about; `accent` for a limit you reached (the focus limit); `caution` for something turned off
   * outside Seshboard that stops a feature; `warn` for something that needs you.
   */
  tone?: NoticeTone;
  /** Before the message, in the tone's colour (a class on the icon itself wins). */
  icon?: ReactNode;
  /** What you can do about it: Buttons, `size="sm"`, quiet or secondary. */
  actions?: ReactNode;
  /** Shows a close button ("Dismiss"). */
  onDismiss?(): void;
  /** No box: one truncated line inside a status row (under the message box on New session). */
  inline?: boolean;
  /** Defaults to `alert` for errors (read out at once) and `status` otherwise. */
  role?: 'alert' | 'status' | 'note';
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * A message about what is going on: a failed action, a session open elsewhere, a prompt that came
 * from a link. Wraps onto more lines as needed; `inline` keeps it to one line without a box.
 */
export function Notice({ tone = 'neutral', icon, actions, onDismiss, inline = false, role, className = '', children, ...rest }: NoticeProps) {
  const dismiss = onDismiss && <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} onClick={onDismiss} aria-label="Dismiss" className="shrink-0" />;
  if (inline) {
    return (
      <div role={role ?? (tone === 'error' ? 'alert' : 'status')} className={`flex min-w-0 items-center gap-1.5 ${tone === 'neutral' ? '' : ICON[tone]} ${className}`} {...rest}>
        {icon && <span className={`flex shrink-0 ${ICON[tone]}`}>{icon}</span>}
        <span className="min-w-0 truncate select-text">{children}</span>
        {actions}
        {dismiss}
      </div>
    );
  }
  return (
    <div role={role ?? (tone === 'error' ? 'alert' : 'status')} className={`flex flex-wrap items-start gap-x-2 gap-y-1.5 rounded-lg px-3 py-2 text-ui forced-colors:border ${BOX[tone]} ${className}`} {...rest}>
      {icon && <span className={`flex shrink-0 pt-0.5 ${ICON[tone]}`}>{icon}</span>}
      <div className="min-w-0 flex-1 break-words select-text">{children}</div>
      {(actions || dismiss) && (
        // Buttons are taller than a line of text; the negative margin keeps a one-line notice compact.
        <div className="-my-1 flex shrink-0 items-center gap-1.5">
          {actions}
          {dismiss}
        </div>
      )}
    </div>
  );
}
