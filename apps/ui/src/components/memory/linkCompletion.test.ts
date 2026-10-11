import { describe, expect, it } from 'vitest';
import { completeLink, linkQuery, linkSuggestions } from './linkCompletion.ts';

describe('link completion', () => {
  it('sees an unfinished [[ before the caret', () => {
    expect(linkQuery('See [[des', 9)).toBe('des');
    expect(linkQuery('See [[', 6)).toBe('');
    expect(linkQuery('See [[done]] x', 14)).toBeNull();
    expect(linkQuery('See [[a|lab', 11)).toBeNull();
    expect(linkQuery('a [[b\nc', 7)).toBeNull();
  });

  it('suggests names starting with the query first', () => {
    expect(linkSuggestions(['sidebar-order', 'design-system', 'release', 'design'], 'des')).toEqual(['design', 'design-system']);
    expect(linkSuggestions(['sidebar-order', 'order-notes'], 'order')).toEqual(['order-notes', 'sidebar-order']);
  });

  it('completes the link and moves the caret after it', () => {
    expect(completeLink('See [[des for x', 9, 'design-system')).toEqual({ text: 'See [[design-system]] for x', caret: 21 });
    expect(completeLink('See [[des]] x', 9, 'design')).toEqual({ text: 'See [[design]] x', caret: 14 });
  });
});
