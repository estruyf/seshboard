import { describe, expect, it } from 'vitest';
import { playCommand, soundListFrom } from './sounds.ts';

describe('soundListFrom', () => {
  it('lists the macOS system sounds by name, sorted, with Glass and Ping as fallbacks', () => {
    expect(soundListFrom(['Tink.aiff', 'Glass.aiff', 'Ping.aiff', '.DS_Store'], 'darwin')).toEqual({ sounds: ['Glass', 'Ping', 'Tink'], fallback: { complete: 'Glass', needsInput: 'Ping' } });
  });

  it('lists the Windows sounds, and falls back to the first one when a default is missing', () => {
    expect(soundListFrom(['tada.wav', 'Windows Notify Messaging.wav', 'chimes.WAV', 'desktop.ini'], 'win32')).toEqual({
      sounds: ['chimes', 'tada', 'Windows Notify Messaging'],
      fallback: { complete: 'chimes', needsInput: 'Windows Notify Messaging' },
    });
  });

  it('has nothing to offer elsewhere, or in an empty folder', () => {
    expect(soundListFrom(['bell.oga'], 'linux')).toEqual({ sounds: [], fallback: { complete: null, needsInput: null } });
    expect(soundListFrom([], 'darwin')).toEqual({ sounds: [], fallback: { complete: null, needsInput: null } });
  });
});

describe('playCommand', () => {
  it('uses afplay with the volume on macOS', () => {
    expect(playCommand('darwin', '/System/Library/Sounds/Glass.aiff', 0.5)).toEqual({ command: '/usr/bin/afplay', args: ['-v', '0.50', '/System/Library/Sounds/Glass.aiff'] });
    expect(playCommand('darwin', '/x.aiff', 7)?.args[1]).toBe('1.00');
  });

  it('uses PowerShell on Windows, with the path quoted', () => {
    const command = playCommand('win32', "C:\\Windows\\Media\\it's.wav", 0.25)!;
    expect(command.command).toBe('powershell.exe');
    expect(command.args.at(-1)).toContain("$p.Volume = 0.25");
    expect(command.args.at(-1)).toContain("[Uri]'C:\\Windows\\Media\\it''s.wav'");
  });

  it('has no player elsewhere', () => {
    expect(playCommand('linux', '/x.wav', 1)).toBeNull();
  });
});
