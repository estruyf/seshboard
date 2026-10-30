import { describe, expect, it } from 'vitest';
import type { RemoteSessions } from '@seshboard/protocol/client';
import { RemoteAttention } from './remoteAttention.ts';

type Session = RemoteSessions['sessions'][number];
type Prompt = RemoteSessions['prompts'][number];

const studio = { id: 'c1', name: 'studio' };
const session = (id: string, status: Session['status'], parentId: string | null = null): Session => ({ id, title: `Session ${id}`, status, parentId }) as Session;
const prompt = (requestId: string, sessionId: string, toolName = 'Bash'): Prompt => ({ requestId, sessionId, toolName }) as Prompt;
const list = (sessions: Session[], prompts: Prompt[] = []) => ({ sessions, prompts });

describe('RemoteAttention', () => {
  it('sets what was already so from the first list, then tells what changed', () => {
    const attention = new RemoteAttention();
    expect(attention.onList(studio, list([session('a', 'working')], [prompt('p0', 'a')]))).toEqual([]);
    const events = attention.onList(studio, list([session('a', 'needs-you'), session('b', 'working')], [prompt('p0', 'a'), prompt('p1', 'b', 'AskUserQuestion')]));
    expect(events).toEqual([{ kind: 'needs-you', sessionId: 'remote:c1:b', title: 'Claude has a question', body: 'Session b · on studio' }]);
  });

  it('says a turn finished or failed, but not for a pipeline step', () => {
    const attention = new RemoteAttention();
    attention.onList(studio, list([session('a', 'working'), session('b', 'working'), session('s', 'working', 'a')]));
    const events = attention.onList(studio, list([session('a', 'unread'), session('b', 'error'), session('s', 'idle', 'a')]));
    expect(events.map((e) => [e.kind, e.sessionId, e.title])).toEqual([
      ['finished', 'remote:c1:a', 'Claude finished'],
      ['failed', 'remote:c1:b', 'Claude Code stopped with an error'],
    ]);
  });

  it('starts over, silently, after a computer was away', () => {
    const attention = new RemoteAttention();
    attention.onList(studio, list([session('a', 'working')]));
    attention.forget('c1');
    expect(attention.onList(studio, list([session('a', 'idle')], [prompt('p1', 'a')]))).toEqual([]);
  });
});
