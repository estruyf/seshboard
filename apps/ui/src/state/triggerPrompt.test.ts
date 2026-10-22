import { describe, expect, it } from 'vitest';
import { fieldQuery, insertField, promptSegments } from './triggerPrompt.ts';

describe('a trigger prompt in the editor', () => {
  it('splits the prompt into text and fields', () => {
    expect(promptSegments('Work on {{event.title}} ({{ event.url }}).')).toEqual([
      { text: 'Work on ', field: null },
      { text: '{{event.title}}', field: 'title' },
      { text: ' (', field: null },
      { text: '{{ event.url }}', field: 'url' },
      { text: ').', field: null },
    ]);
    expect(promptSegments('')).toEqual([{ text: '', field: null }]);
    expect(promptSegments('{{other}} stays text')).toEqual([{ text: '{{other}} stays text', field: null }]);
  });

  it('opens the field list after {{ and narrows it as you type', () => {
    expect(fieldQuery('Fix {{', 6)).toEqual({ start: 4, query: '' });
    expect(fieldQuery('Fix {{event.ti', 14)).toEqual({ start: 4, query: 'ti' });
    expect(fieldQuery('Fix {{ti', 8)).toEqual({ start: 4, query: 'ti' });
    expect(fieldQuery('Fix {{event.title}}', 19)).toBeNull();
    expect(fieldQuery('Fix it', 6)).toBeNull();
  });

  it('puts the field in place of what was typed, with the caret after it', () => {
    expect(insertField('Fix {{ti now', 4, 8, 'title')).toEqual({ text: 'Fix {{event.title}} now', caret: 19 });
    expect(insertField('Fix {{}}', 4, 6, 'url')).toEqual({ text: 'Fix {{event.url}}', caret: 17 });
  });
});
