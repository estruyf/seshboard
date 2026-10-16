import { describe, expect, it } from 'vitest';
import { commandToRun, isRunnable } from './runnable.ts';

describe('isRunnable', () => {
  it('runs shell blocks only', () => {
    expect(isRunnable('bash', 'darwin')).toBe(true);
    expect(isRunnable('Shell', 'darwin')).toBe(true);
    expect(isRunnable('zsh', 'darwin')).toBe(true);
    expect(isRunnable('ts', 'darwin')).toBe(false);
    expect(isRunnable(undefined, 'darwin')).toBe(false);
  });

  it('runs PowerShell blocks on Windows, where the terminal is PowerShell, and not on a Mac', () => {
    expect(isRunnable('powershell', 'win32')).toBe(true);
    expect(isRunnable('PS1', 'win32')).toBe(true);
    expect(isRunnable('pwsh', 'win32')).toBe(true);
    expect(isRunnable('bash', 'win32')).toBe(true);
    expect(isRunnable('powershell', 'darwin')).toBe(false);
  });
});

describe('commandToRun', () => {
  it('keeps a plain script as written, without blank lines', () => {
    expect(commandToRun('git status\n\ngit log -1  \n')).toBe('git status\ngit log -1');
  });

  it('keeps continuation lines', () => {
    expect(commandToRun('git -C ~/repo worktree remove \\\n  ../ci')).toBe('git -C ~/repo worktree remove \\\n  ../ci');
  });

  it('takes only the prompt lines of a transcript', () => {
    expect(commandToRun('$ npm test\n> 3 passed\n$ git push')).toBe('npm test\ngit push');
  });

  it('takes the commands of a PowerShell transcript, without its prompt', () => {
    expect(commandToRun('PS C:\\repo> npm test\n3 passed\nPS C:\\repo> git push')).toBe('npm test\ngit push');
  });

  it('is empty when there is nothing to run', () => {
    expect(commandToRun('\n  \n')).toBe('');
  });
});
