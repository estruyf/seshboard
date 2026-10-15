import { describe, expect, it } from 'vitest';
import { toggledStrip } from './taskStripStore.ts';

describe('the task strip', () => {
  it('opens a closed strip and closes it again', () => {
    expect(toggledStrip(null, 'background')).toBe('background');
    expect(toggledStrip('background', 'background')).toBeNull();
  });

  it('swaps one strip for the other', () => {
    expect(toggledStrip('todos', 'background')).toBe('background');
    expect(toggledStrip('background', 'todos')).toBe('todos');
  });
});
