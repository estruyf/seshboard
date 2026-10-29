import { describe, expect, it } from 'vitest';
import { keepAwakeActive, keepAwakeDetail, keepAwakeLabel, keepAwakeUntilDoneDetail } from './keepAwake.ts';

describe('keepAwakeUntilDoneDetail', () => {
  it('names the computer', () => {
    expect(keepAwakeUntilDoneDetail('darwin')).toBe("This Mac doesn't sleep until this session is done, background tasks included. Then this turns off by itself.");
    expect(keepAwakeUntilDoneDetail('win32')).toMatch(/^This PC doesn't sleep/);
  });
});

describe('keepAwakeLabel', () => {
  it('says Mac on macOS and PC elsewhere', () => {
    expect(keepAwakeLabel('darwin')).toBe('Keep this Mac awake');
    expect(keepAwakeLabel('win32')).toBe('Keep this PC awake');
    expect(keepAwakeLabel('linux')).toBe('Keep this PC awake');
  });
});

describe('keepAwakeDetail', () => {
  it('says on power only on macOS', () => {
    expect(keepAwakeDetail('darwin')).toBe('Stops sleep while Seshboard is open and on power. The display can still sleep.');
    expect(keepAwakeDetail('win32')).toBe('Stops sleep while Seshboard is open. The display can still sleep.');
    expect(keepAwakeDetail('linux')).toBe(keepAwakeDetail('win32'));
  });
});

describe('keepAwakeActive', () => {
  it('names this computer', () => {
    expect(keepAwakeActive('darwin')).toBe('Keeping this Mac awake');
    expect(keepAwakeActive('win32')).toBe('Keeping this PC awake');
  });
});
