import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { CompanionStatus } from '@switchboard/protocol/remote-client';

/**
 * The few building blocks the remote app needs, after the desktop's design system (AGENTS.md): one yellow primary
 * action, bordered secondary buttons, quiet icon buttons, and status colours that mean one thing each. Touch targets
 * are 44px on a phone and the desktop's sizes with a mouse.
 */

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
type Size = 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent font-semibold enabled:hover:brightness-95 enabled:active:brightness-90',
  secondary: 'border border-edge bg-card text-text enabled:hover:bg-border/45 enabled:active:bg-selected',
  quiet: 'text-muted enabled:hover:bg-border/50 enabled:hover:text-text enabled:active:bg-selected',
  danger: 'border border-error/60 text-error enabled:hover:bg-error/10 enabled:active:bg-error/15',
};

const SIZES: Record<Size, string> = {
  md: 'min-h-11 px-4 pointer-fine:min-h-7 pointer-fine:px-2.5',
  lg: 'min-h-11 px-4 pointer-fine:min-h-8 pointer-fine:px-3.5',
};

export function Button({ variant = 'secondary', size = 'lg', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-ui transition-colors disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    />
  );
}

/** The small capitals over a group of rows, in the group's colour, with its count (the sidebar's SectionHeader). */
export function SectionHeader({ id, label, count, tone = 'text-faint' }: { id?: string; label: string; count?: number; tone?: string }) {
  return (
    <h2 id={id} className={`flex items-center gap-1.5 px-4 pt-4 pb-1 text-meta font-semibold tracking-wide uppercase ${tone}`}>
      {label}
      {count !== undefined && <span className="font-normal text-faint tabular-nums">{count}</span>}
    </h2>
  );
}

/** A full-screen message: welcome, a broken link, a refused device. */
export function Message({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 px-6">
      <Logo />
      <h1 className="text-hero font-semibold">{title}</h1>
      <p className="text-body text-muted">{children}</p>
      {actions && <div className="flex flex-col gap-2 sm:flex-row">{actions}</div>}
    </main>
  );
}

export function Logo({ className = 'size-10' }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className={className} />;
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

/** The 3px rail on a row: needs you, working and unread only, as in the sidebar. */
export const STATUS_RAIL: Record<CompanionStatus, string> = {
  'needs-you': 'border-warn',
  working: 'border-accent-ink',
  background: 'border-transparent',
  error: 'border-transparent',
  unread: 'border-unread',
  idle: 'border-transparent',
  stopped: 'border-transparent',
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
  return <span role="img" aria-label={STATUS_LABEL[status]} className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />;
}
