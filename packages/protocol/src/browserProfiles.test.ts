import { describe, expect, it } from 'vitest';
import { browserProfileNameClash, browserProfilesFor, cleanBrowserProfileName, findBrowserProfile } from './browserProfiles.ts';

const admin = { id: 'a', name: 'Admin', projectRoot: '/work/shop' };
const customer = { id: 'c', name: 'Customer', projectRoot: null };
const other = { id: 'o', name: 'Tester', projectRoot: '/work/blog' };
const all = [admin, customer, other];

describe('browserProfilesFor', () => {
  it("lists the project's profiles, then the ones for everywhere", () => {
    expect(browserProfilesFor(all, '/work/shop').map((p) => p.id)).toEqual(['a', 'c']);
    expect(browserProfilesFor(all, null).map((p) => p.id)).toEqual(['c']);
    // The Browser view, which belongs to no project: every one, everywhere's first.
    expect(browserProfilesFor(all, undefined).map((p) => p.id)).toEqual(['c', 'a', 'o']);
  });
});

describe('findBrowserProfile', () => {
  it('matches a name without case among the profiles the project can use', () => {
    expect(findBrowserProfile(all, 'admin', '/work/shop')).toEqual({ profile: admin });
    expect(findBrowserProfile(all, '  CUSTOMER ', '/work/blog')).toEqual({ profile: customer });
  });

  it('takes no name, or Default, for the built-in profile', () => {
    expect(findBrowserProfile(all, undefined, '/work/shop')).toEqual({ profile: null });
    expect(findBrowserProfile(all, '', null)).toEqual({ profile: null });
    expect(findBrowserProfile(all, 'default', null)).toEqual({ profile: null });
  });

  it("refuses a name it doesn't know here, and lists the ones it does", () => {
    // Another project's profile is not one this session can use.
    const result = findBrowserProfile(all, 'Tester', '/work/shop');
    expect(result).toEqual({ error: 'No browser profile called “Tester”. The profiles here are: Default, Admin, Customer.' });
  });
});

describe('browserProfileNameClash', () => {
  it('refuses Default and a name another profile there already answers to', () => {
    expect(browserProfileNameClash(all, 'default', null)).toMatch(/built-in/);
    expect(browserProfileNameClash(all, 'admin', '/work/shop')).toMatch(/Admin is already there/);
    // Everywhere's profiles are in every project.
    expect(browserProfileNameClash(all, 'customer', '/work/blog')).toMatch(/Customer/);
    expect(browserProfileNameClash(all, 'Admin', null)).toMatch(/Admin/);
  });

  it("lets two projects each have one of the same name, and a profile keep its own", () => {
    expect(browserProfileNameClash(all, 'Admin', '/work/blog')).toBeNull();
    expect(browserProfileNameClash(all, 'ADMIN', '/work/shop', 'a')).toBeNull();
  });
});

describe('cleanBrowserProfileName', () => {
  it('folds spaces and gives null for an empty name', () => {
    expect(cleanBrowserProfileName('  Big   admin ')).toBe('Big admin');
    expect(cleanBrowserProfileName('   ')).toBeNull();
    expect(cleanBrowserProfileName('x'.repeat(100))).toHaveLength(60);
  });
});
