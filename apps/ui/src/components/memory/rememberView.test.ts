import { describe, expect, it } from 'vitest';
import { addsLineNote, defaultType, rememberMetadata, suggestName, uniqueName } from './rememberView.ts';

describe('Remember this', () => {
  it('suggests a name from the first words', () => {
    expect(suggestName('Archived is a footer outside the scroll area; it slides up when opened. No filler row.')).toBe('archived-is-a-footer');
    expect(suggestName('**Never** edit `generated/` files!')).toBe('never-edit-generated-files');
    expect(suggestName('!!!')).toBe('memory');
  });

  it('makes a taken name unique', () => {
    expect(uniqueName('release', ['sidebar'])).toBe('release');
    expect(uniqueName('release', ['release', 'Release-2'])).toBe('release-3');
  });

  it('types your words as user and Claude’s as project', () => {
    expect([defaultType('user'), defaultType('claude')]).toEqual(['user', 'project']);
  });

  it('says how full MEMORY.md gets, past 200 in caution', () => {
    expect(addsLineNote(186)).toEqual({ text: 'Adds 1 line to MEMORY.md (187 of 200)', over: false });
    expect(addsLineNote(200).over).toBe(true);
  });

  it('records the session it came from', () => {
    expect(rememberMetadata('s-1')).toEqual({ originSessionId: 's-1', source: 'switchboard' });
    expect(rememberMetadata(null)).toEqual({ source: 'switchboard' });
  });
});
