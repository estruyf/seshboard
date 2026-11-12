import { describe, expect, it } from 'vitest';
import { groupedByProject, viewButtonLabel } from './sidebarView.ts';

describe('viewButtonLabel', () => {
  it('names the grouping', () => {
    expect(viewButtonLabel('state', false)).toMatchObject({ label: 'State', faint: false });
    expect(viewButtonLabel('project', false)).toMatchObject({ label: 'Project', faint: false });
    expect(viewButtonLabel('state', true)).toMatchObject({ label: 'State', faint: false });
  });

  it('says State in faint text while one project is picked, and why', () => {
    expect(viewButtonLabel('project', true)).toEqual({ label: 'State', faint: true, tooltip: 'Grouping by project shows with All projects.' });
  });
});

describe('groupedByProject', () => {
  it('groups by project only with All projects', () => {
    expect(groupedByProject('project', null)).toBe(true);
    expect(groupedByProject('project', '/p/a')).toBe(false);
    expect(groupedByProject('state', null)).toBe(false);
  });
});
