import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '@switchboard/protocol';
import { remoteMessage } from './remoteView.ts';

const msg = (role: TranscriptMessage['role'], blocks: TranscriptMessage['blocks']): TranscriptMessage => ({ uuid: 'm1', role, timestamp: 1, parentToolUseId: null, model: null, blocks });
const user = (text: string) => remoteMessage(msg('user', [{ type: 'text', text }]));

describe('remoteMessage', () => {
  it('turns a background task finishing into a line from Claude Code', () => {
    const notification =
      '<task-notification>\n<task-id>blup0q1xu</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/tasks/blup0q1xu.output</output-file>\n<status>failed</status>\n<summary>Background command "Wait for PR checks to finish" failed with exit code 1</summary>\n</task-notification>';
    expect(user(notification)).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'Background command "Wait for PR checks to finish" failed with exit code 1' }] });
    expect(user('Another Claude session sent a message:\n<agent-message from="a1">The report follows:\n  Done.\n</agent-message>')).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'An agent reported back' }] });
  });

  it('reads slash commands, command output and interrupts as the app does', () => {
    expect(user('<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>--fast</command-args>')).toMatchObject({ role: 'user', blocks: [{ type: 'text', text: '/review --fast' }] });
    expect(user('<local-command-stdout>Compacted</local-command-stdout>')).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'Compacted' }] });
    expect(user('<local-command-stdout></local-command-stdout>')).toMatchObject({ role: 'system', blocks: [] });
    expect(user('[Request interrupted by user]')).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'Interrupted by you' }] });
  });

  it('drops reminders and names what a system turn marks', () => {
    expect(user('Fix it<system-reminder>secret</system-reminder>')).toMatchObject({ role: 'user', blocks: [{ type: 'text', text: 'Fix it' }] });
    expect(user('<system-reminder>secret</system-reminder>').blocks).toEqual([]);
    expect(remoteMessage(msg('system', [{ type: 'unknown', kind: 'compact_boundary' }]))).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'Conversation compacted' }] });
    // A tool result is left alone, even when its output looks like markup.
    const result = remoteMessage(msg('user', [{ type: 'tool_result', toolUseId: 't', isError: false, text: '<task-notification>', truncated: false, images: [] }]));
    expect(result.role).toBe('user');
  });
});
