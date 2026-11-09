import { describe, expect, it } from 'vitest';
import type { TerminalInfo } from '@seshboard/protocol/client';
import { sessionServerOffers, terminalOffer } from './serverOffers.ts';

const terminal = (id: string, change: Partial<TerminalInfo>): TerminalInfo => ({ id, sessionId: 's1', kind: 'action', title: id, cwd: '/p', pid: 1, cols: 80, rows: 24, exitCode: null, startedAt: 1, urls: [], ...change });

describe('sessionServerOffers', () => {
  it("offers the running servers of the session's terminals, newest first, each address once", () => {
    const terminals = [
      terminal('web', { urls: ['http://localhost:5173/'], startedAt: 1 }),
      terminal('docs', { urls: ['http://localhost:4321/', 'http://localhost:5173/'], startedAt: 2 }),
      terminal('stopped', { urls: ['http://localhost:3000/'], exitCode: 130 }),
      terminal('other', { sessionId: 's2', urls: ['http://localhost:8080/'] }),
      terminal('shell', { kind: 'shell' }),
    ];
    expect(sessionServerOffers(terminals, 's1')).toEqual([
      { url: 'http://localhost:4321/', title: 'docs', terminalId: 'docs' },
      { url: 'http://localhost:5173/', title: 'docs', terminalId: 'docs' },
    ]);
  });
});

describe('terminalOffer', () => {
  it('is the first address while the terminal runs', () => {
    expect(terminalOffer(terminal('a', { urls: ['http://localhost:5173/', 'http://localhost:5174/'] }))).toBe('http://localhost:5173/');
    expect(terminalOffer(terminal('a', { urls: ['http://localhost:5173/'], exitCode: 0 }))).toBeNull();
    expect(terminalOffer(terminal('a', {}))).toBeNull();
    expect(terminalOffer(undefined)).toBeNull();
  });
});
