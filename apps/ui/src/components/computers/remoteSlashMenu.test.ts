import { describe, expect, it } from 'vitest';
import type { SavedPrompt, SlashCommand } from '@seshboard/protocol/client';
import { remoteSlashItems, withCommand } from './remoteSlashMenu.ts';

const prompt = (name: string, text = 'Some text'): SavedPrompt => ({ id: name, name, text, scope: { kind: 'global' }, createdAt: 0, updatedAt: 0, uses: 0, lastUsedAt: null });
const command = (name: string, description = ''): SlashCommand => ({ name, description, argumentHint: '' });

describe('remoteSlashItems', () => {
  it('lists saved prompts first, then the session’s skills and commands', () => {
    const items = remoteSlashItems('', [prompt('Review')], [command('productive-tasks'), command('compact')]);
    expect(items.map((i) => (i.kind === 'prompt' ? i.prompt.name : i.command.name))).toEqual(['Review', 'compact', 'productive-tasks']);
  });

  it('matches a typed skill by its name', () => {
    const items = remoteSlashItems('produ', [prompt('Deploy')], [command('compact'), command('productive-tasks', 'Fetch tasks')]);
    expect(items).toEqual([{ kind: 'command', command: command('productive-tasks', 'Fetch tasks') }]);
  });

  it('finds a plugin skill by the part after its plugin’s name', () => {
    const items = remoteSlashItems('docs', [], [command('anthropic-skills:docs')]);
    expect(items.map((i) => i.kind === 'command' && i.command.name)).toEqual(['anthropic-skills:docs']);
  });

  it('lists nothing without a match', () => {
    expect(remoteSlashItems('zzz', [prompt('Review')], [command('compact')])).toEqual([]);
  });
});

describe('withCommand', () => {
  it('puts the command in place of what was typed, with a space for its arguments', () => {
    expect(withCommand('/prod', 0, 5, 'productive-tasks')).toEqual({ text: '/productive-tasks ', caret: 18 });
  });

  it('keeps the text around it', () => {
    expect(withCommand('first /rev then', 6, 10, 'review')).toEqual({ text: 'first /review then', caret: 14 });
  });
});
