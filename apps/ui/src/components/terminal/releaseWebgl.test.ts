import { describe, expect, it, vi } from 'vitest';
import { releaseWebglContexts, type CanvasLike } from './releaseWebgl.ts';

const webglCanvas = () => {
  const loseContext = vi.fn();
  const canvas: CanvasLike = { getContext: () => ({ getExtension: () => ({ loseContext }) }) };
  return { canvas, loseContext };
};

describe('releaseWebglContexts', () => {
  it('loses the context of each WebGL canvas', () => {
    const a = webglCanvas();
    const b = webglCanvas();
    expect(releaseWebglContexts([a.canvas, b.canvas])).toBe(2);
    expect(a.loseContext).toHaveBeenCalledOnce();
    expect(b.loseContext).toHaveBeenCalledOnce();
  });

  it('skips 2D canvases and contexts without the extension', () => {
    const twoD: CanvasLike = { getContext: () => null };
    const noExtension: CanvasLike = { getContext: () => ({ getExtension: () => null }) };
    expect(releaseWebglContexts([twoD, noExtension])).toBe(0);
  });

  it('keeps going when one canvas throws', () => {
    const broken: CanvasLike = {
      getContext: () => {
        throw new Error('lost');
      },
    };
    const ok = webglCanvas();
    expect(releaseWebglContexts([broken, ok.canvas])).toBe(1);
    expect(ok.loseContext).toHaveBeenCalledOnce();
  });
});
