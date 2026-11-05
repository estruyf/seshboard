/** What Claude Code's reasons mean for someone at the message box. Anything else gets `UNAVAILABLE`. */
const BLOCKED: Record<string, string> = {
  credits_exhausted: 'You are out of usage credits, so this session runs at standard speed.',
  extra_usage_disabled: 'Fast mode needs usage credits. Turn them on in your Claude settings.',
  free: 'Fast mode is not included in this plan.',
  preference: 'Your organization has turned off fast mode.',
  model_not_allowed: 'Your organization does not allow the model fast mode uses.',
  not_first_party: 'Fast mode only works with a Claude subscription or the Claude Console.',
  disabled_by_env: 'CLAUDE_CODE_DISABLE_FAST_MODE turns off fast mode here.',
  network_error: 'Claude Code could not check whether fast mode is available.',
};
const UNAVAILABLE = 'Fast mode is not available right now.';

const WHAT_IT_DOES = 'Fast mode runs Opus up to 2.5x faster, at a higher price per token. On a Claude subscription it always bills to usage credits.';
const SWITCH_COST = 'Turning it on now reads this conversation again at the full fast rate, so it costs least at the start of a session.';

export type FastModeLook = 'off' | 'on' | 'cooldown' | 'blocked';

export interface FastModeFace {
  look: FastModeLook;
  /** A click turns it on (otherwise off). */
  next: boolean;
  /** What the toggle is called: its state, for a screen reader. */
  label: string;
  tooltip: string;
}

/** The fast mode toggle: how it looks, what a click does, and what its tooltip says in each state. */
export function fastModeFace(host: { fastMode?: 'off' | 'on' | 'cooldown'; fastModeBlocked?: string | null; contextTokens: number | null }): FastModeFace {
  const asked = host.fastMode === 'on' || host.fastMode === 'cooldown';
  if (host.fastModeBlocked) {
    const reason = BLOCKED[host.fastModeBlocked] ?? UNAVAILABLE;
    return { look: 'blocked', next: !asked, label: 'Fast mode: not available', tooltip: `${reason}\n${asked ? 'Click to turn it off.' : 'Click to try again.'}` };
  }
  if (host.fastMode === 'cooldown') return { look: 'cooldown', next: false, label: 'Fast mode: paused', tooltip: 'Fast mode hit its rate limit, so this session runs at standard speed until it comes back.\nClick to turn it off.' };
  if (host.fastMode === 'on') return { look: 'on', next: false, label: 'Fast mode: on', tooltip: `Fast mode is on. ${WHAT_IT_DOES}\nClick to turn it off.` };
  return { look: 'off', next: true, label: 'Fast mode: off', tooltip: `${WHAT_IT_DOES}${(host.contextTokens ?? 0) > 0 ? `\n${SWITCH_COST}` : ''}\nClick to turn it on for this session.` };
}

/**
 * A typed `/fast`, `/fast on` or `/fast off`: what to set fast mode to (`toggle`: the other way round). Null for anything
 * else, which goes to Claude Code as usual. Claude Code answers that fast mode isn't available in the Agent SDK until
 * a session has asked for it, so the message box handles the command itself.
 */
export function fastCommand(text: string): 'on' | 'off' | 'toggle' | null {
  const match = /^\/fast(?:\s+(on|off))?$/i.exec(text.trim());
  if (!match) return null;
  return match[1] ? (match[1].toLowerCase() as 'on' | 'off') : 'toggle';
}
