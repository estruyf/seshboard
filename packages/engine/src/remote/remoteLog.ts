import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** Past this size the log moves to `<file>.1` (the one before goes) and starts again. */
export const REMOTE_LOG_MAX_BYTES = 1024 * 1024;

export interface RemoteLogOptions {
  maxBytes?: number;
  now?: () => number;
}

/**
 * Remote's log on disk (`<dataDir>/remote.log`): connections, refusals and blocks, with their reasons and addresses,
 * so a phone that couldn't connect overnight can be explained in the morning. The engine's other log lines only go to
 * the open windows. One line per entry, `<ISO time> <level> <message>`; it never throws, since a log that can't be
 * written mustn't take Remote down.
 */
export class RemoteLog {
  private size: number | null = null;

  constructor(
    readonly file: string,
    private readonly options: RemoteLogOptions = {},
  ) {}

  write(level: 'info' | 'warn' | 'error', message: string): void {
    const line = `${new Date((this.options.now ?? Date.now)()).toISOString()} ${level} ${message.replace(/[\r\n]+/g, ' ')}\n`;
    try {
      if (this.size === null) {
        mkdirSync(dirname(this.file), { recursive: true });
        this.size = fileSize(this.file);
      }
      if (this.size > 0 && this.size + line.length > (this.options.maxBytes ?? REMOTE_LOG_MAX_BYTES)) {
        renameSync(this.file, `${this.file}.1`);
        this.size = 0;
      }
      appendFileSync(this.file, line, { mode: 0o600 });
      this.size += Buffer.byteLength(line);
    } catch {
      // Measured again next time: the folder may have come back.
      this.size = null;
    }
  }
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
