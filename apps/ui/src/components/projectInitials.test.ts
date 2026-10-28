import { describe, expect, it } from 'vitest';
import { projectInitials } from './projectInitials.ts';

describe('projectInitials', () => {
  it('takes one letter by default', () => {
    expect(projectInitials('switchboard')).toBe('S');
    expect(projectInitials('Demo Time')).toBe('D');
    expect(projectInitials('.dotfiles')).toBe('D');
    expect(projectInitials('---')).toBe('·');
  });

  it('takes the first letters of two words', () => {
    expect(projectInitials('Demo Time', 2)).toBe('DT');
    expect(projectInitials('pf-app-customizer', 2)).toBe('PA');
    expect(projectInitials('vscode_front_matter', 2)).toBe('VF');
  });

  it('takes the capitals of a single word', () => {
    expect(projectInitials('EngageTime', 2)).toBe('ET');
    expect(projectInitials('VoiceSnippets', 2)).toBe('VS');
    expect(projectInitials('FM', 2)).toBe('FM');
    expect(projectInitials('myApp', 2)).toBe('MA');
  });

  it('keeps one letter for a word without capitals', () => {
    expect(projectInitials('switchboard', 2)).toBe('S');
    expect(projectInitials('tideline', 2)).toBe('T');
    expect(projectInitials('', 2)).toBe('·');
  });
});
