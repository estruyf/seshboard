/**
 * Native messaging's framing: each message is its length (4 bytes, the system's byte order, little-endian on every
 * platform Seshboard runs on) and then that much UTF-8 JSON. The same both ways.
 */

/** Chrome drops a host that sends a message larger than this (Firefox allows more): the host never does. */
export const MAX_FRAME_TO_BROWSER = 1024 * 1024;
/** The largest message the host takes from the extension; a larger one ends the connection. */
export const MAX_FRAME_FROM_BROWSER = 8 * 1024 * 1024;

export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Collects bytes from stdin and hands out each whole message. Throws on a frame that is too large or not JSON. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxBytes = MAX_FRAME_FROM_BROWSER) {}

  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > this.maxBytes) throw new Error(`A message of ${length} bytes is too large`);
      if (this.buffer.length < 4 + length) break;
      const body = this.buffer.subarray(4, 4 + length).toString('utf8');
      this.buffer = this.buffer.subarray(4 + length);
      out.push(JSON.parse(body));
    }
    return out;
  }
}

/** Splits a socket's text into lines (one companion message each), keeping a partial line for the next chunk. */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let rest = '';
  return (chunk) => {
    rest += chunk;
    let index = rest.indexOf('\n');
    while (index !== -1) {
      const line = rest.slice(0, index).trim();
      rest = rest.slice(index + 1);
      if (line) onLine(line);
      index = rest.indexOf('\n');
    }
  };
}
