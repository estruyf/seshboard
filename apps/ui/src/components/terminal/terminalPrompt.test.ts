import { describe, expect, it } from 'vitest';
import { terminalPrompt } from './terminalPrompt.ts';

describe('terminalPrompt', () => {
  it('puts the output in a code block under the ask', () => {
    expect(terminalPrompt('explain', 'npm ERR! code ENOENT\n\n')).toBe('Explain this terminal output:\n\n```\nnpm ERR! code ENOENT\n```\n');
    expect(terminalPrompt('fix', 'boom')).toMatch(/^Fix this error from the terminal:/);
  });

  it('uses a longer fence when the output has one', () => {
    expect(terminalPrompt('fix', 'a ```b``` c')).toContain('````\na ```b``` c\n````');
  });
});
