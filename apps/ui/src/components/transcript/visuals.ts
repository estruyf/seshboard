/**
 * Claude's inline visuals (`show_widget`, see `packages/protocol/src/visuals.ts`): what a call holds, the theme a
 * visual's frame gets, and what the frame may ask of the conversation. Pure, for testing; `VisualBlock.tsx` draws them.
 */

/** A `show_widget` call's input. */
export interface Visual {
  /** An HTML fragment, or an SVG. */
  code: string;
  /** A snake_case name (the desktop app's download name); empty when Claude left it out. */
  title: string;
  /** One to four short lines to show while it draws. */
  loading: string[];
  svg: boolean;
}

/** The visual in a call's input, or null when it has no code to draw. */
export function visualOf(input: unknown): Visual | null {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const code = typeof i.widget_code === 'string' ? i.widget_code : '';
  if (!code.trim()) return null;
  const loading = Array.isArray(i.loading_messages) ? i.loading_messages.filter((m): m is string => typeof m === 'string' && m.trim() !== '').slice(0, 4) : [];
  return { code, title: typeof i.title === 'string' ? i.title.trim() : '', loading, svg: /^\s*<svg[\s>]/i.test(code) };
}

/** `monthly_costs` → `Monthly costs`; `Visual` without one. */
export function visualTitle(title: string): string {
  const words = title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Visual';
}

/** Empty when either colour is missing, so it is left out with them. */
const mix = (colour: string, percent: number, base: string) => (colour && base ? `color-mix(in srgb, ${colour} ${percent}%, ${base})` : '');

/**
 * The desktop app's CSS variables, from Seshboard's theme tokens, so a visual looks like the rest of the conversation
 * and follows the theme. `read` gives a variable's value where the frame is (`getComputedStyle(frame)`), which also
 * covers a subtree that swaps the tokens. A token the theme doesn't have is left out.
 */
export function visualThemeVars(read: (variable: string) => string): Record<string, string> {
  const sb = (name: string) => read(`--sb-${name}`).trim();
  const bg = sb('bg');
  const raised = sb('code-bg');
  const text = sb('text');
  const vars: Record<string, string> = {
    '--text-primary': text,
    '--text-secondary': sb('muted'),
    '--text-muted': sb('faint'),
    '--surface-0': bg,
    '--surface-1': raised,
    '--surface-2': mix(text, 8, raised),
    '--border': sb('border'),
    '--border-strong': mix(text, 22, bg),
    '--bg-accent': mix(sb('accent'), 18, bg),
    '--text-accent': sb('accent-ink'),
    '--bg-danger': mix(sb('error'), 14, bg),
    '--text-danger': sb('error'),
    '--bg-success': mix(sb('ok'), 14, bg),
    '--text-success': sb('ok'),
    '--bg-warning': mix(sb('caution'), 14, bg),
    '--text-warning': sb('caution'),
    '--radius': '8px',
    '--font-sans': read('--font-sans').trim(),
    '--font-mono': read('--font-mono').trim(),
    // The SVG colour classes (`c-blue`): the profile colours, and three chart colours for the hues they don't have.
    '--c-gray': sb('profile-gray'),
    '--c-blue': sb('profile-blue'),
    '--c-green': sb('profile-green'),
    '--c-purple': sb('profile-purple'),
    '--c-red': sb('profile-red'),
    '--c-orange': sb('profile-orange'),
    '--c-amber': sb('profile-yellow'),
    '--c-teal': sb('chart-input'),
    '--c-coral': sb('chart-shipped'),
    '--c-pink': sb('chart-cache-write'),
  };
  return Object.fromEntries(Object.entries(vars).filter(([, value]) => value !== ''));
}

/** The tallest a visual grows; anything taller scrolls with the conversation, cut off. */
export const MAX_VISUAL_HEIGHT = 4_000;

/** What a visual's frame says to the conversation. */
export type FrameMessage =
  | { type: 'ready' }
  | { type: 'drawn' | 'height'; height: number }
  | { type: 'prompt'; text: string }
  | { type: 'link'; url: string };

/** A message from a visual's frame, checked: the frame runs Claude's code, so anything else is dropped. */
export function frameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case 'ready':
      return { type: 'ready' };
    case 'drawn':
    case 'height': {
      const height = message.height;
      if (typeof height !== 'number' || !Number.isFinite(height) || height < 0) return null;
      return { type: message.type, height: Math.min(Math.ceil(height), MAX_VISUAL_HEIGHT) };
    }
    case 'prompt': {
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      return text ? { type: 'prompt', text: text.slice(0, 20_000) } : null;
    }
    case 'link': {
      const url = linkToOpen(message.url);
      return url ? { type: 'link', url } : null;
    }
    default:
      return null;
  }
}

/** A link a visual may open in the browser: http and https only. */
export function linkToOpen(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
