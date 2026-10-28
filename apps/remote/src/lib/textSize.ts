/** Settings › Appearance › Text size: the type scale, one or two steps up, kept on this device. Pure, with tests. */

export type TextSize = 'default' | 'large' | 'larger';

export const TEXT_SIZES: readonly { value: TextSize; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
];

/** What was kept, or Default for anything else. */
export const cleanTextSize = (value: unknown): TextSize => (value === 'large' || value === 'larger' ? value : 'default');
