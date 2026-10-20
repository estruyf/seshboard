import { describe, expect, it } from 'vitest';
import { commandRunMessage, outputTail, plainText, shellName } from './outputMessage.ts';

describe('plainText', () => {
  it('drops escape codes and keeps the last form of a redrawn line', () => {
    expect(plainText('\u001b[32m✓ 12 passed\u001b[39m\r\n')).toBe('✓ 12 passed\n');
    expect(plainText('10%\r50%\r100%\r\ndone')).toBe('100%\ndone');
    expect(plainText('\u001b]0;title\u0007hello')).toBe('hello');
  });
});

describe('outputTail', () => {
  it('keeps the last lines and says how many there were', () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    expect(outputTail(text, 3)).toEqual({ text: 'line 8\nline 9\nline 10', lines: 10, kept: 3 });
    expect(outputTail(text)).toMatchObject({ lines: 10, kept: 10 });
  });

  it('stays under the character limit, from a whole line where it can', () => {
    expect(outputTail('aaaa\nbbbb\ncccc', 200, 9)).toEqual({ text: 'bbbb\ncccc', lines: 3, kept: 2 });
    expect(outputTail('aaaa\nbbbb\ncccc', 200, 8)).toEqual({ text: 'cccc', lines: 3, kept: 1 });
    expect(outputTail('x'.repeat(50), 200, 10).text).toBe('x'.repeat(10));
  });

  it('trims blank lines around it', () => {
    expect(outputTail('\n\n  \nok\n\n')).toEqual({ text: 'ok', lines: 1, kept: 1 });
    expect(outputTail(' \n\n')).toEqual({ text: '', lines: 0, kept: 0 });
  });
});

describe('commandRunMessage', () => {
  it('says what ran, how it ended and what it printed', () => {
    expect(commandRunMessage({ command: 'npm test', exitCode: 1, stopped: false, output: '\u001b[31mFAIL\u001b[0m a.test.ts\r\n' })).toBe(
      'I ran `npm test` in the terminal. It failed with exit code 1.\n\nThe output:\n```text\nFAIL a.test.ts\n```',
    );
  });

  it('names the shell it ran in, so Claude writes the next command for it', () => {
    expect(commandRunMessage({ command: 'ls -la', shell: 'PowerShell', exitCode: 1, stopped: false, output: '' })).toMatch(/^I ran `ls -la` in the terminal \(PowerShell\)\. It failed with exit code 1\./);
    expect(shellName({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', kind: 'powershell' })).toBe('PowerShell');
    expect(shellName({ file: '/bin/zsh', kind: 'posix' })).toBe('zsh');
    expect(shellName({ file: 'C:\\Program Files\\Git\\bin\\bash.exe', kind: 'posix' })).toBe('bash');
    expect(commandRunMessage({ command: 'npm test', action: 'Test', shell: 'PowerShell', exitCode: 0, stopped: false, output: '' })).toContain('```powershell\nnpm test\n```');
  });

  it('names a project action and shows its command', () => {
    const message = commandRunMessage({ command: 'npm run lint', action: 'Lint', exitCode: 0, stopped: false, output: '' });
    expect(message).toBe('I ran the project action “Lint” in the terminal. It finished with exit code 0.\n\n```sh\nnpm run lint\n```\n\nIt printed nothing.');
  });

  it('puts a multi-line command in a block, and says when you stopped it', () => {
    const message = commandRunMessage({ command: 'cd app\nnpm start', exitCode: 130, stopped: true, output: 'listening' });
    expect(message).toContain('I ran this command in the terminal. I stopped it before it finished (exit code 130).');
    expect(message).toContain('```sh\ncd app\nnpm start\n```');
  });

  it('keeps output with backticks inside its block', () => {
    expect(commandRunMessage({ command: 'cat x.md', exitCode: 0, stopped: false, output: '```js\n1\n```' })).toContain('````text\n```js\n1\n```\n````');
  });

  it('says how much of a long output it kept', () => {
    const output = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n');
    expect(commandRunMessage({ command: 'make', exitCode: 0, stopped: false, output })).toContain('The output, last 200 of 500 lines:');
  });
});
