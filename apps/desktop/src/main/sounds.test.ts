import { describe, expect, it } from 'vitest';
import { playCommand, soundListFrom } from './sounds.ts';

describe('soundListFrom', () => {
  it('lists the macOS system sounds by name, sorted, with a fallback for each moment', () => {
    expect(soundListFrom(['Tink.aiff', 'Glass.aiff', 'Ping.aiff', 'Basso.aiff', 'Pop.aiff', '.DS_Store'], 'darwin')).toEqual({
      sounds: ['Basso', 'Glass', 'Ping', 'Pop', 'Tink'],
      fallback: { needsYou: 'Ping', finished: 'Glass', error: 'Basso', actionEnded: 'Pop' },
    });
  });

  it('lists the Windows sounds, and falls back to the first one when a default is missing', () => {
    expect(soundListFrom(['tada.wav', 'Windows Notify Messaging.wav', 'chimes.WAV', 'desktop.ini'], 'win32')).toEqual({
      sounds: ['chimes', 'tada', 'Windows Notify Messaging'],
      fallback: { needsYou: 'Windows Notify Messaging', finished: 'chimes', error: 'chimes', actionEnded: 'chimes' },
    });
  });

  it('falls back to a different Windows sound for each moment', () => {
    const files = ['Windows Notify Messaging.wav', 'Windows Notify System Generic.wav', 'Windows Critical Stop.wav', 'Windows Ding.wav'];
    const { fallback } = soundListFrom(files, 'win32');
    expect(fallback).toEqual({ needsYou: 'Windows Notify Messaging', finished: 'Windows Notify System Generic', error: 'Windows Critical Stop', actionEnded: 'Windows Ding' });
    expect(new Set(Object.values(fallback)).size).toBe(4);
  });

  it('reads the freedesktop sound theme on Linux', () => {
    expect(soundListFrom(['dialog-error.oga', 'bell.oga', 'complete.oga', 'message-new-instant.oga', 'index.theme'], 'linux')).toEqual({
      sounds: ['bell', 'complete', 'dialog-error', 'message-new-instant'],
      fallback: { needsYou: 'message-new-instant', finished: 'complete', error: 'dialog-error', actionEnded: 'bell' },
    });
  });

  it('has nothing to offer elsewhere, or in an empty folder', () => {
    const none = { needsYou: null, finished: null, error: null, actionEnded: null };
    expect(soundListFrom(['bell.oga'], 'freebsd')).toEqual({ sounds: [], fallback: none });
    expect(soundListFrom([], 'darwin')).toEqual({ sounds: [], fallback: none });
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

  it('uses paplay on Linux, with its volume scale', () => {
    expect(playCommand('linux', '/usr/share/sounds/freedesktop/stereo/bell.oga', 0.5)).toEqual({ command: 'paplay', args: ['--volume=32768', '/usr/share/sounds/freedesktop/stereo/bell.oga'] });
  });

  it('has no player elsewhere', () => {
    expect(playCommand('freebsd', '/x.wav', 1)).toBeNull();
  });
});
