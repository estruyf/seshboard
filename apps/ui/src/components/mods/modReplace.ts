import type { HookableComponent } from '@seshboard/protocol/client';
import type { RenderItem } from '../transcript/displayItems.ts';

/**
 * Which built-in component a transcript item is, for a mod that replaces it: the component, the instance id Claude
 * Code knows it by (a tool call's id, a message's key) and the plain props sent to the mod. Pure, so it can be tested.
 */
export interface Replaceable {
  component: HookableComponent;
  instanceId: string;
  props: Record<string, unknown>;
}

/** Claude Code caps a tool's output at 64 KB before a mod sees it; less crosses here. */
const OUTPUT_MAX = 64 * 1024;
const clip = (text: string) => (text.length > OUTPUT_MAX ? text.slice(0, OUTPUT_MAX) : text);

/** The component a mod could draw for this item, given what mods replace in the session; null when none. */
export function replaceableOf(item: RenderItem, hooked: readonly HookableComponent[]): Replaceable | null {
  if (hooked.length === 0) return null;
  const has = (c: HookableComponent) => hooked.includes(c);
  switch (item.kind) {
    case 'activity':
      return has('ToolGroup')
        ? { component: 'ToolGroup', instanceId: item.key, props: { calls: item.items.flatMap((i) => (i.kind === 'tool' ? [i.id] : [])) } }
        : null;
    case 'user':
      return has('UserMessage') && !item.subagent ? { component: 'UserMessage', instanceId: item.key, props: { text: item.text } } : null;
    case 'text':
      return has('AssistantMessage') && !item.subagent ? { component: 'AssistantMessage', instanceId: item.key, props: { text: item.text, isSummary: false } } : null;
    case 'command':
      return has('CommandOutput') ? { component: 'CommandOutput', instanceId: item.key, props: { command: item.name, args: item.args } } : null;
    case 'tool': {
      if (item.name === 'AskUserQuestion' && has('AskUserQuestion')) {
        const questions = (item.input as { questions?: unknown } | null)?.questions;
        return { component: 'AskUserQuestion', instanceId: item.id, props: { tool_use_id: item.id, questions: Array.isArray(questions) ? questions : [] } };
      }
      const output = item.result ? clip(item.result.text) : null;
      if (has('ToolUse')) return { component: 'ToolUse', instanceId: item.id, props: { tool_use_id: item.id, name: item.name, input: item.input ?? {}, output, isError: item.result?.isError ?? false } };
      if (has('ToolResult') && item.result) return { component: 'ToolResult', instanceId: item.id, props: { tool_use_id: item.id, output, isError: item.result.isError } };
      return null;
    }
    default:
      return null;
  }
}

/** The header of a replaced item's frame: "Drawn by agent-watch · replaces ToolUse". */
export function drawnByLine(drawnBy: readonly string[], component: HookableComponent): string {
  return `Drawn by ${drawnBy.join(', ')} · replaces ${component}`;
}
