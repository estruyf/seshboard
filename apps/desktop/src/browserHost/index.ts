import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { BrowserHost, type HostConfig } from './host.ts';
import { FrameDecoder } from './frames.ts';

// The browser extension's native messaging host: the browser starts it (Seshboard's own binary run as Node, through
// the script Seshboard installs) with the config file's path first; Chrome adds the extension's origin after it,
// Firefox the manifest's path and the extension's id. It ends when the browser closes its input.
const configFile = process.argv[2] ?? '';

function readConfig(): HostConfig | null {
  try {
    return JSON.parse(readFileSync(configFile, 'utf8')) as HostConfig;
  } catch {
    return null;
  }
}

const config = readConfig() ?? { infoFiles: [], launch: null, version: '0.0.0' };
const host = new BrowserHost(config, {
  write: (frame) => process.stdout.write(frame),
  readFile: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
  connect: (socketPath) => {
    const socket = connect(socketPath);
    socket.setEncoding('utf8');
    return socket;
  },
  launch: (command, args) => {
    // Without ELECTRON_RUN_AS_NODE, so the app starts as itself.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    spawn(command, args, { detached: true, stdio: 'ignore', env }).unref();
  },
});

const decoder = new FrameDecoder();
process.stdin.on('data', (chunk: Buffer) => {
  try {
    for (const message of decoder.push(chunk)) host.receive(message);
  } catch {
    // A frame the host can't read: the stream is out of step, so it ends.
    host.stop();
    process.exit(1);
  }
});
process.stdin.on('end', () => {
  host.stop();
  process.exit(0);
});
host.start();
