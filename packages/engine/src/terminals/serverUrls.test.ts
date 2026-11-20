import { describe, expect, it } from 'vitest';
import { plainText } from './outputMessage.ts';
import { keepUrlLines, MAX_URL_LINES, scanChunk, serverUrls } from './serverUrls.ts';

describe('serverUrls', () => {
  it("reads Vite's banner, Local first", () => {
    const vite = plainText('\x1b[32m  VITE v6.0.0\x1b[39m  ready in 312 ms\n\n  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n  ➜  Network: use --host to expose\n');
    expect(serverUrls(vite)).toEqual(['http://localhost:5173/']);
  });

  it('puts Local before Network and drops outside addresses', () => {
    const next = '   ▲ Next.js 15.0.0\n   - Network:      http://192.168.1.20:3000\n   - Local:        http://localhost:3000\n   - Docs:         https://nextjs.org/docs\n';
    expect(serverUrls(next)).toEqual(['http://localhost:3000/']);
  });

  it('reads Astro, 0.0.0.0, [::1] and trailing punctuation', () => {
    expect(serverUrls('┃ Local    http://localhost:4321/\n')).toEqual(['http://localhost:4321/']);
    expect(serverUrls('Serving on http://0.0.0.0:8000.\n')).toEqual(['http://localhost:8000/']);
    expect(serverUrls('Listening at (http://[::1]:9000/)\n')).toEqual(['http://[::1]:9000/']);
  });

  it('reads an address without a scheme and a bare port', () => {
    expect(serverUrls('Server ready at localhost:3000/app\n')).toEqual(['http://localhost:3000/app']);
    expect(serverUrls('Example app listening on port 8080\n')).toEqual(['http://localhost:8080/']);
  });

  it('keeps each address once, at most four', () => {
    const text = Array.from({ length: 6 }, (_, i) => `http://localhost:${3000 + i}/`).join('\n') + '\nhttp://localhost:3000/\n';
    expect(serverUrls(text)).toHaveLength(4);
    expect(serverUrls('http://localhost:3000/\nhttp://localhost:3000/')).toEqual(['http://localhost:3000/']);
  });

  it('finds nothing in ordinary output', () => {
    expect(serverUrls('compiled 12 files in 340ms\nsee https://example.com/docs\n')).toEqual([]);
  });
});

describe('scanChunk', () => {
  it('holds back an unfinished line until it ends', () => {
    const first = scanChunk('', 'building…\n  Local: http://local');
    expect(first.lines).toEqual([]);
    const second = scanChunk(first.carry, 'host:5173/\n');
    expect(second.lines).toEqual(['  Local: http://localhost:5173/']);
    expect(second.carry).toBe('');
  });
});

describe('keepUrlLines', () => {
  it("keeps a Local line while request logs push the rest out", () => {
    const requests = Array.from({ length: MAX_URL_LINES + 5 }, (_, i) => `GET http://localhost:3000/api/${i}`);
    const kept = keepUrlLines(['  ➜  Local:   http://localhost:5173/'], requests);
    expect(kept).toHaveLength(MAX_URL_LINES);
    expect(serverUrls(kept.join('\n'))[0]).toBe('http://localhost:5173/');
  });
});
