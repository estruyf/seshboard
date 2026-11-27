import { describe, expect, it } from 'vitest';
import { listAfterMove, listForView } from './panelList.ts';

describe('listForView', () => {
  it('gives each view with a list its own', () => {
    expect(listForView('projects')).toBe('projects');
    expect(listForView('project')).toBe('projects');
    expect(listForView('upcoming')).toBe('upcoming');
    expect(listForView('activity')).toBe('activity');
    expect(listForView('settings')).toBe('settings');
    expect(listForView('browser')).toBe('browser');
  });

  it('gives the sessions to the others', () => {
    for (const view of ['session', 'new', 'usage', 'remote'] as const) expect(listForView(view)).toBe('sessions');
  });
});

describe('listAfterMove', () => {
  it("follows the view to the new one's list", () => {
    expect(listAfterMove('session', 'upcoming')).toBe('upcoming');
    expect(listAfterMove('upcoming', 'session')).toBe('sessions');
    // Closing Settings: the view it covered takes its list back.
    expect(listAfterMove('settings', 'browser')).toBe('browser');
  });

  it('keeps the list between the list of projects and a project, and when nothing moved', () => {
    expect(listAfterMove('projects', 'project')).toBeNull();
    expect(listAfterMove('project', 'project')).toBeNull();
    expect(listAfterMove('session', 'session')).toBeNull();
  });
});
