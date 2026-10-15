import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { CompanionStatus } from '@switchboard/protocol/remote-client';

/**
 * The few building blocks the phone needs, after the desktop's design system (AGENTS.md): one yellow primary action,
 * bordered secondary buttons, quiet icon buttons, and status colours that mean one thing each.
 */

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent font-semibold',
  secondary: 'border border-edge bg-card text-text',
  quiet: 'text-muted active:bg-selected',
  danger: 'border border-error/60 text-error',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-ui disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}

/** A full-screen message: welcome, a broken link, a refused phone. */
export function Message({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 px-6">
      <Logo />
      <h1 className="text-hero font-semibold">{title}</h1>
      <p className="text-body text-muted">{children}</p>
      {actions && <div className="flex flex-col gap-2">{actions}</div>}
    </main>
  );
}

export function Logo() {
  return <img src="/favicon.svg" alt="" className="size-10" />;
}

/** The status colours of the sidebar (AGENTS.md, Status colours). */
export const STATUS_DOT: Record<CompanionStatus, string> = {
  'needs-you': 'bg-warn pulse-dot',
  working: 'bg-accent-ink',
  background: 'bg-ok',
  error: 'bg-error',
  unread: 'bg-unread',
  idle: 'bg-faint',
  stopped: 'bg-faint/50',
};

export const STATUS_LABEL: Record<CompanionStatus, string> = {
  'needs-you': 'Needs you',
  working: 'Working',
  background: 'Running in the background',
  error: 'Failed',
  unread: 'Finished',
  idle: 'Idle',
  stopped: 'Stopped',
};

export function StatusDot({ status }: { status: CompanionStatus }) {
  return <span aria-label={STATUS_LABEL[status]} className={`inline-block size-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />;
}

/** How long ago, in a few characters (`5m`, `2h`, `3d`). */
export function age(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
