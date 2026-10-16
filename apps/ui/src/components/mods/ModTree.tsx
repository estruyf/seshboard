import { createContext, Fragment, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { MOD_LIMITS, type ModComponent } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { Select } from '../ui/Select.tsx';
import { CodeBlock } from '../transcript/CodeBlock.tsx';
import { Markdown } from '../transcript/Markdown.tsx';
import { boxStyle, DEFAULT_CELLS, textStyle, type CellMetrics } from './modLayout.ts';
import { svgDataUrl } from './modSvg.ts';
import type { ModChild, ModNode, ModPressRef } from './modTree.ts';

/** Where a tree is drawn: what its controls name when they send something back, and what the `engine` node draws. */
export interface ModDrawing {
  sessionId: string;
  component: ModComponent;
  instanceId: string;
  metrics: CellMetrics;
  /** The frame's background, for lifting hex colours to 4.5:1. */
  background: string;
  /** The built-in component, where the mod's `engine` node sits. */
  engine?: ReactNode;
  /** A press, input or select failed (Claude Code didn't answer): the frame says so. */
  onError?(error: unknown): void;
}

const DrawingContext = createContext<ModDrawing>({ sessionId: '', component: 'AbovePrompt', instanceId: '', metrics: DEFAULT_CELLS, background: '#000000' });

/** Sends what a control did back to the mod (through Claude Code). */
function useSend() {
  const connection = useEngineConnection();
  const drawing = useContext(DrawingContext);
  const client = connection.status === 'connected' ? connection.client : null;
  return {
    drawing,
    press: (press: ModPressRef, key: string | null, href?: string) => {
      if (!client) return;
      client
        .call('mods.press', { sessionId: drawing.sessionId, plugin: press.plugin, handle: press.handle, ...(key ? { key } : {}), ...(href ? { href } : {}) })
        .catch((error: unknown) => drawing.onError?.(error));
    },
    input: (press: ModPressRef, key: string, kind: 'change' | 'submit', value: string) => {
      if (!client) return;
      client
        .call('mods.input', { sessionId: drawing.sessionId, plugin: press.plugin, handle: press.handle, kind, value, key, component: drawing.component, instanceId: drawing.instanceId })
        .catch((error: unknown) => drawing.onError?.(error));
    },
    select: (press: ModPressRef, key: string, value: string) => {
      if (!client) return;
      client
        .call('mods.select', { sessionId: drawing.sessionId, plugin: press.plugin, handle: press.handle, value, key, component: drawing.component, instanceId: drawing.instanceId })
        .catch((error: unknown) => drawing.onError?.(error));
    },
  };
}

/** Draws a prepared tree. Every control is a real button, field or list, so the keyboard and screen readers work. */
export function ModTree({ drawing, children }: { drawing: ModDrawing; children: readonly ModChild[] }) {
  return (
    <DrawingContext.Provider value={drawing}>
      <Children list={children} />
    </DrawingContext.Provider>
  );
}

function Children({ list, inText = false }: { list: readonly ModChild[]; inText?: boolean }) {
  return (
    <>
      {list.map((child, i) =>
        typeof child === 'string' ? (
          // Ink wraps a string in a Box in a Text; here it is a span that keeps its spaces and line breaks.
          inText ? <Fragment key={i}>{child}</Fragment> : <span key={i} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{child}</span>
        ) : (
          <Node key={i} node={child} inText={inText} />
        ),
      )}
    </>
  );
}

function Node({ node, inText }: { node: ModNode; inText: boolean }) {
  const { drawing, press } = useSend();
  const { metrics, background } = drawing;
  switch (node.kind) {
    case 'box':
      return (
        <div style={boxStyle(node.props, metrics, background)} data-mod-key={typeof node.props.key === 'string' ? node.props.key : undefined}>
          <Children list={node.children} />
        </div>
      );
    case 'text':
      return (
        <span style={{ ...textStyle(node.props, background), ...(inText ? {} : { display: 'block', minWidth: 0 }) }}>
          <Children list={node.children} inText />
        </span>
      );
    case 'fragment':
      return <Children list={node.children} inText={inText} />;
    case 'link': {
      const label = node.children.length ? <Children list={node.children} inText /> : (node.label ?? node.href ?? '');
      // Main opens http and https links in the browser and nothing else; an unsafe one is only text.
      return node.href ? (
        <a href={node.href} target="_blank" rel="noreferrer noopener" className="rounded-sm text-link underline decoration-link/40 underline-offset-2 hover:decoration-link focus-visible:outline-2 focus-visible:outline-focus-ring">
          {label}
        </a>
      ) : (
        <span>{label}</span>
      );
    }
    case 'code':
      return (
        <div className={`min-w-0 ${node.truncate ? '[&_pre]:whitespace-pre [&_pre]:overflow-hidden' : ''}`}>
          <CodeBlock code={node.source} language={node.diff ? 'diff' : (node.language ?? undefined)} />
        </div>
      );
    case 'markdown':
      return <ModMarkdown node={node} />;
    case 'svg':
      return node.source ? (
        <img src={svgDataUrl(node.source)} alt={node.alt} width={node.width ?? undefined} height={node.height ?? undefined} className="inline-block max-w-full" draggable={false} />
      ) : (
        <span className="text-faint">{node.alt}</span>
      );
    case 'button':
      return (
        <Button
          size="sm"
          variant={node.primary ? 'primary' : 'secondary'}
          disabled={!node.press}
          onClick={() => node.press && press(node.press, node.key)}
          className={node.dim ? 'opacity-70' : ''}
          data-mod-button={node.key}
        >
          {node.children.length ? <Children list={node.children} inText /> : node.label}
        </Button>
      );
    case 'input':
      return <ModInput node={node} />;
    case 'select':
      return <ModSelect node={node} />;
    case 'engine':
      return <>{drawing.engine ?? null}</>;
  }
}

/** Markdown through the conversation's renderer (no raw HTML). A mod that answers its links gets the click instead. */
function ModMarkdown({ node }: { node: Extract<ModNode, { kind: 'markdown' }> }) {
  const { press } = useSend();
  const onClick = (event: MouseEvent) => {
    if (!node.press) return;
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href || href.length > MOD_LIMITS.href) return;
    if (node.pressableLinks && !node.pressableLinks.includes(href)) return;
    event.preventDefault();
    press(node.press, node.key, href);
  };
  return (
    <div className={`min-w-0 text-body ${node.dim ? 'opacity-60' : ''}`} onClickCapture={onClick}>
      <Markdown text={node.text} />
    </div>
  );
}

/** How long typing settles before a change goes to the mod. */
const INPUT_SETTLE_MS = 250;

function ModInput({ node }: { node: Extract<ModNode, { kind: 'input' }> }) {
  const { input } = useSend();
  const [value, setValue] = useState(node.value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A new drawing with another value replaces what is typed.
  useEffect(() => setValue(node.value), [node.value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (next: string) => {
    setValue(next);
    clearTimeout(timer.current);
    if (node.press) timer.current = setTimeout(() => input(node.press!, node.key, 'change', next), INPUT_SETTLE_MS);
  };
  const submit = () => {
    clearTimeout(timer.current);
    if (node.press) input(node.press, node.key, 'submit', value);
  };
  const common = {
    value,
    disabled: !node.press,
    placeholder: node.placeholder ?? undefined,
    'aria-label': node.label ?? node.placeholder ?? 'Text field',
    maxLength: MOD_LIMITS.inputChars,
    className: 'min-w-0 flex-1 rounded-md border border-edge bg-bg px-2 py-1 text-ui text-text outline-none placeholder:text-faint focus-visible:border-accent-ink focus-visible:ring-2 focus-visible:ring-focus-ring/40',
    'data-mod-input': node.key,
  };
  return (
    <label className="flex min-w-0 items-center gap-2 text-ui">
      {node.label && <span className="shrink-0 text-muted">{node.label}</span>}
      {node.rows > 1 ? (
        <textarea
          {...common}
          rows={node.rows}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter types the newline.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className={`${common.className} resize-none`}
        />
      ) : (
        <input
          {...common}
          type="text"
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      )}
      {node.submitLabel && (
        <Button size="sm" onClick={submit} disabled={!node.press}>
          {node.submitLabel}
        </Button>
      )}
    </label>
  );
}

function ModSelect({ node }: { node: Extract<ModNode, { kind: 'select' }> }) {
  const { select } = useSend();
  const [value, setValue] = useState(node.value ?? node.options[0]?.value ?? '');
  useEffect(() => setValue(node.value ?? node.options[0]?.value ?? ''), [node.value, node.options]);
  if (node.options.length === 0) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-ui">
      {node.label && <span className="shrink-0 text-muted">{node.label}</span>}
      <Select
        value={value}
        options={node.options}
        label={node.label ?? 'Choose'}
        disabled={!node.press}
        onChange={(next) => {
          setValue(next);
          if (node.press) select(node.press, node.key, next);
        }}
        dataAttrs={{ 'data-mod-select': node.key }}
      />
    </span>
  );
}

/** The quiet line that ends a cut tree. */
export function CutNote({ text }: { text: string }) {
  return <p className="mt-1.5 border-t border-dashed border-border pt-1.5 text-meta text-muted" data-mod-cut>{text}</p>;
}

