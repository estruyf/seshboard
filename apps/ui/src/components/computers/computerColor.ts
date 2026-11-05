import type { CSSProperties } from 'react';
import type { ComputerColor } from '@seshboard/protocol/client';

/** How each computer colour is called, for the swatches' labels. */
export const COMPUTER_COLOR_NAME: Record<ComputerColor, string> = {
  violet: 'Violet',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  orange: 'Orange',
  red: 'Red',
  gray: 'Grey',
};

/** The token each colour is drawn with: the `remote` token for violet, a profile colour's for the others. */
export const COMPUTER_COLOR_VAR: Record<ComputerColor, string> = {
  violet: 'var(--sb-remote)',
  blue: 'var(--sb-profile-blue)',
  green: 'var(--sb-profile-green)',
  yellow: 'var(--sb-profile-yellow)',
  orange: 'var(--sb-profile-orange)',
  red: 'var(--sb-profile-red)',
  gray: 'var(--sb-profile-gray)',
};

/**
 * A computer's colour for everything inside an element: it sets `--sb-remote` there, so the `remote` utilities
 * (`text-remote`, `bg-remote/13`, the line over its sessions) take that computer's colour. Undefined for violet,
 * which is the token as the theme has it.
 */
export function computerTint(color: ComputerColor | null | undefined): CSSProperties | undefined {
  if (!color || color === 'violet') return undefined;
  return { '--sb-remote': COMPUTER_COLOR_VAR[color] } as CSSProperties;
}
