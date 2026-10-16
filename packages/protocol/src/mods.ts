import { z } from 'zod';
import { HOOKABLE_COMPONENTS, MOD_COMPONENTS, MOD_LIMITS } from './modsConstants.ts';

export * from './modsConstants.ts';

const SessionId = z.string().min(1).max(200);
const Id = z.string().max(MOD_LIMITS.idChars);
/** Pane ids as Claude Code writes them. */
const PaneId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const ModComponentSchema = z.enum(MOD_COMPONENTS);
export const HookableComponentSchema = z.enum(HOOKABLE_COMPONENTS);
/** The two sites that scroll and take focus. */
export const ModSite = z.enum(['Pane', 'AbovePrompt']);
export type ModSite = z.infer<typeof ModSite>;

/** A session's mods surface: whether Claude Code can draw mods, whether this window is attached, and what they replace. */
export const ModsSurfaceState = z.object({
  sessionId: z.string(),
  /** Claude Code reported `ui_surface_v1`. */
  supported: z.boolean(),
  /** `ui_attach` went through: mods draw in this session. */
  attached: z.boolean(),
  /** Built-in components a mod has replaced (`ui_hooked_v1:<Component>`). */
  hooked: z.array(HookableComponentSchema),
  /** `prompts_screened_v1`: a mod checks prompts before Claude reads them (it happens in Claude Code, so it holds with Show mods off). */
  promptsScreened: z.boolean(),
  /** Mods seen in this session (drew something, set a status or a toast), in the order they were first seen. */
  plugins: z.array(z.string()),
});
export type ModsSurfaceState = z.infer<typeof ModsSurfaceState>;

/** Where an element a mod drew under `key` sits in a site's content, in rows. */
export const ModKeyed = z.object({ plugin: Id, key: Id, top: z.number().int().min(0), bottom: z.number().int().min(0) });
export type ModKeyed = z.infer<typeof ModKeyed>;

export const ModViewport = z.object({ columns: z.number().int().positive(), rows: z.number().int().positive(), isFullscreen: z.boolean().optional() });
export type ModViewport = z.infer<typeof ModViewport>;

/** Props of a render request: plain JSON, at most 512 KB. */
export const ModProps = z
  .record(z.string(), z.unknown())
  .refine((props) => JSON.stringify(props).length <= MOD_LIMITS.propsBytes, `props are larger than ${MOD_LIMITS.propsBytes / 1024} KB`);

export const ModRenderParams = z.object({
  sessionId: SessionId,
  component: ModComponentSchema,
  instanceId: Id,
  props: ModProps,
  viewport: ModViewport.optional(),
  contentRows: z.number().int().min(0).optional(),
  keyed: z.array(ModKeyed).max(MOD_LIMITS.keyed).optional(),
});
export type ModRenderParams = z.infer<typeof ModRenderParams>;

/**
 * What a render returned. `tree` is the mod's drawing as Claude Code validated it, still untrusted: the window checks
 * it again as it draws. `props` are what the `engine` node draws the built-in component with.
 */
export const ModRenderResult = z.object({
  tree: z.unknown(),
  props: z.record(z.string(), z.unknown()),
  rewritten: z.boolean(),
  /** A mod hooks this component at all (false: no need to ask again until the next invalidate). */
  hooked: z.boolean(),
  /** The mods that drew it, in chain order; empty when it is Claude Code's own drawing. */
  drawnBy: z.array(z.string()),
});
export type ModRenderResult = z.infer<typeof ModRenderResult>;

/** A Button or Link press (or a link in a Markdown block whose mod answers its links). */
export const ModPressParams = z.object({
  sessionId: SessionId,
  plugin: Id,
  handle: z.number().int(),
  key: Id.optional(),
  href: z.string().max(MOD_LIMITS.href).optional(),
});
export type ModPressParams = z.infer<typeof ModPressParams>;

export const ModInputParams = z.object({
  sessionId: SessionId,
  plugin: Id,
  handle: z.number().int(),
  kind: z.enum(['change', 'submit']),
  value: z.string().max(MOD_LIMITS.inputChars),
  key: Id.optional(),
  component: ModComponentSchema.optional(),
  instanceId: Id.optional(),
});
export type ModInputParams = z.infer<typeof ModInputParams>;

export const ModSelectParams = z.object({
  sessionId: SessionId,
  plugin: Id,
  handle: z.number().int(),
  value: z.string().max(MOD_LIMITS.inputChars),
  key: Id.optional(),
  component: ModComponentSchema.optional(),
  instanceId: Id.optional(),
});
export type ModSelectParams = z.infer<typeof ModSelectParams>;

export const ModScrollParams = z.object({
  sessionId: SessionId,
  component: ModSite,
  instanceId: Id,
  offset: z.number().int().min(0),
  by: z.number().int(),
  bodyRows: z.number().int().min(0),
  contentRows: z.number().int().min(0),
  pointer: z.object({ column: z.number().int(), row: z.number().int() }).optional(),
  keyed: z.array(ModKeyed).max(MOD_LIMITS.keyed).optional(),
});
export type ModScrollParams = z.infer<typeof ModScrollParams>;

export const ModScrollResult = z.object({ moved: z.boolean(), offset: z.number().int(), deny: z.string().nullable(), followEnd: z.boolean() });
export type ModScrollResult = z.infer<typeof ModScrollResult>;

/** A Button, Input or Select a mod drew. */
export const ModElement = z.object({ plugin: Id, key: Id });
export type ModElement = z.infer<typeof ModElement>;

export const ModFocusParams = z.object({
  sessionId: SessionId,
  component: ModSite,
  instanceId: Id,
  isHeld: z.boolean(),
  element: ModElement.nullable().optional(),
  by: z.enum(['person', 'auto']).optional(),
});
export type ModFocusParams = z.infer<typeof ModFocusParams>;

export const ModFocusResult = z.object({ moved: z.boolean(), element: ModElement.nullable(), deny: z.string().nullable() });
export type ModFocusResult = z.infer<typeof ModFocusResult>;

export const ModPane = z.object({
  id: PaneId,
  plugin: z.string(),
  title: z.string(),
  /** Esc closes it. */
  closeOnEscape: z.boolean(),
  /** Toasts wait while it is shown. */
  holdToasts: z.boolean(),
  rows: z.number().int().nullable(),
  columns: z.number().int().nullable(),
});
export type ModPane = z.infer<typeof ModPane>;

/** The panes mods have open in a session. */
export const ModPaneRoster = z.object({
  panes: z.array(ModPane),
  shownId: z.string().nullable(),
  focusedId: z.string().nullable(),
  /** A mod asked for this pane to take focus (open the panel on its tab). */
  focusRequestedId: z.string().nullable(),
});
export type ModPaneRoster = z.infer<typeof ModPaneRoster>;

export const ModToast = z.object({ id: z.string(), sessionId: z.string(), plugin: z.string(), text: z.string(), timeoutMs: z.number().int(), at: z.number() });
export type ModToast = z.infer<typeof ModToast>;

/** One status per mod. */
export const ModStatus = z.object({ plugin: z.string(), text: z.string() });
export type ModStatus = z.infer<typeof ModStatus>;

export const ModLog = z.object({ sessionId: z.string(), plugin: z.string(), text: z.string(), at: z.number() });
export type ModLog = z.infer<typeof ModLog>;

export const ModInstance = z.object({ component: z.string(), instanceId: z.string() });
export type ModInstance = z.infer<typeof ModInstance>;

/** What a session's mods show right now (for a window that opens it later). */
export const ModsSnapshot = z.object({
  state: ModsSurfaceState,
  statuses: z.array(ModStatus),
  toasts: z.array(ModToast),
  panes: ModPaneRoster,
});
export type ModsSnapshot = z.infer<typeof ModsSnapshot>;

/** Claude Code asks the window showing a session: read, fill or suggest in its message box (fill and suggest never send), or copy. */
export const ModPromptAsk = z.discriminatedUnion('kind', [
  z.object({ requestId: z.string(), sessionId: z.string(), kind: z.literal('read') }),
  z.object({ requestId: z.string(), sessionId: z.string(), kind: z.literal('fill'), text: z.string(), mode: z.enum(['replace', 'append', 'insert']) }),
  z.object({ requestId: z.string(), sessionId: z.string(), kind: z.literal('suggest'), text: z.string() }),
  /** A mod copies text: the window writes it to the clipboard (the engine has none). */
  z.object({ requestId: z.string(), sessionId: z.string(), kind: z.literal('copy'), plugin: z.string(), text: z.string() }),
]);
export type ModPromptAsk = z.infer<typeof ModPromptAsk>;

/** The window's answer: `read` gives the text and caret; `fill`, `suggest` and `copy` whether it was done. */
export const ModPromptAnswer = z.object({
  requestId: z.string().max(100),
  text: z.string().max(1_000_000).optional(),
  cursor: z.number().int().min(0).optional(),
  done: z.boolean().optional(),
});
export type ModPromptAnswer = z.infer<typeof ModPromptAnswer>;

/** Where a mod comes from, for Settings › Mods. */
export const ModSource = z.enum(['personal', 'marketplace', 'managed', 'dir', 'project']);
export type ModSource = z.infer<typeof ModSource>;

/** A plugin with a mod module, per Claude profile (Settings › Mods). */
export const ModInfo = z.object({
  name: z.string(),
  profileId: z.string(),
  source: ModSource,
  /** Its folder, when known. */
  path: z.string().nullable(),
});
export type ModInfo = z.infer<typeof ModInfo>;
