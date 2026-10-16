import { MOD_TREE_LIMITS } from '@switchboard/protocol/client';
import { sanitizeSvg } from './modSvg.ts';
import { safeHref } from './modLinks.ts';

/**
 * A mod's drawing, checked again on this side before it is drawn. Claude Code validated it already, but it is still a
 * mod's data: anything not understood is dropped or drawn as its children, nothing in it can run code or load a URL,
 * and a tree over the limits is cut with a note. Pure, so it can be tested.
 */

/** What a Button, Input or Select sends back: the mod and the handle of its closure in Claude Code. */
export interface ModPressRef {
  plugin: string;
  handle: number;
}

export type ModProps = Record<string, string | number | boolean>;

export type ModNode =
  | { kind: 'box'; props: ModProps; part: string | null; children: ModChild[] }
  | { kind: 'text'; props: ModProps; part: string | null; children: ModChild[] }
  | { kind: 'link'; href: string | null; label: string | null; children: ModChild[] }
  | { kind: 'code'; source: string; language: string | null; diff: boolean; truncate: boolean }
  | { kind: 'markdown'; text: string; dim: boolean; key: string | null; press: ModPressRef | null; pressableLinks: string[] | null }
  | { kind: 'svg'; source: string | null; alt: string; width: number | null; height: number | null }
  | { kind: 'button'; key: string; label: string; dim: boolean; primary: boolean; press: ModPressRef | null; children: ModChild[] }
  | { kind: 'input'; key: string; label: string | null; placeholder: string | null; value: string; submitLabel: string | null; rows: number; press: ModPressRef | null }
  | { kind: 'select'; key: string; label: string | null; value: string | null; options: Array<{ value: string; label: string }>; press: ModPressRef | null }
  | { kind: 'engine'; ref: number }
  | { kind: 'fragment'; children: ModChild[] };

export type ModChild = string | ModNode;

export type CutReason = 'nodes' | 'depth' | 'text' | 'svgs';

export interface TreeLimits {
  nodes: number;
  depth: number;
  textBytes: number;
  svgs: number;
}

/** The limits of a band or a replaced component, and of a pane (more nodes). */
export function limitsFor(site: 'pane' | 'band' | 'item'): TreeLimits {
  return { nodes: site === 'pane' ? MOD_TREE_LIMITS.paneNodes : MOD_TREE_LIMITS.nodes, depth: MOD_TREE_LIMITS.depth, textBytes: MOD_TREE_LIMITS.textBytes, svgs: MOD_TREE_LIMITS.svgs };
}

export interface PreparedTree {
  children: ModChild[];
  /** Why the tree was cut, or null when it all fit. */
  cut: CutReason | null;
  /** Where the built-in component goes (the first `engine` node's ref), or null when the mod drew none. */
  engineRef: number | null;
}

/** The quiet line that ends a cut tree. */
export function cutNote(reason: CutReason, site: 'pane' | 'band' | 'item', limits: TreeLimits): string {
  const where = site === 'pane' ? 'This pane' : site === 'band' ? 'This band' : 'This view';
  const what =
    reason === 'nodes'
      ? `${limits.nodes.toLocaleString('en-US')} node`
      : reason === 'depth'
        ? `${limits.depth} level`
        : reason === 'text'
          ? `${Math.round(limits.textBytes / 1024)} KB text`
          : `${limits.svgs} picture`;
  return `${where} hit its ${what} limit. The rest isn't shown.`;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const encoder = new TextEncoder();

function pressOf(raw: unknown): ModPressRef | null {
  const press = obj(raw);
  return press && typeof press.plugin === 'string' && Number.isInteger(press.handle) ? { plugin: press.plugin, handle: press.handle as number } : null;
}

/** Only plain values reach a style: strings, numbers and booleans. */
function plainProps(raw: unknown): ModProps {
  const props: ModProps = {};
  for (const [key, value] of Object.entries(obj(raw) ?? {})) {
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) props[key] = value;
  }
  return props;
}

const CONTAINERS = new Set(['Box', 'div']);
const TEXTS = new Set(['Text', 'span', 'b']);

/** Normalises and bounds a raw tree (the root may be one node, a string, or a list). */
export function prepareTree(raw: unknown, limits: TreeLimits): PreparedTree {
  let nodes = 0;
  let textBytes = 0;
  let svgs = 0;
  let cut: CutReason | null = null;
  let engineRef: number | null = null;

  const text = (value: string): string | null => {
    textBytes += encoder.encode(value).length;
    if (textBytes > limits.textBytes) {
      cut ??= 'text';
      return null;
    }
    return value;
  };

  const children = (raw: unknown, depth: number): ModChild[] => {
    const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    const out: ModChild[] = [];
    for (const child of list) {
      if (cut) break;
      const node = visit(child, depth);
      if (node !== null) out.push(node);
    }
    return out;
  };

  const visit = (raw: unknown, depth: number): ModChild | null => {
    if (typeof raw === 'string') return text(raw);
    if (typeof raw === 'number') return text(String(raw));
    const node = obj(raw);
    if (!node) return null;
    if (depth > limits.depth) {
      cut ??= 'depth';
      return null;
    }
    nodes++;
    if (nodes > limits.nodes) {
      cut ??= 'nodes';
      return null;
    }
    const type = str(node.type);
    const props = obj(node.props) ?? {};
    const part = str(obj(node.part)?.plugin);
    if (type && CONTAINERS.has(type)) return { kind: 'box', props: plainProps(props), part, children: children(node.children, depth + 1) };
    if (type && TEXTS.has(type)) {
      const textProps = plainProps(props);
      if (type === 'b') textProps.bold = true;
      return { kind: 'text', props: textProps, part, children: children(node.children, depth + 1) };
    }
    switch (type) {
      case 'Link': {
        const label = str(props.label);
        return { kind: 'link', href: safeHref(props.href), label: label === null ? null : text(label), children: children(node.children, depth + 1) };
      }
      case 'Code': {
        const source = text(str(props.source) ?? '');
        if (source === null) return null;
        return { kind: 'code', source, language: str(props.language), diff: props.format === 'diff', truncate: props.wrap === 'truncate-end' };
      }
      case 'Markdown': {
        const md = text(str(props.text) ?? '');
        if (md === null) return null;
        const links = Array.isArray(props.pressableLinks) ? props.pressableLinks.filter((l): l is string => typeof l === 'string') : null;
        return { kind: 'markdown', text: md, dim: props.dimColor === true, key: str(props.key), press: pressOf(node.press), pressableLinks: links };
      }
      case 'Svg': {
        svgs++;
        if (svgs > limits.svgs) {
          cut ??= 'svgs';
          return null;
        }
        const source = str(props.source);
        if (source !== null && text(source) === null) return null;
        const size = (v: unknown) => (typeof v === 'number' && v > 0 && v <= 4096 ? v : null);
        return { kind: 'svg', source: source === null ? null : sanitizeSvg(source), alt: str(props.alt) ?? '', width: size(props.width), height: size(props.height) };
      }
      case 'Button':
        return {
          kind: 'button',
          key: str(props.key) ?? '',
          label: str(props.label) ?? '',
          dim: props.dimColor === true,
          primary: props.variant === 'primary',
          press: pressOf(node.press),
          children: children(node.children, depth + 1),
        };
      case 'Input': {
        const rows = typeof props.rows === 'number' && Number.isInteger(props.rows) && props.rows > 1 ? Math.min(props.rows, 40) : 1;
        return {
          kind: 'input',
          key: str(props.key) ?? '',
          label: str(props.label),
          placeholder: str(props.placeholder),
          value: str(props.value) ?? '',
          submitLabel: str(props.submitLabel),
          rows,
          press: pressOf(node.press),
        };
      }
      case 'Select': {
        const options = Array.isArray(props.options)
          ? props.options.flatMap((o) => {
              const option = obj(o);
              const value = str(option?.value);
              return value === null ? [] : [{ value, label: str(option?.label) ?? value }];
            })
          : [];
        return { kind: 'select', key: str(props.key) ?? '', label: str(props.label), value: str(props.value), options, press: pressOf(node.press) };
      }
      case 'engine': {
        // One per tree: it marks where the built-in component goes. Any later one is dropped.
        if (engineRef !== null) return null;
        engineRef = Number.isInteger(node.ref) ? (node.ref as number) : 0;
        return { kind: 'engine', ref: engineRef };
      }
      case 'Client':
        // A region a mod's own surface module draws: never run here.
        return null;
      default:
        // An unknown type draws its children, so a newer Claude Code's element degrades instead of vanishing.
        return { kind: 'fragment', children: children(node.children, depth + 1) };
    }
  };

  const top = children(raw, 1);
  return { children: top, cut, engineRef };
}

/** True when nothing in these children draws anything. */
export function isBlank(children: readonly ModChild[]): boolean {
  return children.every((child) => {
    if (typeof child === 'string') return child.trim() === '';
    if (child.kind === 'box' || child.kind === 'text' || child.kind === 'fragment') return isBlank(child.children);
    return child.kind === 'engine';
  });
}

/** One mod's share of a band: its frame shows its name. */
export interface ModPart {
  plugin: string;
  children: ModChild[];
}

/**
 * Splits a drawing into one part per mod, so each sits in its own frame with its name. Claude Code marks the root of
 * each mod's drawing with `part.plugin`; a part inside another mod's part is lifted out into its own. Unmarked drawing
 * belongs to `owner` (the first mod `drawn_by` names). Parts come in `order` (the plugin order), then as they appear.
 * `engine` nodes are left out: a band has no built-in drawing of its own here.
 */
export function splitParts(children: readonly ModChild[], owner: string, order: readonly string[]): ModPart[] {
  const parts = new Map<string, ModChild[]>();
  const add = (plugin: string, child: ModChild) => {
    const list = parts.get(plugin) ?? [];
    list.push(child);
    parts.set(plugin, list);
  };
  const strip = (child: ModChild, current: string): ModChild | null => {
    if (typeof child === 'string') return child;
    if (child.kind === 'engine') return null;
    if ((child.kind === 'box' || child.kind === 'text') && child.part && child.part !== current) {
      add(child.part, { ...child, children: kids(child.children, child.part) });
      return null;
    }
    if (child.kind === 'box' || child.kind === 'text' || child.kind === 'fragment') return { ...child, children: kids(child.children, current) };
    return child;
  };
  const kids = (list: readonly ModChild[], current: string) => list.flatMap((c) => strip(c, current) ?? []);
  // The owner's own drawing goes first in the map, so it keeps its place when nothing says otherwise.
  parts.set(owner, []);
  for (const child of children) {
    const kept = strip(child, owner);
    if (kept !== null) add(owner, kept);
  }
  const rank = (plugin: string) => {
    const at = order.indexOf(plugin);
    return at < 0 ? order.length : at;
  };
  return [...parts]
    .map(([plugin, list]) => ({ plugin, children: list }))
    .filter((part) => !isBlank(part.children))
    .map((part, index) => ({ part, index }))
    .sort((a, b) => rank(a.part.plugin) - rank(b.part.plugin) || a.index - b.index)
    .map(({ part }) => part);
}
