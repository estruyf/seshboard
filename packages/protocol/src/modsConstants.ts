/**
 * Claude Code mods: plugins that draw UI (bands, panes, statuses, toasts, replaced parts of the session). Claude Code
 * loads and runs them; Seshboard relays requests and draws the tree it gets back. Plain values, no zod, so the
 * renderer can import them (see docs/mods.md).
 */

/** Every component a mod can draw into or replace. */
export const MOD_COMPONENTS = [
  'AbovePrompt',
  'Pane',
  'AskUserQuestion',
  'UserMessage',
  'AssistantMessage',
  'ToolUse',
  'ToolResult',
  'ToolGroup',
  'CommandOutput',
  'Spinner',
] as const;
export type ModComponent = (typeof MOD_COMPONENTS)[number];

/** The built-in components a mod can replace (`ui_hooked_v1:<Component>`). */
export const HOOKABLE_COMPONENTS = ['AskUserQuestion', 'UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput', 'Spinner'] as const;
export type HookableComponent = (typeof HOOKABLE_COMPONENTS)[number];

/** Capabilities in Claude Code's initialize result. */
export const MOD_CAPABILITY = {
  surface: 'ui_surface_v1',
  hooked: 'ui_hooked_v1',
  promptsScreened: 'prompts_screened_v1',
} as const;

/** The instance id Claude Code gives the band above the message box. */
export const ABOVE_PROMPT_INSTANCE = 'above-prompt';

/** The limits Claude Code's own surfaces keep to (the VS Code extension's). */
export const MOD_LIMITS = {
  /** `props` of a render request, as JSON. */
  propsBytes: 512 * 1024,
  /** Keyed element positions sent with a scroll or render. */
  keyed: 512,
  /** An Input's value. */
  inputChars: 16_384,
  href: 2_048,
  /** Plugin names, handles' keys, instance and pane ids. */
  idChars: 256,
  /** Every request to Claude Code. */
  requestMs: 30_000,
  /** A toast without its own timeout. */
  toastMs: 4_000,
  /** Toasts kept per session. */
  toasts: 20,
  /** Log lines kept per session. */
  logs: 200,
} as const;

/** What a tree may hold before it is cut. */
export const MOD_TREE_LIMITS = {
  nodes: 2_000,
  paneNodes: 10_000,
  depth: 32,
  textBytes: 256 * 1024,
  svgs: 250,
} as const;
