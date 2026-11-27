import { isValidElement, type ReactNode } from 'react';

/** What a rail item draws, as `sameRailItems` compares it (the rail's `RailItem`, without importing the view). */
export type RailLike =
  | 'divider'
  | { id: string; icon: ReactNode; label: string; ariaLabel: string; kbd?: string; count?: number; dot?: boolean; state: string; data: Record<string, boolean>; onClick(): void };

/** The same icon: the same node, or an element of the same type with the same props (`<AppIcon editor={…} />`). */
function sameIcon(a: ReactNode, b: ReactNode): boolean {
  if (Object.is(a, b)) return true;
  if (!isValidElement(a) || !isValidElement(b) || a.type !== b.type || a.key !== b.key) return false;
  const pa = a.props as Record<string, unknown>;
  const pb = b.props as Record<string, unknown>;
  const keys = Object.keys(pa);
  return keys.length === Object.keys(pb).length && keys.every((key) => Object.is(pa[key], pb[key]));
}

/**
 * Whether two lists of rail items draw the same, so the rail can keep the first and skip rendering. Click handlers
 * compare by identity: `useRailItems` gives each item a stable one. Pure, with tests.
 */
export function sameRailItems(a: readonly RailLike[], b: readonly RailLike[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    if (x === 'divider' || y === 'divider') return x === y;
    const dataKeys = Object.keys(x.data);
    return (
      x.id === y.id &&
      x.label === y.label &&
      x.ariaLabel === y.ariaLabel &&
      x.kbd === y.kbd &&
      x.count === y.count &&
      x.dot === y.dot &&
      x.state === y.state &&
      x.onClick === y.onClick &&
      sameIcon(x.icon, y.icon) &&
      dataKeys.length === Object.keys(y.data).length &&
      dataKeys.every((key) => x.data[key] === y.data[key])
    );
  });
}
