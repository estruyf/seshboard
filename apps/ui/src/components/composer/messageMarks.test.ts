import { describe, expect, it } from 'vitest';
import { hasMarks, leadingCommand, splitMarks } from './messageMarks.ts';

const known = ['design', 'review', 'anthropic-skills:docs'];

describe('leadingCommand', () => {
  it('finds a known command at the start of the message', () => {
    expect(leadingCommand('/design This is a random question', known)).toEqual({ name: 'design', end: 7 });
    expect(leadingCommand('/review', known)).toEqual({ name: 'review', end: 7 });
    expect(leadingCommand('/anthropic-skills:docs\nwrite it up', known)).toEqual({ name: 'anthropic-skills:docs', end: 22 });
    expect(leadingCommand('  /design x', known)).toEqual({ name: 'design', end: 9 });
  });

  it('leaves paths, unknown names, partial names and later commands alone', () => {
    expect(leadingCommand('/tmp is full', known)).toBeNull();
    expect(leadingCommand('/Users/me/app look here', known)).toBeNull();
    expect(leadingCommand('/desi', known)).toBeNull();
    expect(leadingCommand('/designer', known)).toBeNull();
    expect(leadingCommand('please /review this', known)).toBeNull();
    expect(leadingCommand('', known)).toBeNull();
  });
});

describe('splitMarks', () => {
  it('cuts off the command and keeps every character', () => {
    const text = '/design This is a random question';
    const parts = splitMarks(text, { commands: known, ultrathink: false });
    expect(parts).toEqual([
      { text: '/design', mark: 'command' },
      { text: ' This is a random question', mark: null },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe(text);
  });

  it('keeps leading spaces outside the command', () => {
    expect(splitMarks(' /review', { commands: known, ultrathink: false })).toEqual([
      { text: ' ', mark: null },
      { text: '/review', mark: 'command' },
    ]);
  });

  it('marks ultrathink after the command, only when the box colours it', () => {
    const text = '/review ultrathink about it';
    expect(splitMarks(text, { commands: known, ultrathink: true })).toEqual([
      { text: '/review', mark: 'command' },
      { text: ' ', mark: null },
      { text: 'ultrathink', mark: 'ultrathink' },
      { text: ' about it', mark: null },
    ]);
    expect(hasMarks(splitMarks('plain ultrathink', { commands: known, ultrathink: false }))).toBe(false);
    expect(hasMarks(splitMarks('plain ultrathink', { commands: known, ultrathink: true }))).toBe(true);
  });

  it('has nothing to mark in a plain message', () => {
    expect(hasMarks(splitMarks('/tmp is full', { commands: known, ultrathink: true }))).toBe(false);
    expect(splitMarks('', { commands: known, ultrathink: true })).toEqual([]);
  });
});
