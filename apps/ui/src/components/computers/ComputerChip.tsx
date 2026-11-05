import { Monitor } from 'lucide-react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { useComputers } from '../../state/computersStore.ts';
import { computerTint } from './computerColor.ts';

const SIZE = {
  /** On a session row's second line, in menus and in tiles. */
  row: { box: 'h-[18px] gap-1 px-1.5 text-[10.5px] font-semibold', icon: 10 },
  /** In a session's header ("on mystic") and the message box. */
  header: { box: 'h-[22px] gap-1.5 px-2 text-[11.5px] font-semibold', icon: 12 },
} as const;

/**
 * A computer's colour for an element and everything in it (`computerTint`), from the paired computers' status. Put it
 * on the root of what belongs to that computer: its rows, its views, the line over its sessions.
 */
export function useComputerTint(computerId: string | null | undefined): CSSProperties | undefined {
  const color = useComputers((s) => (computerId ? s.status?.computers.find((c) => c.id === computerId)?.color : undefined));
  return computerTint(color);
}

/**
 * The name of another computer, with a monitor: the one marker that says "this runs there" (docs/remote-access.md,
 * Other computers). `remote` on a 13% tint, in the computer's own colour when `computerId` names it (or an element
 * around it has `useComputerTint`); an offline computer is `faint` on a neutral tint. `children` replaces the name
 * ("on mystic").
 */
export function ComputerChip({
  name,
  size = 'row',
  offline = false,
  computerId,
  className = '',
  style,
  children,
  ...rest
}: { name: string; size?: keyof typeof SIZE; offline?: boolean; computerId?: string } & HTMLAttributes<HTMLSpanElement>) {
  const look = SIZE[size];
  const tint = useComputerTint(computerId);
  return (
    <span
      style={tint || style ? { ...tint, ...style } : undefined}
      className={`inline-flex max-w-full shrink-0 items-center rounded-md whitespace-nowrap ${look.box} ${offline ? 'bg-border/60 text-faint' : 'bg-remote/13 text-remote'} ${className}`}
      data-computer-chip={name}
      {...rest}
    >
      <Monitor size={look.icon} strokeWidth={2.25} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{children ?? name}</span>
    </span>
  );
}
