import { describe, expect, it } from 'vitest';
import { LAST, PROMPT, REPLY, SESSION, sessionJson, sessionJsonl, TOOLS } from './geminiFixtures.ts';
import { contentText, isIgnoredPrompt, parseConversation } from './geminiRecords.ts';

describe('parseConversation', () => {
  it('replays a session file: the header, each message once, the last copy of each', () => {
    const conversation = parseConversation(sessionJsonl({ summary: 'Round the cart total' }))!;
    expect(conversation).toMatchObject({ sessionId: SESSION, kind: 'main', summary: 'Round the cart total', lastUpdated: '2026-11-07T10:00:05.000Z' });
    expect(conversation.messages.map((m) => m.id)).toEqual([expect.stringMatching(/^c0/), PROMPT.id, REPLY.id, TOOLS.id, LAST.id, expect.stringMatching(/^i1/)]);
    // The copy with its tokens, where the first copy was.
    expect(conversation.messages[2]!.tokens).toEqual(REPLY.tokens);
  });

  it('drops a rewound message and everything after it', () => {
    const conversation = parseConversation(`${sessionJsonl()}${JSON.stringify({ $rewindTo: TOOLS.id })}\n`)!;
    expect(conversation.messages.map((m) => m.id).slice(-1)).toEqual([REPLY.id]);
  });

  it("applies a patch to a message's content and a tool call's result, and removes and orders messages", () => {
    const patch = { $patch: { updates: [{ id: REPLY.id, content: 'Looking at the total.' }, { id: TOOLS.id, toolCalls: [{ id: TOOLS.toolCalls[0]!.id, result: 'trimmed' }] }], removeIds: [LAST.id], orderIds: [PROMPT.id] } };
    const conversation = parseConversation(`${sessionJsonl()}${JSON.stringify(patch)}\n`)!;
    const ids = conversation.messages.map((m) => m.id);
    expect(ids).not.toContain(LAST.id);
    expect(ids.at(-1)).toBe(PROMPT.id);
    expect(conversation.messages.find((m) => m.id === REPLY.id)!.content).toBe('Looking at the total.');
    expect(conversation.messages.find((m) => m.id === TOOLS.id)!.toolCalls![0]!.result).toBe('trimmed');
  });

  it("takes a checkpoint's messages in place of everything before", () => {
    const checkpoint = { $set: { messages: [PROMPT, LAST] } };
    const conversation = parseConversation(`${sessionJsonl()}${JSON.stringify(checkpoint)}\n`)!;
    expect(conversation.messages.map((m) => m.id)).toEqual([PROMPT.id, LAST.id]);
  });

  it('reads an older session written as one JSON object', () => {
    const conversation = parseConversation(sessionJson())!;
    expect(conversation).toMatchObject({ sessionId: SESSION, summary: 'Make app appear in Dock & show bookmarks on click.' });
    expect(conversation.messages.map((m) => m.id)).toEqual([PROMPT.id, REPLY.id]);
  });

  it('skips a line still being written, and names no session for a file without a header', () => {
    expect(parseConversation(`${sessionJsonl()}{"id":"half`)!.messages).toHaveLength(6);
    expect(parseConversation(JSON.stringify(PROMPT))).toBeNull();
    expect(parseConversation('')).toBeNull();
  });
});

describe('prompts', () => {
  it('reads the text of parts, leaving thoughts out', () => {
    expect(contentText([{ text: 'a' }, { text: 'hidden', thought: true }, { inlineData: {} }, { text: 'b' }])).toBe('ab');
    expect(contentText('plain')).toBe('plain');
  });

  it("leaves out Gemini's own context, slash commands and help", () => {
    for (const text of ['<session_context>…', '<hook_context>…', '/memory show', '?', '   ']) expect(isIgnoredPrompt(text)).toBe(true);
    expect(isIgnoredPrompt('Fix the build')).toBe(false);
  });
});
