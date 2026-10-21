import { Copy, MessageCircleQuestion, TextQuote } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LiveSession } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { openAsk } from '../../state/askStore.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useReadMode } from '../../state/readModeStore.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { fitSidebar } from '../../state/sidebarWidth.ts';
import { Markdown, StreamingMarkdown } from '../transcript/Markdown.tsx';
import { currentHeading, STREAMING_BLOCK, type ReadReply } from '../transcript/readReply.ts';
import { TranscriptItem } from '../transcript/TranscriptItem.tsx';
import { overlayOpen } from '../../lib/modalGuards.ts';
import { SelectionToolbar, useSelectionChip } from '../memory/SelectionToolbar.tsx';
import { Button } from '../ui/Button.tsx';
import { askPrefill } from './askQuote.ts';
import { readModeKey } from './readKeys.ts';
import { ReadNeedsYou } from './ReadNeedsYou.tsx';
import { ReadOutline } from './ReadOutline.tsx';
import { READ_SIZES, READ_WIDTHS, stepSize, type ReadFont } from './readPrefs.ts';
import { ReadSidebar } from './ReadSidebar.tsx';
import { ReadTopBar } from './ReadTopBar.tsx';

const FONT_FAMILY: Record<ReadFont, string> = {
  serif: "Charter, 'Iowan Old Style', Georgia, serif",
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
};

/** Where a selection can be quoted from: the reply's column. */
const SELECTABLE = '[data-read-column]';

/** Headings that are the top level of a text block's Markdown: the ones the outline lists (a `#` in a code preview is not). */
const HEADINGS = '[data-read-text] > .markdown > :is(h1, h2, h3)';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The selection text of a selection inside `root`, or ''. */
function selectedIn(root: HTMLElement | null): string {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  return text && root && selection?.anchorNode && root.contains(selection.anchorNode) ? text : '';
}

/** A field the reader is typing in: the reading keys leave it alone. */
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * One reply, full window, on the paper colours: the session's own renderer for the text, an outline of its headings,
 * and the tool calls folded into one line (or shown in place). It is drawn by the session view, through a portal, so
 * it has the same message actions, file links and tool components as the conversation under it, which stays mounted
 * and keeps its scroll.
 */
export function ReadMode({ sessionId, title, live, cwd, reply }: { sessionId: string; title: string; live: LiveSession | null; cwd: string | null; reply: ReadReply }) {
  const prefs = useReadMode((s) => s.prefs);
  const go = useReadMode((s) => s.go);
  const close = useReadMode((s) => s.close);
  const sidebar = useReadMode((s) => s.sidebar);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const scroller = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(-1);
  const writing = reply.blocks.some((b) => b.key === STREAMING_BLOCK);
  const copyText = useMemo(() => reply.blocks.flatMap((b) => (b.kind === 'text' ? [b.text] : [])).join('\n\n'), [reply.blocks]);
  const hasTools = reply.tools.length > 0;

  // Headings get their ids from the outline, by order, so the outline links and the scroll tracking find them.
  const headings = useCallback(() => Array.from(scroller.current?.querySelectorAll<HTMLElement>(HEADINGS) ?? []), []);
  useLayoutEffect(() => {
    headings().forEach((el, i) => {
      const entry = reply.outline[i];
      if (entry) el.id = entry.id;
      else el.removeAttribute('id');
    });
  });

  // Progress along the column and the heading the reader is at.
  const track = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const range = el.scrollHeight - el.clientHeight;
    if (progress.current) progress.current.style.width = `${range > 0 ? Math.min(100, Math.max(0, (el.scrollTop / range) * 100)) : 0}%`;
    const top = el.getBoundingClientRect().top;
    const tops = headings().map((h) => h.getBoundingClientRect().top - top + el.scrollTop);
    setCurrent(currentHeading(tops, el.scrollTop));
  }, [headings]);
  useLayoutEffect(track, [track, reply, prefs]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(track);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [track]);

  // Another reply starts at its top.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [reply.turnKey]);

  // Focus goes to the text on open, so the keys scroll it. On close the session view puts it back (the reply's Read button).
  useEffect(() => {
    scroller.current?.focus({ preventScroll: true });
  }, []);

  // Esc leaves, before anything behind gets it (the message box would stop Claude). An open dialog or menu takes it first,
  // then the selection toolbar (it closes and keeps the selection), and the session list closes before reading mode does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || overlayOpen()) return;
      const state = useReadMode.getState();
      if (!state.sidebar) {
        const toolbar = document.querySelector('[data-read-selection]');
        const focused = document.activeElement;
        if (toolbar && (toolbar.contains(focused) || !focused || focused === document.body || scroller.current?.contains(focused))) return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.sidebar) state.toggleSidebar();
      else state.close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // The window's buttons sit at the top left, over the bar. The rail moves them; put them back when it shows.
  useEffect(() => {
    window.switchboard?.setWindowButtons?.('default');
    return () => {
      const { state, width, viewport } = useSidebar.getState();
      window.switchboard?.setWindowButtons?.(fitSidebar(state, width, viewport).state === 'minimal' ? 'rail' : 'default');
    };
  }, []);

  // The heading the next J or K goes from; it follows the scroll, and a jump moves it at once so quick presses keep stepping.
  const at = useRef(-1);
  at.current = current;
  const jump = (index: number) => {
    at.current = index;
    headings()[index]?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  const { chip, toolbarRef, hide } = useSelectionChip(scroller, SELECTABLE);
  const quote = (text: string) => {
    hide();
    close('elsewhere');
    // After the view behind is reachable again, so the message box can take the caret.
    setTimeout(() => useDrafts.getState().requestQuote(sessionId, text));
  };
  const ask = (text: string) => {
    hide();
    close('elsewhere');
    setTimeout(() => void openAsk(client, sessionId, true, askPrefill(text)));
  };

  // The reading keys (registry: read.*). They wait while the reader types, a menu or dialog is open, or the session list is.
  const latest = useRef({ reply, jump, headingCount: 0, quote });
  latest.current = { reply, jump, headingCount: reply.outline.length, quote };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = useReadMode.getState();
      const action = readModeKey(event, {
        typing: isTyping(event.target),
        inToolbar: event.target instanceof Element && !!event.target.closest('[role="toolbar"]'),
        overlay: overlayOpen(),
        sidebar: state.sidebar,
        selection: !!selectedIn(scroller.current),
      });
      if (!action) return;
      const l = latest.current;
      event.preventDefault();
      if (action === 'previous') {
        if (l.reply.previous) state.go(l.reply.previous);
      } else if (action === 'next') {
        if (l.reply.next) state.go(l.reply.next);
      } else if (action === 'next-heading') {
        if (l.headingCount > 0) l.jump(Math.min(l.headingCount - 1, at.current + 1));
      } else if (action === 'previous-heading') {
        if (at.current > 0) l.jump(at.current - 1);
        else scroller.current?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      } else if (action === 'reply') {
        l.quote(selectedIn(scroller.current));
      } else {
        state.setPrefs({ size: stepSize(state.prefs.size, action === 'bigger' ? 1 : -1) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [toolsShown, setToolsShown] = useState(prefs.showTools);
  useEffect(() => setToolsShown(prefs.showTools), [prefs.showTools]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper text-paper-text">
      <main className="flex min-h-0 flex-1 flex-col" inert={sidebar} aria-label={`Reading: ${title}, reply ${reply.index + 1} of ${reply.total}`} data-read-mode data-session-id={sessionId}>
        <div className="relative shrink-0">
          <ReadTopBar title={title} live={live} writing={writing} index={reply.index} total={reply.total} previous={reply.previous} next={reply.next} copyText={copyText} onGo={go} onClose={close} />
          <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5" aria-hidden data-read-progress>
            <div ref={progress} className="h-full bg-accent" style={{ width: 0 }} />
          </div>
        </div>
        <ReadNeedsYou sessionId={sessionId} />
        <div className="flex min-h-0 flex-1">
          <ReadOutline outline={reply.outline} current={current} tools={reply.tools.length} words={reply.words} minutes={reply.minutes} onJump={jump} />
          <div ref={scroller} onScroll={track} tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none" data-read-scroll>
            <div
              className="mx-auto px-6 pt-10 pb-32"
              style={{ maxWidth: READ_WIDTHS[prefs.width] + 48, fontFamily: FONT_FAMILY[prefs.font], fontSize: READ_SIZES[prefs.size] }}
              data-read-column
            >
              {hasTools && (
                <div className="mb-6 flex items-center gap-2 font-sans text-ui text-muted" data-read-tools>
                  <span className="min-w-0 flex-1">
                    <span className="tabular-nums">{reply.tools.length === 1 ? '1 tool used' : `${reply.tools.length} tools used`}</span>
                    {reply.toolSummary && <> · {reply.toolSummary}</>}
                  </span>
                  <Button variant="quiet" size="sm" aria-expanded={toolsShown} onClick={() => setToolsShown((v) => !v)} data-read-tools-toggle>
                    {toolsShown ? 'Hide' : 'Show'}
                  </Button>
                </div>
              )}
              {reply.blocks.map((block) =>
                block.kind === 'text' ? (
                  <div key={block.key} data-read-text data-block={block.key}>
                    {block.key === STREAMING_BLOCK ? <StreamingMarkdown text={block.text} variant="reading" /> : <Markdown text={block.text} variant="reading" />}
                  </div>
                ) : toolsShown ? (
                  <div key={block.key} className="my-4 font-sans text-body leading-normal" data-read-tool-block>
                    {block.items.map((item) => (
                      <div key={item.key} className="py-1">
                        <TranscriptItem item={item} cwd={cwd} sessionId={sessionId} />
                      </div>
                    ))}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        </div>
      </main>
      {sidebar && <ReadSidebar onClose={() => useReadMode.getState().toggleSidebar()} />}
      {chip && (
        <SelectionToolbar
          key={`${chip.first.left},${chip.first.top},${chip.text.length}`}
          anchor={chip}
          toolbarRef={toolbarRef}
          container={scroller}
          onClose={hide}
          hook="data-read-selection"
          actions={[
            { label: 'Reply with quote', icon: <TextQuote size={13} aria-hidden />, tooltip: 'Close reading mode and quote it in the message box', onSelect: () => quote(chip.text), data: { 'data-read-quote': true } },
            { label: 'Copy', icon: <Copy size={13} aria-hidden />, tooltip: 'Copy', copy: true, data: { 'data-read-copy-selection': true } },
            { label: 'Ask about this', icon: <MessageCircleQuestion size={13} aria-hidden />, tooltip: 'Close reading mode and ask about it', separated: true, onSelect: () => ask(chip.text), data: { 'data-read-ask': true } },
          ]}
        />
      )}
    </div>
  );
}
