import { describe, expect, it } from 'vitest';
import type { RemoteMessage } from '@switchboard/protocol/remote-client';
import { lastReply, promptTitle, turnPrompt } from './promptTitle.ts';

describe('the prompt title', () => {
  it('is the first heading, without its #', () => {
    expect(promptTitle('# Remote app on a phone: one menu button\n\nRead AGENTS.md first.')).toBe('Remote app on a phone: one menu button');
    expect(promptTitle('## Step 1 ##\nbody')).toBe('Step 1');
  });

  it('finds a heading after blank lines and a line of text', () => {
    expect(promptTitle('\n\n# The title\nmore')).toBe('The title');
    expect(promptTitle('Read this first.\n\n### Then the heading')).toBe('Then the heading');
  });

  it('is the first sentence without a heading', () => {
    expect(promptTitle('Fix the flaky upload test. It fails on CI.')).toBe('Fix the flaky upload test.');
    expect(promptTitle('Add a theme setting\nto the remote app')).toBe('Add a theme setting to the remote app');
    expect(promptTitle('Why does it fail? Look at the logs.')).toBe('Why does it fail?');
  });

  it("doesn't take a heading or code from a code fence", () => {
    expect(promptTitle('```sh\n# a comment\nnpm test\n```\nRun the tests. Then fix them.')).toBe('Run the tests.');
    expect(promptTitle('~~~\n# not this\n~~~\n# This one')).toBe('This one');
  });

  it('leaves a version number in the sentence', () => {
    expect(promptTitle('Upgrade to Node 24.1 today. Then test.')).toBe('Upgrade to Node 24.1 today.');
  });
});

const message = (uuid: string, role: RemoteMessage['role'], text: string | null, parentToolUseId: string | null = null): RemoteMessage => ({
  uuid,
  role,
  timestamp: 0,
  parentToolUseId,
  blocks: text === null ? [{ type: 'tool_result', toolUseId: 't', isError: false, text: 'ok', truncated: false }] : [{ type: 'text', text }],
});

describe('the turn prompt and the last reply', () => {
  const messages = [message('1', 'user', 'First ask'), message('2', 'assistant', 'Done.'), message('3', 'user', '# Second ask\nwith more'), message('4', 'assistant', 'Working on it'), message('5', 'user', null), message('6', 'assistant', 'All done.'), message('7', 'assistant', 'A step', 'tool-1')];

  it('is the last message you sent before the turn ended', () => {
    expect(turnPrompt(messages, '6')).toBe('# Second ask\nwith more');
    expect(turnPrompt(messages, '2')).toBe('First ask');
    expect(turnPrompt(messages, 'not-loaded')).toBe('# Second ask\nwith more');
    expect(turnPrompt([message('9', 'assistant', 'hi')], '9')).toBeNull();
  });

  it("is Claude's last reply, not a sub-agent's", () => {
    expect(lastReply(messages)).toBe('All done.');
    expect(lastReply([message('1', 'user', 'hi')])).toBeNull();
  });
});
