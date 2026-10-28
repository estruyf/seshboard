import { describe, expect, it } from 'vitest';
import { moreItems } from './more.ts';

const ids = (items: ReturnType<typeof moreItems>) => items.map((item) => item.id);

describe('the ⋯ menu on Home', () => {
  it('has the quick settings, Refresh and All settings', () => {
    expect(ids(moreItems({ notifications: 'off', archived: false }))).toEqual(['theme', 'notifications', 'separator', 'refresh', 'separator', 'settings']);
  });

  it('says whether notifications are on', () => {
    expect(moreItems({ notifications: 'on', archived: false })[1]).toEqual({ id: 'notifications', state: 'On' });
    expect(moreItems({ notifications: 'off', archived: false })[1]).toEqual({ id: 'notifications', state: 'Off' });
    expect(moreItems({ notifications: 'unavailable', archived: false })[1]).toEqual({ id: 'notifications', state: 'Off' });
  });

  it('has Show archived only when the list can show them', () => {
    expect(ids(moreItems({ notifications: 'on', archived: true }))).toEqual(['theme', 'notifications', 'separator', 'refresh', 'archived', 'separator', 'settings']);
  });

  it('has nothing of the computers, with one or several: they moved to the drawer and Settings', () => {
    for (const notifications of ['on', 'off'] as const) {
      const items = ids(moreItems({ notifications, archived: false }));
      expect(items).not.toContain('pair');
      expect(items).not.toContain('forget');
    }
  });
});
