import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SOUND_EVENTS, type SoundEvent, type SoundList } from '@switchboard/protocol/bridge';

/**
 * Where each platform keeps its system sounds, their file type, and the ones a missing choice falls back to: a
 * different one for each moment, like the defaults.
 */
const SYSTEM_SOUNDS: Record<string, { dir: () => string; extension: string; fallback: Record<SoundEvent, string> }> = {
  darwin: { dir: () => '/System/Library/Sounds', extension: '.aiff', fallback: { needsYou: 'Ping', finished: 'Glass', error: 'Basso', actionEnded: 'Pop' } },
  win32: {
    dir: () => join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'Media'),
    extension: '.wav',
    fallback: { needsYou: 'Windows Notify Messaging', finished: 'Windows Notify System Generic', error: 'Windows Critical Stop', actionEnded: 'Windows Ding' },
  },
};

const NO_FALLBACK: SoundList['fallback'] = { needsYou: null, finished: null, error: null, actionEnded: null };

/**
 * The sounds in a system sounds folder (its file names), by name and sorted. A fallback this computer lacks
 * becomes its first sound, so a moment always plays something while there are any.
 */
export function soundListFrom(files: string[], platform: string): SoundList {
  const system = SYSTEM_SOUNDS[platform];
  if (!system) return { sounds: [], fallback: NO_FALLBACK };
  const sounds = files
    .filter((file) => file.toLowerCase().endsWith(system.extension))
    .map((file) => file.slice(0, -system.extension.length))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const pick = (name: string | null) => (name && sounds.includes(name) ? name : (sounds[0] ?? null));
  return { sounds, fallback: Object.fromEntries(SOUND_EVENTS.map((event) => [event, pick(system.fallback[event])])) as SoundList['fallback'] };
}

/**
 * How to play a sound file at a volume (0 to 1): `afplay` on macOS, and on Windows PowerShell's MediaPlayer,
 * which has a volume (SoundPlayer has none). Null where there is no player.
 */
export function playCommand(platform: string, file: string, volume: number): { command: string; args: string[] } | null {
  const level = Math.min(1, Math.max(0, volume)).toFixed(2);
  if (platform === 'darwin') return { command: '/usr/bin/afplay', args: ['-v', level, file] };
  if (platform === 'win32') {
    const path = file.replaceAll("'", "''");
    // MediaPlayer opens the file in the background: the sleep keeps PowerShell alive until the sound has played.
    const script = `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Volume = ${level}; $p.Open([Uri]'${path}'); $p.Play(); Start-Sleep -Seconds 4; $p.Close()`;
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script] };
  }
  return null;
}

/**
 * Plays the system sounds Settings › Notifications offers. Only names from the system folder are played,
 * never a path from elsewhere. A new sound stops the one still playing, so quick previews don't pile up.
 */
export class SoundPlayer {
  #list: SoundList | undefined;
  #playing: ChildProcess | undefined;

  /** `record`: smoke tests note what would play instead of making a sound. */
  constructor(private readonly options: { platform?: string; record?: (sound: { id: string; volume: number }) => void } = {}) {}

  private get platform(): string {
    return this.options.platform ?? process.platform;
  }

  /** Read once: the system sounds don't change while Switchboard runs. */
  list(): SoundList {
    if (!this.#list) {
      let files: string[] = [];
      try {
        files = readdirSync(SYSTEM_SOUNDS[this.platform]?.dir() ?? '');
      } catch {
        // No sounds folder: nothing to pick, nothing plays.
      }
      this.#list = soundListFrom(files, this.platform);
    }
    return this.#list;
  }

  play(id: string, volume: number): void {
    const system = SYSTEM_SOUNDS[this.platform];
    if (!system || !this.list().sounds.includes(id) || volume <= 0) return;
    if (this.options.record) {
      this.options.record({ id, volume });
      return;
    }
    const command = playCommand(this.platform, join(system.dir(), `${id}${system.extension}`), volume);
    if (!command) return;
    this.#playing?.kill();
    try {
      const child = spawn(command.command, command.args, { stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.on('exit', () => {
        if (this.#playing === child) this.#playing = undefined;
      });
      this.#playing = child;
    } catch {
      // A sound that can't play is not worth an error.
    }
  }
}
