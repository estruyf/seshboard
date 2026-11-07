import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelOption, PermissionMode, ProviderMode } from '@seshboard/protocol';
import type { DriverStatus } from '../provider.ts';
import type { AcpToolCall } from '../acp/acpTypes.ts';
import type { GeminiBinary } from './geminiBinary.ts';
import { geminiTool, promptText } from './geminiMessages.ts';
import type { GeminiConversation } from './geminiRecords.ts';

/**
 * Seshboard's modes for a Gemini session, named as Claude Code's, and Gemini CLI's approval mode for each
 * (`session/set_mode`): `default` asks before anything that writes or runs, `autoEdit` applies edits, `plan` only reads
 * and plans, and `yolo` approves every tool.
 */
export const GEMINI_MODES: ProviderMode[] = [
  { value: 'default', label: 'Ask before edits', description: 'Approve every edit and command' },
  { value: 'acceptEdits', label: 'Accept edits', description: 'Edits apply, commands still ask' },
  { value: 'plan', label: 'Plan mode', description: 'Gemini reads and plans before it changes anything' },
  { value: 'auto', label: 'Auto mode', description: 'Gemini approves every tool itself (its YOLO mode)' },
];

const MODE_IDS: Record<'default' | 'acceptEdits' | 'plan' | 'auto', string> = { default: 'default', acceptEdits: 'autoEdit', plan: 'plan', auto: 'yolo' };

/**
 * Gemini CLI's approval mode for one of Seshboard's. A read-only session (a pipeline's read-only step) is `default`
 * whatever its mode, so every tool that writes or runs asks, and the host answers with the read-only rule. A mode
 * Gemini has no row for (Claude Code's `dontAsk`, `bypassPermissions`) is Ask before edits.
 */
export function geminiModeId(mode: PermissionMode, readOnly = false): string {
  if (readOnly) return MODE_IDS.default;
  return mode in MODE_IDS ? MODE_IDS[mode as keyof typeof MODE_IDS] : MODE_IDS.default;
}

/**
 * The models New session offers before a session said which the account has (Gemini CLI's own list for a login
 * without preview models): its Auto first, which picks per request.
 */
export const GEMINI_DEFAULT_MODELS: ModelOption[] = [
  { value: 'auto', displayName: 'Auto', description: 'Gemini CLI picks the model for each request', supportsEffort: false },
  { value: 'gemini-2.5-pro', displayName: 'gemini-2.5-pro', description: '', supportsEffort: false },
  { value: 'gemini-2.5-flash', displayName: 'gemini-2.5-flash', description: '', supportsEffort: false },
  { value: 'gemini-2.5-flash-lite', displayName: 'gemini-2.5-flash-lite', description: '', supportsEffort: false },
];

/** What Gemini CLI says over ACP when a session's approval mode changes: not part of a reply. */
export const isModeNote = (text: string): boolean => /^\s*\[MODE_UPDATE\]/.test(text);

/**
 * A tool's own name from the id Gemini gives its call: `<name>-<time>-<n>` from its ACP agent, `<name>_<time>_<n>` from
 * its CLI. Null when the id isn't one of those.
 */
export function geminiToolNameOf(call: Pick<AcpToolCall, 'toolCallId'>): string | null {
  return /^([a-z][a-z0-9_]*?)[-_]\d{10,}[-_]\d+$/.exec(call.toolCallId ?? '')?.[1] ?? null;
}

/**
 * A permission card's tool where Gemini says more than ACP's `kind`: an MCP tool by its `mcp__server__tool` name
 * (Gemini names both in the request's `_meta`), and a tool Claude Code has a card for by its name (Gemini sends no
 * input, so the card shows its title). Null: ACP's own mapping by kind.
 */
export function geminiToolCard(call: AcpToolCall): { toolName: string; input: Record<string, unknown> } | null {
  const meta = call._meta && typeof call._meta === 'object' ? (call._meta as Record<string, { mcp?: { server_name?: unknown; tool_name?: unknown } }>)['gemini-cli']?.mcp : undefined;
  if (meta && typeof meta.server_name === 'string' && typeof meta.tool_name === 'string') return { toolName: `mcp__${meta.server_name}__${meta.tool_name}`, input: call.title ? { description: call.title } : {} };
  // Gemini's kinds already map to Claude Code's (a command, an edit, a read): only the others are named here.
  if (call.kind && call.kind !== 'other' && call.kind !== 'think' && call.kind !== 'switch_mode') return null;
  const name = geminiToolNameOf(call);
  if (!name) return null;
  const tool = geminiTool(name, {});
  return { toolName: tool.name, input: call.title ? { description: call.title } : {} };
}

/**
 * The id Gemini CLI gave a prompt in its file: the last prompt with that text written since it was sent. Gemini writes
 * the prompt as soon as its turn starts, before it calls the model.
 */
export function promptIdIn(conversation: GeminiConversation | null, text: string, since: number): string | null {
  if (!conversation) return null;
  const wanted = text.trim();
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const message = conversation.messages[i]!;
    if (message.type !== 'user') continue;
    const at = message.timestamp ? Date.parse(message.timestamp) : NaN;
    // A second of slack for the clocks of two processes.
    if (Number.isFinite(at) && at < since - 1000) return null;
    if (promptText(message) === wanted || promptText(message).startsWith(wanted)) return message.id;
  }
  return null;
}

/** What Settings › Profiles and New session say when Gemini can't run. */
export const GEMINI_INSTALL = 'Install Gemini CLI to run Gemini sessions here.';
export const GEMINI_SIGN_IN = 'Not signed in to Gemini CLI. Use Sign in on this profile in Settings › Profiles, or run `gemini` and choose how to sign in. Seshboard uses that login.';

/**
 * Whether Gemini CLI is signed in for a profile's folder, and as whom, from what Gemini keeps there without reading a
 * credential: the way to sign in its `settings.json` names (`security.auth.selectedType`), its Google login's file
 * being there (`oauth_creds.json`, never read), and the account it names in `google_accounts.json` (an email, no
 * secret). An API key in the environment counts as signed in, without its value being read. Gemini itself says
 * otherwise when a session starts, if this guessed wrong.
 */
export function geminiSignIn(geminiDir: string, env: Record<string, string | undefined>): { signedIn: boolean; account: string | null } {
  let selected: string | null = null;
  try {
    const settings = JSON.parse(readFileSync(join(geminiDir, 'settings.json'), 'utf8')) as { security?: { auth?: { selectedType?: unknown } }; selectedAuthType?: unknown };
    const type = settings.security?.auth?.selectedType ?? settings.selectedAuthType;
    if (typeof type === 'string' && type) selected = type;
  } catch {}
  let email: string | null = null;
  try {
    const accounts = JSON.parse(readFileSync(join(geminiDir, 'google_accounts.json'), 'utf8')) as { active?: unknown };
    if (typeof accounts.active === 'string' && accounts.active) email = accounts.active;
  } catch {}
  const googleLogin = existsSync(join(geminiDir, 'oauth_creds.json'));
  const apiKey = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  if (selected === 'oauth-personal' || (!selected && googleLogin)) return { signedIn: googleLogin || !!email, account: email };
  if (selected === 'gemini-api-key' || (!selected && apiKey)) return { signedIn: apiKey, account: apiKey ? 'API key' : null };
  // Vertex AI, Cloud Shell, a gateway: Gemini's own business, which a session's start checks.
  if (selected) return { signedIn: true, account: email };
  return { signedIn: false, account: null };
}

/** `status()` for a profile: Gemini CLI found, and signed in. */
export function geminiStatus(binary: GeminiBinary | null, geminiDir: string, env: Record<string, string | undefined>): DriverStatus {
  if (!binary) return { binary: null, version: null, signedIn: false, account: null, login: null, problem: GEMINI_INSTALL };
  const { signedIn, account } = geminiSignIn(geminiDir, env);
  const login = account && account.includes('@') ? account : null;
  return { binary: binary.path, version: binary.version, signedIn, account, login, problem: signedIn ? null : GEMINI_SIGN_IN };
}
