import { Monitor } from 'lucide-react';
import type { HTMLAttributes } from 'react';

const SIZE = {
  /** On a session row's second line, in menus and in tiles. */
  row: { box: 'h-[18px] gap-1 px-1.5 text-[10.5px] font-semibold', icon: 10 },
  /** In a session's header ("on mystic") and the message box. */
  header: { box: 'h-[22px] gap-1.5 px-2 text-[11.5px] font-semibold', icon: 12 },
} as const;

/**
 * The name of another computer, with a monitor: the one marker that says "this runs there" (docs/remote-access.md,
 * Other computers). `remote` on a 13% tint; an offline computer is `faint` on a neutral tint. `children` replaces the
 * name ("on mystic").
 */
export function ComputerChip({
  name,
  size = 'row',
  offline = false,
  className = '',
  children,
  ...rest
}: { name: string; size?: keyof typeof SIZE; offline?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  const look = SIZE[size];
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center rounded-md whitespace-nowrap ${look.box} ${offline ? 'bg-border/60 text-faint' : 'bg-remote/13 text-remote'} ${className}`}
      data-computer-chip={name}
      {...rest}
    >
      <Monitor size={look.icon} strokeWidth={2.25} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{children ?? name}</span>
    </span>
  );
}
