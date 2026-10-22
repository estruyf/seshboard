import type { ComponentProps, ReactNode } from 'react';
import { Monitor } from 'lucide-react';
import type { CompanionStatus, RemoteSessionProfile } from '@switchboard/protocol/remote-client';
import { keys } from '../lib/platform.ts';

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

export function Button({ variant = 'secondary', size = 'lg', className = '', ...props }: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-ui transition-colors disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    />
  );
}

/**
 * The round icon buttons of a phone's headers (the menu, search, `⋯`, Back, the drawer's ×): a 42px circle with a
 * border, in a 44px target; the desktop's 32px with a mouse. Children go in the circle, and `badge` over its corner.
 */
export function RoundButton({ className = '', children, badge, size = 'md', ...props }: ComponentProps<'button'> & { badge?: ReactNode; /** `sm`: a 36px circle, inside a box (the message box's +). */ size?: 'md' | 'sm' }) {
  return (
    <button type="button" {...props} className={`group relative inline-flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50 pointer-fine:size-9 ${className}`}>
      <span className={`flex items-center justify-center rounded-full border border-border bg-card text-text transition-colors group-enabled:group-hover:bg-border/60 group-enabled:group-active:bg-selected pointer-fine:size-8 [&>svg]:size-[18px] pointer-fine:[&>svg]:size-4 ${size === 'sm' ? 'size-9' : 'size-[42px]'}`}>{children}</span>
      {badge}
    </button>
  );
}

/** The menu icon: three lines, the middle one shorter (lucide has none quite like it). */
export function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h10M4 17h16" />
    </svg>
  );
}

/**
 * A key hint in a button or a line of text, from its stored form (`mod+k`, `a`, `enter`) so Windows readers see Ctrl.
 * `on-accent` inside a yellow button. Only shown with a mouse or trackpad: a touch screen has no keys.
 */
export function Kbd({ shortcut, tone = 'plain', className = '' }: { shortcut: string; tone?: 'plain' | 'on-accent' | 'cap'; className?: string }) {
  const look = tone === 'cap' ? 'min-w-5 rounded border border-edge bg-card px-1 text-center text-text shadow-[0_1px_0_var(--sb-edge)]' : tone === 'on-accent' ? 'text-on-accent/70' : 'text-faint';
  return <kbd className={`hidden font-sans text-meta font-normal tabular-nums pointer-fine:inline-block ${look} ${className}`}>{keys(shortcut)}</kbd>;
}

/** The small capitals over a group of rows, in the group's colour, with its count (the sidebar's SectionHeader). */
export function SectionHeader({ id, label, count, tone = 'text-faint', className = 'px-4' }: { id?: string; label: string; count?: number; tone?: string; className?: string }) {
  return (
    <h2 id={id} className={`flex items-center gap-1.5 pt-4 pb-1 text-meta font-semibold tracking-wide uppercase ${tone} ${className}`}>
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

/**
 * With more than one Claude profile, a row's rail is its profile's colour instead (as in Switchboard's sidebar), so
 * you see whose account a session uses at a glance; the status still shows in the dot, the age and the group.
 */
export const PROFILE_RAIL: Record<RemoteSessionProfile['color'], string> = {
  yellow: 'border-profile-yellow',
  blue: 'border-profile-blue',
  green: 'border-profile-green',
  purple: 'border-profile-purple',
  red: 'border-profile-red',
  orange: 'border-profile-orange',
  gray: 'border-profile-gray',
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
  // Working pulses, so a session that is busy reads as alive at a glance.
  return <span role="img" aria-label={STATUS_LABEL[status]} className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[status]} ${status === 'working' ? 'pulse-dot' : ''}`} />;
}

/**
 * The computer a session runs on, with more than one paired: a monitor and its name, as Switchboard marks a session on
 * another computer. Neutral rather than the computer's violet: here every session is on another computer.
 */
export function ComputerTag({ name, size = 'row', className = '' }: { name: string; size?: 'row' | 'header'; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-36 min-w-0 shrink-0 items-center gap-1 rounded-md bg-border/70 font-semibold whitespace-nowrap text-muted ${size === 'header' ? 'h-5 px-1.5 text-meta' : 'h-[18px] px-1.5 text-[11px]'} ${className}`}
      data-remote-computer-tag={name}
    >
      <Monitor className={`shrink-0 ${size === 'header' ? 'size-3' : 'size-2.5'}`} strokeWidth={2.25} aria-hidden />
      <span className="min-w-0 truncate">
        <span className="sr-only">On </span>
        {name}
      </span>
    </span>
  );
}
