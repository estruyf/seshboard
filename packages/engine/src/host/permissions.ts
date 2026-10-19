import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

const DESTINATION: Record<string, string> = {
  session: 'for this session',
  localSettings: 'in this project (just you)',
  projectSettings: 'in this project (shared)',
  userSettings: 'everywhere',
  cliArg: 'for this session',
};

const MODE: Record<string, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  auto: 'Auto mode',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions',
};

const rule = (r: { toolName: string; ruleContent?: string }) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName);

/**
 * Describes Claude Code's "always allow" suggestions in words, so the button
 * says exactly what it will change. Returns null when nothing is offered.
 */
export function describeSuggestions(suggestions: readonly PermissionUpdate[] | undefined): string | null {
  if (!suggestions?.length) return null;
  const parts = suggestions.flatMap((update): string[] => {
    const where = DESTINATION[update.destination] ?? '';
    switch (update.type) {
      case 'addRules':
      case 'replaceRules': {
        const verb = update.behavior === 'allow' ? 'Allow' : update.behavior === 'deny' ? 'Deny' : 'Ask for';
        return [`${verb} ${update.rules.map(rule).join(', ')} ${where}`.trim()];
      }
      case 'setMode':
        return [`Switch to ${MODE[update.mode] ?? update.mode} ${where}`.trim()];
      case 'addDirectories':
        return [`Allow access to ${update.directories.join(', ')} ${where}`.trim()];
      default:
        return [];
    }
  });
  return parts.length ? parts.join('; ') : null;
}

/** Tools that ask the person something rather than for permission: no mode answers them. */
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/**
 * Whether a prompt that is already waiting should go back to Claude Code after the mode changed to `mode`.
 * Claude Code decides a tool call's permission once, when it asks, so a prompt asked before the change keeps
 * waiting even when the new mode would have let it run. Sent back, the call is checked again under the new mode.
 * Only for modes that ask less (Accept edits only for edits); a prompt a user's ask rule forced stays.
 */
export function recheckAfterModeChange(prompt: { toolName: string; matchedAskRule: boolean }, mode: string): boolean {
  if (QUESTION_TOOLS.has(prompt.toolName) || prompt.matchedAskRule) return false;
  if (mode === 'acceptEdits') return EDIT_TOOLS.has(prompt.toolName);
  return mode === 'auto' || mode === 'dontAsk' || mode === 'bypassPermissions';
}

/** What Claude reads for a prompt sent back after a mode change, so it makes the same call again. */
export const RECHECK_MESSAGE = 'The permission mode changed while this tool call waited for an answer, so it did not run. Make the same tool call again, unchanged.';
