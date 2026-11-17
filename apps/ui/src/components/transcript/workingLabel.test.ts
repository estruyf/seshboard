import { describe, expect, it } from 'vitest';
import { workingLabel } from './workingLabel.ts';

describe('workingLabel', () => {
  it('says what Claude is doing, waiting and compacting first', () => {
    expect(workingLabel({ waiting: true, compacting: true, block: { kind: 'tool', text: 'Edit' } })).toBe('Waiting for you');
    expect(workingLabel({ waiting: false, compacting: true, block: undefined })).toBe('Compacting the conversation');
    expect(workingLabel({ waiting: false, compacting: false, block: { kind: 'tool', text: 'Bash' } })).toBe('Using Bash');
    expect(workingLabel({ waiting: false, compacting: false, block: { kind: 'thinking', text: '' } })).toBe('Thinking');
    expect(workingLabel({ waiting: false, compacting: false, block: { kind: 'text', text: 'Hi' } })).toBe('Working');
  });

  it('says Claude Code is retrying after waiting and compacting, before what it is doing', () => {
    const retry = 'API overloaded, retrying (3 of 10) in 8s';
    expect(workingLabel({ waiting: false, compacting: false, block: { kind: 'tool', text: 'Bash' }, retry })).toBe(retry);
    expect(workingLabel({ waiting: false, compacting: true, block: undefined, retry })).toBe('Compacting the conversation');
    expect(workingLabel({ waiting: true, compacting: false, block: undefined, retry })).toBe('Waiting for you');
    expect(workingLabel({ waiting: false, compacting: false, block: undefined, retry: null })).toBe('Working');
  });
});
