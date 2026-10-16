import { describe, expect, it } from 'vitest';
import { modKey } from '@switchboard/protocol/client';
import { bumpVersions, drawsOf, instanceKey, type SessionMods } from '../../state/modsStore.ts';
import { modPaneTab, paneOfTab, readTab, rightPanel } from '../ask/askWidth.ts';
import type { RenderItem } from '../transcript/displayItems.ts';
import { filled } from './modComposer.ts';
import { fitStatuses, screenedBy } from './modFooter.ts';
import { drawnByLine, replaceableOf } from './modReplace.ts';
import { promptStack } from './modStack.ts';
import { modShown, shownMods, withModShown } from './modVisibility.ts';

describe('status chips in the footer', () => {
  const plus = () => 24;

  it('shows two at most, the rest in +N', () => {
    expect(fitStatuses([80, 60, 70], 1000, plus)).toBe(2);
    expect(fitStatuses([80], 1000, plus)).toBe(1);
    expect(fitStatuses([], 1000, plus)).toBe(0);
  });

  it('folds into +N as the room shrinks, never overflowing', () => {
    // Two chips and +1: 80 + 4 + 60 + 4 + 24.
    expect(fitStatuses([80, 60, 70], 172, plus)).toBe(2);
    expect(fitStatuses([80, 60, 70], 171, plus)).toBe(1);
    // One chip and +2: 80 + 4 + 24.
    expect(fitStatuses([80, 60, 70], 108, plus)).toBe(1);
    expect(fitStatuses([80, 60, 70], 107, plus)).toBe(0);
    // Two chips without a +N need no room for it.
    expect(fitStatuses([80, 60], 144, plus)).toBe(2);
  });

  it('names who checks prompts when only one mod could', () => {
    expect(screenedBy(['prompt-guard'])).toBe('prompt-guard');
    expect(screenedBy(['a', 'b'])).toBe('a mod');
  });
});

describe('above the message box', () => {
  it('puts Switchboard’s permission card first, then the bands in plugin order, then Up next', () => {
    expect(promptStack(['req-1'], ['pr-status', 'agent-watch'], ['agent-watch', 'pr-status'], true)).toEqual([
      { kind: 'permission', id: 'req-1' },
      { kind: 'band', plugin: 'agent-watch' },
      { kind: 'band', plugin: 'pr-status' },
      { kind: 'up-next' },
    ]);
    expect(promptStack([], ['x'], [], false)).toEqual([{ kind: 'band', plugin: 'x' }]);
  });
});

describe('Show mods', () => {
  const on = { showMods: true, hiddenMods: [] as string[] };

  it('off hides every mod, and the mods’ own switches keep their state', () => {
    const hidden = withModShown([], 'p', 'pr-status', false);
    expect(hidden).toEqual([modKey('p', 'pr-status')]);
    expect(modShown({ showMods: false, hiddenMods: [] }, 'p', 'agent-watch')).toBe(false);
    expect(shownMods({ showMods: false, hiddenMods: hidden }, 'p', [{ plugin: 'agent-watch' }, { plugin: 'pr-status' }])).toEqual([]);
    // Back on: the switches are as they were.
    expect(shownMods({ showMods: true, hiddenMods: hidden }, 'p', [{ plugin: 'agent-watch' }, { plugin: 'pr-status' }])).toEqual([{ plugin: 'agent-watch' }]);
    expect(withModShown(hidden, 'p', 'pr-status', true)).toEqual([]);
  });

  it('keeps a mod’s switch per profile', () => {
    const hidden = withModShown([], 'work', 'pr-status', false);
    expect(modShown({ ...on, hiddenMods: hidden }, 'work', 'pr-status')).toBe(false);
    expect(modShown({ ...on, hiddenMods: hidden }, 'personal', 'pr-status')).toBe(true);
  });
});

describe('replaced components', () => {
  const tool: RenderItem = { kind: 'tool', key: 'k', at: null, id: 'toolu_1', name: 'Task', input: { prompt: 'x' }, inputTruncated: false, result: { text: 'done', isError: false, truncated: false, images: [], at: null }, subagent: false };

  it('maps transcript items to the components mods replace', () => {
    expect(replaceableOf(tool, ['ToolUse'])).toEqual({ component: 'ToolUse', instanceId: 'toolu_1', props: { tool_use_id: 'toolu_1', name: 'Task', input: { prompt: 'x' }, output: 'done', isError: false } });
    expect(replaceableOf(tool, ['ToolResult'])?.component).toBe('ToolResult');
    expect(replaceableOf(tool, [])).toBeNull();
    expect(replaceableOf({ kind: 'text', key: 'm1', at: null, text: 'hi', subagent: false }, ['AssistantMessage'])).toMatchObject({ component: 'AssistantMessage', instanceId: 'm1' });
    expect(replaceableOf({ kind: 'user', key: 'u1', at: null, text: 'hi', images: [], subagent: false }, ['AssistantMessage'])).toBeNull();
    expect(replaceableOf({ kind: 'activity', key: 'g1', items: [tool] }, ['ToolGroup'])).toEqual({ component: 'ToolGroup', instanceId: 'g1', props: { calls: ['toolu_1'] } });
    const ask: RenderItem = { ...tool, name: 'AskUserQuestion', id: 'toolu_q', input: { questions: [{ question: 'Which?' }] } };
    expect(replaceableOf(ask, ['AskUserQuestion', 'ToolUse'])).toMatchObject({ component: 'AskUserQuestion', props: { questions: [{ question: 'Which?' }] } });
  });

  it('says who drew it and what it replaces', () => {
    expect(drawnByLine(['agent-watch'], 'ToolUse')).toBe('Drawn by agent-watch · replaces ToolUse');
  });
});

describe('the render cache', () => {
  it('draws again only the instances an invalidate lists, or all of them', () => {
    const start = { all: 0, instances: new Map<string, number>() };
    const one = bumpVersions(start, [{ component: 'Pane', instanceId: 'agents' }]);
    expect(one.instances.get(instanceKey('Pane', 'agents'))).toBe(1);
    expect(one.instances.get(instanceKey('AbovePrompt', 'above-prompt'))).toBeUndefined();
    expect(one.all).toBe(0);
    expect(bumpVersions(one, null).all).toBe(1);
  });

  it('lists what a mod draws', () => {
    const mods: SessionMods = {
      state: { sessionId: 's', supported: true, attached: true, hooked: [], promptsScreened: false, plugins: ['agent-watch'] },
      statuses: [{ plugin: 'agent-watch', text: '3/3' }],
      panes: { panes: [{ id: 'agents', plugin: 'agent-watch', title: 'Agents', closeOnEscape: true, holdToasts: false, rows: null, columns: null }], shownId: null, focusedId: null, focusRequestedId: null },
      versions: { all: 0, instances: new Map() },
      draws: new Map([['agent-watch', new Set(['band', 'replaces ToolUse'])]]),
    };
    expect(drawsOf(mods, 'agent-watch')).toEqual(['band', 'pane', 'status', 'replaces ToolUse']);
  });
});

describe('the message box, for Claude Code', () => {
  it('fills without sending: replace, append or at the caret', () => {
    expect(filled('hello', 2, 'X', 'replace')).toEqual({ text: 'X', caret: 1 });
    expect(filled('hello', 2, 'X', 'append')).toEqual({ text: 'helloX', caret: 6 });
    expect(filled('hello', 2, 'X', 'insert')).toEqual({ text: 'heXllo', caret: 3 });
  });
});

describe('pane tabs', () => {
  const none = { changes: false, ask: false, agents: false, terminal: false };

  it('puts mods’ panes after Ask', () => {
    expect(rightPanel({ ...none, changes: true, ask: true, agents: true }, modPaneTab('agents'), ['agents']).open).toEqual(['changes', 'ask', 'mod:agents', 'agents']);
    expect(rightPanel(none, 'changes', ['p1'])).toEqual({ tab: 'mod:p1', tabs: false, open: ['mod:p1'] });
    expect(paneOfTab('mod:p1')).toBe('p1');
    expect(paneOfTab('ask')).toBeNull();
    expect(readTab('mod:agents')).toBe('mod:agents');
    expect(readTab('mod:../x')).toBe('changes');
  });
});
