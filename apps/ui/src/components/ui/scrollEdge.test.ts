import { describe, expect, it } from 'vitest';
import { scrollEdges } from './scrollEdge.ts';

describe('scrollEdges', () => {
  it('is at the top before anything scrolled', () => {
    expect(scrollEdges({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 })).toEqual({ atTop: true, atBottom: false });
  });

  it('is at neither edge in the middle', () => {
    expect(scrollEdges({ scrollTop: 300, scrollHeight: 1000, clientHeight: 400 })).toEqual({ atTop: false, atBottom: false });
  });

  it('is at the bottom when scrolled all the way down', () => {
    expect(scrollEdges({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toEqual({ atTop: false, atBottom: true });
  });

  it('is at both edges when the content is shorter than the view', () => {
    expect(scrollEdges({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 })).toEqual({ atTop: true, atBottom: true });
  });

  it('counts a fraction of a pixel short of an edge as the edge', () => {
    expect(scrollEdges({ scrollTop: 0.5, scrollHeight: 1000, clientHeight: 400 }).atTop).toBe(true);
    expect(scrollEdges({ scrollTop: 599.4, scrollHeight: 1000, clientHeight: 400 }).atBottom).toBe(true);
  });
});
