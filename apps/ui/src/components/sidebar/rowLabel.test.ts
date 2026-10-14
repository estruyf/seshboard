import { describe, expect, it } from 'vitest';
import { sessionRowLabel, spokenAge } from './rowLabel.ts';

const now = new Date(2026, 9, 6, 12, 0).getTime();
const MINUTE = 60_000;

describe('spokenAge', () => {
  it('says the short ages in words', () => {
    expect(spokenAge(now - 10_000, now)).toBe('just now');
    expect(spokenAge(now - MINUTE, now)).toBe('1 minute ago');
    expect(spokenAge(now - 5 * MINUTE, now)).toBe('5 minutes ago');
    expect(spokenAge(now - 3 * 60 * MINUTE, now)).toBe('3 hours ago');
    expect(spokenAge(now - 30 * 60 * MINUTE, now)).toBe('yesterday');
    expect(spokenAge(now - 3 * 24 * 60 * MINUTE, now)).toBe('3 days ago');
    expect(spokenAge(now - 30 * 24 * 60 * MINUTE, now)).toMatch(/^on /);
  });
});

describe('sessionRowLabel', () => {
  const base = { title: 'Fix the login bug', project: 'switchboard', status: null, pinned: false, archived: false, beside: false, updatedAt: now - 5 * MINUTE, now };

  it('starts with the title and project, and ends with the age', () => {
    expect(sessionRowLabel(base)).toBe('Fix the login bug, switchboard, updated 5 minutes ago');
  });

  it('says when the session holds an unsent message', () => {
    expect(sessionRowLabel({ ...base, draft: true })).toBe('Fix the login bug, switchboard, unsent message, updated 5 minutes ago');
  });

  it('names what the icons and colours show', () => {
    expect(sessionRowLabel({ ...base, status: 'needs-you', pinned: true })).toBe('Fix the login bug, switchboard, Waiting for you, pinned, updated 5 minutes ago');
    expect(sessionRowLabel({ ...base, archived: true, picked: true })).toBe('Fix the login bug, switchboard, archived, in the selection, updated 5 minutes ago');
    expect(sessionRowLabel({ ...base, status: 'running', archived: true, beside: true })).toBe(
      'Fix the login bug, switchboard, Claude is working, archived, open in another pane, updated 5 minutes ago',
    );
  });

  it('never reads an empty title', () => {
    expect(sessionRowLabel({ ...base, title: '' })).toMatch(/^Untitled session, /);
  });
});
