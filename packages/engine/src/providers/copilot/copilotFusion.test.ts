import { describe, expect, it } from 'vitest';
import { copilotModel, fusionModels, isTierModel, modelOfChange, tierModel, withFusion } from './copilotFusion.ts';

describe('Copilot Fusion', () => {
  it('turns a tier into a model value and back', () => {
    expect(tierModel('fusion-max')).toBe('auto:fusion-max');
    expect(copilotModel('auto:fusion-max')).toEqual({ model: 'auto', autoTier: 'fusion-max' });
    expect(copilotModel('gpt-5')).toEqual({ model: 'gpt-5' });
    expect(copilotModel('auto')).toEqual({ model: 'auto' });
    expect(copilotModel('auto:')).toEqual({ model: 'auto:' });
    expect(isTierModel('auto:fusion-max')).toBe(true);
    expect(isTierModel('auto')).toBe(false);
    expect(isTierModel(null)).toBe(false);
  });

  it('reads the model a change names, Auto with a tier as the tier', () => {
    expect(modelOfChange({ newModel: 'auto', autoTier: 'fusion-high' })).toBe('auto:fusion-high');
    expect(modelOfChange({ newModel: 'auto', autoTier: null })).toBe('auto');
    expect(modelOfChange({ newModel: 'gpt-5', autoTier: 'balance' })).toBe('gpt-5');
    expect(modelOfChange({})).toBeNull();
    expect(modelOfChange(undefined)).toBeNull();
  });

  it("lists Fusion's tiers that are on and in the picker, after Auto", () => {
    const fusion = fusionModels([
      { id: 'fusion-standard', displayName: 'Fusion Standard', description: 'Balanced', type: 'fusion', status: { enabled: true } },
      { id: 'balance', displayName: 'Balance', description: '', type: 'auto', status: { enabled: true } },
      { id: 'legacy', displayName: 'Fusion (legacy)', description: '', type: 'auto', fusionTier: 'high', status: { enabled: true } },
      { id: 'fusion-max', displayName: 'Fusion Max', description: '', type: 'fusion', status: { enabled: false } },
      { id: 'hidden', displayName: 'Hidden', description: '', type: 'fusion', status: { enabled: true, pickerVisible: false } },
    ]);
    expect(fusion.map((m) => m.value)).toEqual(['auto:fusion-standard', 'auto:legacy']);
    expect(fusion[0]).toEqual({ value: 'auto:fusion-standard', displayName: 'Fusion Standard', description: 'Balanced', supportsEffort: false });
    expect(fusionModels(undefined)).toEqual([]);

    const model = (value: string) => ({ value, displayName: value, description: '', supportsEffort: false });
    expect(withFusion([model('auto'), model('gpt-5')], fusion).map((m) => m.value)).toEqual(['auto', 'auto:fusion-standard', 'auto:legacy', 'gpt-5']);
    expect(withFusion([model('gpt-5')], fusion).map((m) => m.value)).toEqual(['auto:fusion-standard', 'auto:legacy', 'gpt-5']);
    expect(withFusion([model('gpt-5')], [])).toEqual([model('gpt-5')]);
  });
});
