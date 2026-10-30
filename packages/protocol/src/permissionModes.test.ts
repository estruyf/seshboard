import { describe, expect, it } from 'vitest';
import { inheritedDefault, inheritedPermissionMode } from './permissionModes.ts';

describe('inheritedPermissionMode', () => {
  it("takes the project's mode, else its profile's", () => {
    expect(inheritedPermissionMode({ permissionMode: 'plan' }, { permissionMode: 'auto' })).toBe('plan');
    expect(inheritedPermissionMode({ permissionMode: null }, { permissionMode: 'auto' })).toBe('auto');
    expect(inheritedPermissionMode(null, { permissionMode: 'acceptEdits' })).toBe('acceptEdits');
  });

  it('leaves it to the global mode when neither sets one', () => {
    expect(inheritedPermissionMode({ permissionMode: null }, { permissionMode: null })).toBeNull();
    expect(inheritedPermissionMode(null, null)).toBeNull();
  });

  it("skips the profile's mode when the project asks for the global one", () => {
    expect(inheritedPermissionMode({ permissionMode: null, globalPermissionMode: true }, { permissionMode: 'auto' })).toBeNull();
    expect(inheritedPermissionMode({ permissionMode: 'plan', globalPermissionMode: true }, { permissionMode: 'auto' })).toBe('plan');
  });
});

describe('inheritedDefault', () => {
  it("takes the project's model and effort, else its profile's, unless the project skips it for the global one", () => {
    const profile = { model: 'opus', effort: 'high' as const };
    expect(inheritedDefault('model', { model: null }, profile)).toBe('opus');
    expect(inheritedDefault('model', { model: 'haiku', globalModel: true }, profile)).toBe('haiku');
    expect(inheritedDefault('model', { model: null, globalModel: true }, profile)).toBeNull();
    expect(inheritedDefault('effort', { effort: null, globalModel: true }, profile)).toBe('high');
    expect(inheritedDefault('effort', { effort: null, globalEffort: true }, profile)).toBeNull();
  });
});
