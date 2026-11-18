import { describe, expect, it, vi } from 'vitest';
import { createMermaidRenderer, isMermaidFence, MAX_DIAGRAM_EDGES, MAX_DIAGRAM_TEXT, mermaidConfig, minDiagramWidth, svgSize, uniqueSvgIds, type MermaidApi } from './mermaidRender.ts';

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

  it("keeps the app's theme and label kind out of a diagram's own settings, and limits its size", () => {
    const config = mermaidConfig(VARS);
    // Mermaid drops these keys from `%%{init: …}%%` and front matter (nested ones too), and keeps its own secure keys.
    expect(config.secure).toEqual(expect.arrayContaining(['secure', 'securityLevel', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'startOnLoad', 'theme', 'themeVariables', 'themeCSS', 'htmlLabels', 'fontFamily']));
    expect(config.htmlLabels).toBe(false);
    expect(config.maxTextSize).toBe(MAX_DIAGRAM_TEXT);
    expect(config.maxEdges).toBe(MAX_DIAGRAM_EDGES);
    expect(MAX_DIAGRAM_TEXT).toBeLessThan(50_000);
    expect(MAX_DIAGRAM_EDGES).toBeLessThan(500);
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
    expect(await renderer.render('graph TD; A-->B', VARS)).toEqual({ ok: false, error: 'chunk failed', load: true });
    expect(renderer.peek('graph TD; A-->B', VARS)).toBeUndefined();
    expect((await renderer.render('graph TD; A-->B', VARS)).ok).toBe(true);
  });

  it('says plainly that Mermaid could not load, apart from a diagram that does not parse', async () => {
    const renderer = createMermaidRenderer({
      load: async () => {
        throw new Error('chunk failed');
      },
    });
    expect(await renderer.render('graph TD; A-->B', VARS)).toEqual({ ok: false, error: 'chunk failed', load: true });
    const { api } = fakeMermaid(async () => {
      throw new Error('Parse error');
    });
    const parsing = createMermaidRenderer({ load: async () => api });
    expect(await parsing.render('nope', VARS)).toEqual({ ok: false, error: 'Parse error' });
  });

  it('does not hand Mermaid a diagram over the size limit, which it would draw an error box for', async () => {
    const { api, calls } = fakeMermaid();
    const renderer = createMermaidRenderer({ load: async () => api });
    const outcome = await renderer.render(`graph TD\n${'A-->B\n'.repeat(MAX_DIAGRAM_TEXT / 6 + 10)}`, VARS);
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect((await renderer.render('graph TD; A-->B', VARS)).ok).toBe(true);
  });

  describe('with a signal', () => {
    const gate = () => {
      let open!: () => void;
      const opened = new Promise<void>((resolve) => (open = resolve));
      return { opened, open };
    };

    it('skips a queued drawing nobody wants any more, and does not keep it', async () => {
      const first = gate();
      const { api, calls } = fakeMermaid(async (id, text) => {
        if (text === 'first') await first.opened;
        return { svg: `<svg id="${id}">${text}</svg>` };
      });
      const renderer = createMermaidRenderer({ load: async () => api });
      const running = renderer.render('first', VARS);
      const scrolledPast = new AbortController();
      const skipped = renderer.render('second', VARS, scrolledPast.signal);
      const wanted = renderer.render('third', VARS, new AbortController().signal);
      scrolledPast.abort();
      first.open();
      expect((await running).ok).toBe(true);
      expect(await skipped).toEqual({ ok: false, error: 'Skipped', skipped: true });
      expect((await wanted).ok).toBe(true);
      expect(calls).toEqual(['first', 'third']);
      expect(renderer.peek('second', VARS)).toBeUndefined();
      // Asked for again, it is drawn.
      expect((await renderer.render('second', VARS)).ok).toBe(true);
      expect(calls).toEqual(['first', 'third', 'second']);
    });

    it('draws a job while any block that asked for it is still there', async () => {
      const first = gate();
      const { api, calls } = fakeMermaid(async (id, text) => {
        if (text === 'first') await first.opened;
        return { svg: `<svg id="${id}">${text}</svg>` };
      });
      const renderer = createMermaidRenderer({ load: async () => api });
      const running = renderer.render('first', VARS);
      const leaving = new AbortController();
      const one = renderer.render('shared', VARS, leaving.signal);
      const two = renderer.render('shared', VARS, new AbortController().signal);
      leaving.abort();
      first.open();
      await running;
      expect((await one).ok).toBe(true);
      expect(await two).toBe(await one);
      expect(calls).toEqual(['first', 'shared']);
    });

    it('lets a drawing that has started finish and keeps it, whoever left', async () => {
      const started = gate();
      const finish = gate();
      const { api } = fakeMermaid(async (id, text) => {
        started.open();
        await finish.opened;
        return { svg: `<svg id="${id}">${text}</svg>` };
      });
      const renderer = createMermaidRenderer({ load: async () => api });
      const leaving = new AbortController();
      const drawing = renderer.render('now', VARS, leaving.signal);
      await started.opened;
      leaving.abort();
      finish.open();
      expect((await drawing).ok).toBe(true);
      expect(renderer.peek('now', VARS)?.ok).toBe(true);
    });
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

describe('uniqueSvgIds', () => {
  const svg = '<svg id="sb-mermaid-3" viewBox="0 0 10 10"><style>#sb-mermaid-3 .a{fill:red}#sb-mermaid-3 .b{marker-end:url(#sb-mermaid-3_flowchart-pointEnd)}</style><defs><marker id="sb-mermaid-3_flowchart-pointEnd"/></defs><path marker-end="url(#sb-mermaid-3_flowchart-pointEnd)"/><g id="sb-mermaid-31"/></svg>';

  it("gives a copy its own ids, so a marker's url() points at the copy's own", () => {
    const copy = uniqueSvgIds(svg, 'c1');
    expect(copy).toContain('<svg id="sb-mermaid-3-c1"');
    expect(copy).toContain('<style>#sb-mermaid-3-c1 .a');
    expect(copy).toContain('<marker id="sb-mermaid-3-c1_flowchart-pointEnd"/>');
    expect(copy).toContain('marker-end="url(#sb-mermaid-3-c1_flowchart-pointEnd)"');
    // `sb-mermaid-31` is another name that only starts like it.
    expect(copy).toContain('<g id="sb-mermaid-31"/>');
    expect(copy).not.toContain('sb-mermaid-3_');
  });

  it('renames ids, references and selectors only, not a label that happens to say the same', () => {
    const labelled = '<svg id="sb-mermaid-3" viewBox="0 0 1 1" aria-labelledby="sb-mermaid-3_title"><style>#sb-mermaid-3 .x{fill:red}</style><text>see sb-mermaid-3 and sb-mermaid-3_x</text><a href="#sb-mermaid-3_n" xlink:href="#sb-mermaid-3_n"/></svg>';
    const copy = uniqueSvgIds(labelled, 'c2');
    expect(copy).toContain('<text>see sb-mermaid-3 and sb-mermaid-3_x</text>');
    expect(copy).toContain('aria-labelledby="sb-mermaid-3-c2_title"');
    expect(copy).toContain('#sb-mermaid-3-c2 .x');
    expect(copy).toContain('href="#sb-mermaid-3-c2_n"');
    expect(copy).toContain('<svg id="sb-mermaid-3-c2"');
  });

  it('makes two copies different from each other, and leaves an svg without an id alone', () => {
    expect(uniqueSvgIds(svg, 'c1')).not.toBe(uniqueSvgIds(svg, 'c2'));
    expect(uniqueSvgIds('<svg viewBox="0 0 1 1"><g/></svg>', 'c1')).toBe('<svg viewBox="0 0 1 1"><g/></svg>');
  });
});
