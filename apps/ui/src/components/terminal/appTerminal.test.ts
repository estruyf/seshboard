import { describe, expect, it } from 'vitest';
import { APP_TERMINAL, appTerminalFolder, ownerSession, terminalOwner } from './appTerminal.ts';

describe('terminalOwner', () => {
  it('is the session in a session view', () => {
    expect(terminalOwner('session', 's1')).toBe('s1');
    expect(terminalOwner('session', null)).toBeNull();
  });

  it("is the window's own terminal on the other views", () => {
    for (const view of ['home', 'new-session', 'projects', 'project', 'usage'] as const) expect(terminalOwner(view, 's1')).toBe(APP_TERMINAL);
  });

  it('is none in Settings', () => {
    expect(terminalOwner('settings', 's1')).toBeNull();
  });
});

describe('ownerSession', () => {
  it("has no session for the window's terminal", () => {
    expect(ownerSession(APP_TERMINAL)).toBeNull();
    expect(ownerSession('s1')).toBe('s1');
  });
});

describe('appTerminalFolder', () => {
  const place = { projectRoot: '/work/app', newSessionCwd: '/work/other' };

  it("starts in the project on a project's page", () => {
    expect(appTerminalFolder('project', place)).toBe('/work/app');
  });

  it('starts where New session starts', () => {
    expect(appTerminalFolder('new-session', place)).toBe('/work/other');
    expect(appTerminalFolder('new-session', { ...place, newSessionCwd: null })).toBeNull();
  });

  it('starts in the home folder elsewhere', () => {
    for (const view of ['home', 'projects', 'usage'] as const) expect(appTerminalFolder(view, place)).toBeNull();
  });
});
