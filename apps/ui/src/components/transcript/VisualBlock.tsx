import { useEffect, useRef, useState } from 'react';
import { VISUAL_FRAME_URL } from '@seshboard/protocol/client';
import { useDrafts } from '../../state/draftsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useThemes } from '../../state/themeStore.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { frameMessage, visualThemeVars, visualTitle, type Visual } from './visuals.ts';

/**
 * The height each visual drew at, by its tool call: the conversation is virtualised, so a visual scrolled away and back
 * is drawn again, and it keeps its room meanwhile instead of making the rows below jump.
 */
const heights = new Map<string, number>();

/** How long a visual may take to draw (its scripts from a CDN included) before the block says it couldn't. */
const DRAW_LIMIT_MS = 20_000;
/** How long each loading line shows. */
const LOADING_STEP_MS = 1_800;

const darkQuery = () => matchMedia('(prefers-color-scheme: dark)');

function useDark(): boolean {
  const [dark, setDark] = useState(() => darkQuery().matches);
  useEffect(() => {
    const query = darkQuery();
    const change = () => setDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return dark;
}

/**
 * A visual Claude put in its reply (`show_widget`): drawn where Claude made it, between the text, with a Preview |
 * Source switch and Copy, like a Markdown block.
 */
export function VisualBlock({ id, visual, sessionId }: { id: string; visual: Visual; sessionId: string }) {
  const title = visualTitle(visual.title);
  return (
    <div data-visual={id}>
      <CodeBlock code={visual.code} language={visual.svg ? 'svg' : 'html'} label={title} copyLabel="Copy code" preview={<VisualFrame id={id} visual={visual} title={title} sessionId={sessionId} />} />
    </div>
  );
}

type DrawState = 'loading' | 'drawn' | 'failed';

/**
 * The visual's frame: `seshboard-visual://frame/` (served by main), sandboxed with scripts only, so its code can't reach
 * the app. Once the page says it is ready it gets the code and the theme (again whenever the theme changes); it then
 * says how tall it is, and passes on `sendPrompt` (the text goes in the message box, for you to send) and `openLink`.
 */
function VisualFrame({ id, visual, title, sessionId }: { id: string; visual: Visual; title: string; sessionId: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<DrawState>('loading');
  const [height, setHeight] = useState<number | null>(() => heights.get(id) ?? null);
  const ready = useRef(false);
  const dark = useDark();
  const themeKey = usePreferences((s) => `${s.prefs.themeId}:${s.prefs.colorScheme}`);
  const theme = useThemes((s) => s.active);

  const themeNow = () => {
    const frame = ref.current;
    if (!frame) return null;
    const style = getComputedStyle(frame);
    return { vars: visualThemeVars((name) => style.getPropertyValue(name)), scheme: dark ? 'dark' : 'light' };
  };
  const post = (message: object) => ref.current?.contentWindow?.postMessage(message, '*');
  // The latest of each for the message handler, which is added once.
  const latest = useRef({ themeNow, post, code: visual.code, sessionId });
  latest.current = { themeNow, post, code: visual.code, sessionId };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const message = frameMessage(event.data);
      if (!message) return;
      const { themeNow, post, code, sessionId } = latest.current;
      switch (message.type) {
        case 'ready':
          ready.current = true;
          post({ type: 'render', code, theme: themeNow() });
          break;
        case 'drawn':
        case 'height':
          heights.set(id, message.height);
          setHeight(message.height);
          if (message.type === 'drawn') setState('drawn');
          break;
        case 'prompt':
          useDrafts.getState().requestQuote(sessionId, message.text, { plain: true });
          break;
        case 'link':
          // Main opens http(s) links in the browser.
          window.open(message.url, '_blank', 'noopener');
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id]);

  // A new theme, or light and dark: read once the theme's style is applied (the next frame), and redraw with it.
  useEffect(() => {
    if (!ready.current) return;
    const frame = requestAnimationFrame(() => latest.current.post({ type: 'theme', theme: latest.current.themeNow() }));
    return () => cancelAnimationFrame(frame);
  }, [dark, themeKey, theme]);

  useEffect(() => {
    if (state !== 'loading') return;
    const timer = setTimeout(() => setState((s) => (s === 'loading' ? 'failed' : s)), DRAW_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const shown = state === 'drawn';
  return (
    <div className="relative" style={shown ? undefined : { minHeight: heights.get(id) }} data-visual-state={state}>
      {!shown && <DrawStatus failed={state === 'failed'} messages={visual.loading} />}
      <iframe
        ref={ref}
        src={VISUAL_FRAME_URL}
        sandbox="allow-scripts"
        title={title}
        // The frame's page takes the same scheme, so its background stays see-through.
        style={{ height: height ?? 0, colorScheme: dark ? 'dark' : 'light' }}
        className={`block w-full border-0 ${shown ? '' : 'pointer-events-none absolute inset-x-0 top-0 opacity-0'}`}
        tabIndex={shown ? undefined : -1}
        aria-hidden={shown ? undefined : true}
        data-visual-frame=""
      />
    </div>
  );
}

/** While the visual draws: its loading lines, one after another, with a spinner; then why it isn't there. */
function DrawStatus({ failed, messages }: { failed: boolean; messages: readonly string[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (failed || messages.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % messages.length), LOADING_STEP_MS);
    return () => clearInterval(timer);
  }, [failed, messages.length]);
  if (failed)
    return (
      <p className="py-2 text-ui text-muted" role="status" data-visual-failed="">
        Couldn't draw this visual. Its code is under Source.
      </p>
    );
  return (
    <p className="flex items-center gap-2 py-2 text-ui text-muted" role="status" aria-busy="true" data-visual-loading="">
      <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" aria-hidden />
      {messages[index] ?? 'Drawing the visual…'}
    </p>
  );
}
