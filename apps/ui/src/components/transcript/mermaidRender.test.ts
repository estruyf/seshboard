import { describe, expect, it, vi } from 'vitest';
import { createMermaidRenderer, isMermaidFence, mermaidConfig, minDiagramWidth, svgSize, type MermaidApi } from './mermaidRender.ts';

const VARS = { primaryColor: '#fff' };

function fakeMermaid(render: (id: string, text: string) => Promise<{ svg: string }> = async (id, text) => ({ svg: `<svg id="${id}">${text}</svg>` })) {
  const calls: string[] = [];
  const api: MermaidApi = {
    initialize: vi.fn(),
    render: vi.fn((id, text) => {
      calls.push(text);
      return render(id, text);
    }),
  };
  return { api, calls };
}

describe('isMermaidFence', () => {
  it('knows a Mermaid fence in any case, and nothing else', () => {
    expect(isMermaidFence('mermaid')).toBe(true);
    expect(isMermaidFence('Mermaid')).toBe(true);
    expect(isMermaidFence('MERMAID')).toBe(true);
    expect(isMermaidFence('mermaidjs')).toBe(false);
    expect(isMermaidFence('markdown')).toBe(false);
    expect(isMermaidFence(undefined)).toBe(false);
  });
});

describe('mermaidConfig', () => {
  it('is strict, draws no error of its own and carries the theme', () => {
    const config = mermaidConfig(VARS);
    expect(config.securityLevel).toBe('strict');
    expect(config.startOnLoad).toBe(false);
    expect(config.suppressErrorRendering).toBe(true);
    expect(config.theme).toBe('base');
    expect(config.themeVariables).toBe(VARS);
  });
});

describe('createMermaidRenderer', () => {
  it('loads Mermaid once and draws with the theme', async () => {
    const { api } = fakeMermaid();
    const load = vi.fn(async () => api);
    const renderer = createMermaidRenderer({ load });
    const a = await renderer.render('graph TD; A-->B', VARS);
    const b = await renderer.render('pie\n"a": 1', VARS);
    expect(a).toEqual({ ok: true, svg: expect.stringContaining('graph TD') });
    expect(b.ok).toBe(true);
    expect(load).toHaveBeenCalledTimes(2); // the loader is the app's cached `import()`, asked each time
    expect(api.initialize).toHaveBeenCalledWith(expect.objectContaining({ themeVariables: VARS }));
  });

  it('draws one source and theme once, however often it is asked for, and remembers it', async () => {
    const { api, calls } = fakeMermaid();
    const renderer = createMermaidRenderer({ load: async () => api });
    expect(renderer.peek('graph TD; A-->B', VARS)).toBeUndefined();
    const [first, second] = await Promise.all([renderer.render('graph TD; A-->B', VARS), renderer.render('graph TD; A-->B', VARS)]);
    expect(second).toBe(first);
    await renderer.render('graph TD; A-->B', VARS);
    expect(calls).toHaveLength(1);
    expect(renderer.peek('graph TD; A-->B', VARS)).toEqual(first);
  });

  it('draws again for another theme', async () => {
    const { api, calls } = fakeMermaid();
    const renderer = createMermaidRenderer({ load: async () => api });
    await renderer.render('graph TD; A-->B', VARS);
    await renderer.render('graph TD; A-->B', { primaryColor: '#000' });
    expect(calls).toHaveLength(2);
    expect(renderer.peek('graph TD; A-->B', { primaryColor: '#000' })?.ok).toBe(true);
  });

  it('draws one diagram at a time, in the order asked', async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const { api } = fakeMermaid(async (id, text) => {
      running++;
      most = Math.max(most, running);
      order.push(text);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return { svg: `<svg id="${id}"/>` };
    });
    const renderer = createMermaidRenderer({ load: async () => api });
    await Promise.all(['one', 'two', 'three'].map((text) => renderer.render(text, VARS)));
    expect(most).toBe(1);
    expect(order).toEqual(['one', 'two', 'three']);
  });

  it('reports a diagram that does not parse, cleans up after it and remembers that too', async () => {
    const { api, calls } = fakeMermaid(async () => {
      throw new Error('Parse error on line 1');
    });
    const cleanup = vi.fn();
    const renderer = createMermaidRenderer({ load: async () => api, cleanup });
    expect(await renderer.render('nope', VARS)).toEqual({ ok: false, error: 'Parse error on line 1' });
    expect(cleanup).toHaveBeenCalledWith(expect.stringMatching(/^sb-mermaid-\d+$/));
    expect(renderer.peek('nope', VARS)).toEqual({ ok: false, error: 'Parse error on line 1' });
    await renderer.render('nope', VARS);
    expect(calls).toHaveLength(1);
  });

  it('keeps going after a failure, and does not remember Mermaid failing to load', async () => {
    const { api } = fakeMermaid();
    let attempts = 0;
    const renderer = createMermaidRenderer({
      load: async () => {
        if (++attempts === 1) throw new Error('chunk failed');
        return api;
      },
    });
    expect(await renderer.render('graph TD; A-->B', VARS)).toEqual({ ok: false, error: 'chunk failed' });
    expect(renderer.peek('graph TD; A-->B', VARS)).toBeUndefined();
    expect((await renderer.render('graph TD; A-->B', VARS)).ok).toBe(true);
  });

  it('forgets the oldest drawings past its budget', async () => {
    const { api } = fakeMermaid(async (id, text) => ({ svg: `<svg id="${id}">${text}</svg>` }));
    const renderer = createMermaidRenderer({ load: async () => api, budget: 400 });
    const big = (n: number) => `graph TD; ${'A-->B;'.repeat(5)}${n}`;
    for (let i = 0; i < 8; i++) await renderer.render(big(i), { x: 1 });
    expect(renderer.peek(big(0), { x: 1 })).toBeUndefined();
    expect(renderer.peek(big(7), { x: 1 })?.ok).toBe(true);
  });
});

describe('svgSize', () => {
  it("reads the diagram's size from its viewBox", () => {
    expect(svgSize('<svg id="m" width="100%" style="max-width: 412.5px;" viewBox="0 0 412.5 180" xmlns="http://www.w3.org/2000/svg"><g/></svg>')).toEqual({ width: 412.5, height: 180 });
    expect(svgSize('<?xml version="1.0"?><svg viewBox="-8,-8 300,120"></svg>')).toEqual({ width: 300, height: 120 });
  });

  it('is null without a usable viewBox, and ignores one on an inner element', () => {
    expect(svgSize('<svg width="10" height="10"><svg viewBox="0 0 5 5"/></svg>')).toBeNull();
    expect(svgSize('<svg viewBox="0 0 0 0"></svg>')).toBeNull();
    expect(svgSize('<div/>')).toBeNull();
  });
});

describe('minDiagramWidth', () => {
  it('shrinks a wide diagram to 60%, keeps a small one whole', () => {
    expect(minDiagramWidth(1000)).toBe(600);
    expect(minDiagramWidth(200)).toBe(200);
    expect(minDiagramWidth(400)).toBe(280);
  });
});
