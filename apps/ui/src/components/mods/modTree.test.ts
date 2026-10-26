import { describe, expect, it } from 'vitest';
import { contrastOf } from '@seshboard/protocol/color';
import { liftContrast, modToken, resolveModColor } from './modColor.ts';
import { boxStyle, cells, textStyle, wrapMode } from './modLayout.ts';
import { safeHref } from './modLinks.ts';
import { sanitizeSvg } from './modSvg.ts';
import { cutNote, isBlank, limitsFor, prepareTree, splitParts, type ModChild } from './modTree.ts';

const M = { ch: 8, lh: 20 };
const press = { plugin: 'agent-watch', handle: 3 };

describe('prepareTree node types', () => {
  it('reads every node type', () => {
    const tree = prepareTree(
      {
        type: 'Box',
        props: { flexDirection: 'column', style: { bad: 1 } },
        part: { plugin: 'agent-watch' },
        children: [
          { type: 'Text', props: { color: 'yellow' }, children: ['3 of 3'] },
          { type: 'div', children: [{ type: 'span', children: ['a'] }, { type: 'b', children: ['bold'] }] },
          { type: 'Link', props: { href: 'https://example.com', label: 'site' } },
          { type: 'Code', props: { source: 'npm test', language: 'sh' } },
          { type: 'Markdown', props: { text: '**hi**', dimColor: true } },
          { type: 'Svg', props: { source: '<svg><circle r="2"/></svg>', alt: 'dot', width: 12 } },
          { type: 'Button', props: { key: 'show', label: 'Show agents', variant: 'primary' }, press },
          { type: 'Input', props: { key: 'q', placeholder: 'Find', rows: 3 }, press },
          { type: 'Select', props: { key: 'm', options: [{ value: 'a', label: 'A' }, { value: 'b' }], value: 'b' }, press },
          { type: 'engine', ref: 0 },
        ],
      },
      limitsFor('band'),
    );
    expect(tree.cut).toBeNull();
    expect(tree.engineRef).toBe(0);
    const box = tree.children[0] as Extract<ModChild, { kind: 'box' }>;
    expect(box).toMatchObject({ kind: 'box', part: 'agent-watch', props: { flexDirection: 'column' } });
    // Only plain values reach a style.
    expect(box.props).not.toHaveProperty('style');
    expect(box.children.map((c) => (typeof c === 'string' ? 'string' : c.kind))).toEqual(['text', 'box', 'link', 'code', 'markdown', 'svg', 'button', 'input', 'select', 'engine']);
    const inner = box.children[1] as Extract<ModChild, { kind: 'box' }>;
    expect(inner.children[1]).toMatchObject({ kind: 'text', props: { bold: true }, children: ['bold'] });
    expect(box.children[2]).toMatchObject({ kind: 'link', href: 'https://example.com/', label: 'site' });
    expect(box.children[6]).toMatchObject({ kind: 'button', key: 'show', label: 'Show agents', primary: true, press });
    expect(box.children[7]).toMatchObject({ kind: 'input', rows: 3, placeholder: 'Find', press });
    expect(box.children[8]).toMatchObject({ kind: 'select', value: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'b' }] });
  });

  it('skips Client and draws an unknown type as its children', () => {
    const tree = prepareTree([{ type: 'Client', props: { key: 'k', module: 'hooks/board.tsx' }, client: { plugin: 'x' } }, { type: 'Sparkle', children: ['kept'] }], limitsFor('band'));
    expect(tree.children).toEqual([{ kind: 'fragment', children: ['kept'] }]);
  });

  it('keeps one engine node per tree', () => {
    const tree = prepareTree({ type: 'Box', children: [{ type: 'engine', ref: 0 }, { type: 'engine', ref: 1 }] }, limitsFor('item'));
    expect((tree.children[0] as { children: unknown[] }).children).toEqual([{ kind: 'engine', ref: 0 }]);
  });

  it('never keeps a link that is not http or https, or a press without a handle', () => {
    const tree = prepareTree(
      [
        { type: 'Link', props: { href: 'javascript:alert(1)' } },
        { type: 'Link', props: { href: 'file:///etc/passwd' } },
        { type: 'Button', props: { key: 'b', label: 'B' }, press: { plugin: 'p', handle: 'x' } },
      ],
      limitsFor('band'),
    );
    expect(tree.children).toMatchObject([{ href: null }, { href: null }, { press: null }]);
  });
});

describe('tree limits', () => {
  const many = (n: number) => ({ type: 'Box', children: Array.from({ length: n }, () => ({ type: 'Text', children: ['x'] })) });

  it('cuts at 2,000 nodes, 10,000 in a pane', () => {
    expect(prepareTree(many(1999), limitsFor('band')).cut).toBeNull();
    const band = prepareTree(many(2500), limitsFor('band'));
    expect(band.cut).toBe('nodes');
    expect((band.children[0] as { children: unknown[] }).children).toHaveLength(1999);
    expect(prepareTree(many(2500), limitsFor('pane')).cut).toBeNull();
    expect(prepareTree(many(10_500), limitsFor('pane')).cut).toBe('nodes');
  });

  it('cuts deeper than 32 levels', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 40; i++) deep = { type: 'Box', children: [deep] };
    expect(prepareTree(deep, limitsFor('band')).cut).toBe('depth');
  });

  it('cuts past 256 KB of text', () => {
    const big = 'x'.repeat(100 * 1024);
    expect(prepareTree([big, big], limitsFor('band')).cut).toBeNull();
    const cut = prepareTree([big, big, big], limitsFor('band'));
    expect(cut.cut).toBe('text');
    expect(cut.children).toHaveLength(2);
  });

  it('cuts past 250 pictures', () => {
    const svgs = Array.from({ length: 260 }, () => ({ type: 'Svg', props: { source: '<svg/>', alt: '' } }));
    const tree = prepareTree(svgs, limitsFor('pane'));
    expect(tree.cut).toBe('svgs');
    expect(tree.children).toHaveLength(250);
  });

  it('says which limit was hit, quietly', () => {
    expect(cutNote('nodes', 'pane', limitsFor('pane'))).toBe("This pane hit its 10,000 node limit. The rest isn't shown.");
    expect(cutNote('nodes', 'band', limitsFor('band'))).toBe("This band hit its 2,000 node limit. The rest isn't shown.");
    expect(cutNote('depth', 'band', limitsFor('band'))).toBe("This band hit its 32 level limit. The rest isn't shown.");
    expect(cutNote('text', 'item', limitsFor('item'))).toBe("This view hit its 256 KB text limit. The rest isn't shown.");
    expect(cutNote('svgs', 'pane', limitsFor('pane'))).toBe("This pane hit its 250 picture limit. The rest isn't shown.");
  });
});

describe('splitParts', () => {
  it('gives each mod its own part, in plugin order', () => {
    const tree = prepareTree(
      {
        type: 'Box',
        part: { plugin: 'pr-status' },
        children: [
          { type: 'Text', children: ['PR #142'] },
          { type: 'Box', part: { plugin: 'agent-watch' }, children: [{ type: 'Text', children: ['3 of 3 agents running'] }] },
          { type: 'engine', ref: 0 },
        ],
      },
      limitsFor('band'),
    );
    const parts = splitParts(tree.children, 'pr-status', ['agent-watch', 'pr-status']);
    expect(parts.map((p) => p.plugin)).toEqual(['agent-watch', 'pr-status']);
    expect(JSON.stringify(parts[1])).not.toContain('agents running');
    expect(JSON.stringify(parts)).not.toContain('engine');
  });

  it('reads the mod name as a plain part or part.name too', () => {
    const tree = prepareTree(
      [
        { type: 'Box', part: 'claude-stats', children: [{ type: 'Text', children: ['74% 5h'] }] },
        { type: 'Box', part: { name: 'agent-watch' }, children: [{ type: 'Text', children: ['2 agents'] }] },
      ],
      limitsFor('band'),
    );
    expect(splitParts(tree.children, 'mod', []).map((p) => p.plugin)).toEqual(['claude-stats', 'agent-watch']);
  });

  it('drops parts that draw nothing', () => {
    const tree = prepareTree([{ type: 'engine', ref: 0 }, ' '], limitsFor('band'));
    expect(splitParts(tree.children, 'x', [])).toEqual([]);
    expect(isBlank(tree.children)).toBe(true);
  });
});

describe('colours', () => {
  it('maps Ink names to theme tokens', () => {
    expect(['red', 'green', 'yellow', 'blue', 'cyan', 'magenta', 'gray', 'grey', 'dim', 'white', 'redBright'].map(modToken)).toEqual([
      'error',
      'ok',
      'caution',
      'link',
      'link',
      'remote',
      'muted',
      'muted',
      'muted',
      'text',
      'error',
    ]);
    expect(modToken('chartreuse')).toBeNull();
  });

  it('keeps hex colours but lifts them to 4.5:1 on the frame', () => {
    const dark = '#1b1f2a';
    const light = '#ffffff';
    const navy = liftContrast('#1d3a8a', dark)!;
    expect(contrastOf(navy, dark)).toBeGreaterThanOrEqual(4.5);
    const pale = liftContrast('#fff3a0', light)!;
    expect(contrastOf(pale, light)).toBeGreaterThanOrEqual(4.5);
    // Already readable: unchanged.
    expect(liftContrast('#ffffff', dark)).toBe('#ffffff');
  });

  it('never lets anything but a colour into a style', () => {
    expect(resolveModColor('url(https://x)', '#000')).toBeNull();
    expect(resolveModColor('var(--sb-bg)', '#000')).toBeNull();
    expect(resolveModColor('red', '#000')).toEqual({ token: 'error' });
    expect(resolveModColor(12, '#000')).toBeNull();
  });
});

describe('cells', () => {
  it('converts columns with ch and rows with lh', () => {
    expect(cells(10, 'x', M)).toBe('80px');
    expect(cells(2, 'y', M)).toBe('40px');
    expect(cells('50%', 'x', M)).toBe('50%');
    expect(cells('md', 'x', M)).toBe('12px');
    expect(cells('10px; color: red', 'x', M)).toBeNull();
  });

  it('lays a Box out as a row unless it says otherwise, with spacing in cells', () => {
    const style = boxStyle({ paddingX: 2, marginTop: 1, gap: 1, borderStyle: 'round', width: 20 }, M, '#000');
    expect(style).toMatchObject({ display: 'flex', flexDirection: 'row', paddingLeft: '16px', paddingRight: '16px', marginTop: '20px', columnGap: '8px', rowGap: '20px', borderRadius: 6, width: '160px' });
    expect(boxStyle({ flexDirection: 'column' }, M, '#000').flexDirection).toBe('column');
    expect(boxStyle({ flexDirection: 'evil' }, M, '#000').flexDirection).toBe('row');
  });

  it('reads text props', () => {
    expect(textStyle({ bold: true, italic: true, underline: true, strikethrough: true, dimColor: true, color: 'green' }, '#000')).toMatchObject({
      fontWeight: 600,
      fontStyle: 'italic',
      textDecoration: 'underline line-through',
      opacity: 0.6,
      color: 'var(--sb-ok)',
    });
    expect(textStyle({ inverse: true, color: 'red' }, '#000')).toMatchObject({ backgroundColor: 'var(--sb-error)', color: 'var(--sb-card)' });
    expect(wrapMode({ wrap: 'truncate-end' })).toBe('truncate');
    expect(wrapMode({})).toBe('wrap');
    expect(textStyle({ wrap: 'truncate' }, '#000')).toMatchObject({ textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  });
});

describe('safety', () => {
  it('opens only http and https links', () => {
    expect(safeHref('https://github.com/a/b/pull/142')).toBe('https://github.com/a/b/pull/142');
    expect(safeHref('http://localhost:3000')).toBe('http://localhost:3000/');
    for (const bad of ['javascript:alert(1)', 'file:///x', 'vscode://x', 'data:text/html,x', 'https://x\n.com', 'h'.repeat(3000)]) expect(safeHref(bad)).toBeNull();
  });

  it('sanitizes SVG: no scripts, no event handlers, no external references', () => {
    const svg = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="https://evil"><rect fill="url(https://x/y)" onclick=\'z()\'/></a><use href="#dot"/><foreignObject><div/></foreignObject><style>@import url(https://x);</style></svg>',
    )!;
    expect(svg).not.toMatch(/script|onload|onclick|https:\/\/evil|https:\/\/x|foreignObject|@import/);
    expect(svg).toContain('<rect');
    expect(sanitizeSvg('<div>not an svg</div>')).toBeNull();
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>')).not.toContain('ENTITY');
  });
});
