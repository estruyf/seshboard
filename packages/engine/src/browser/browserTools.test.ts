import { describe, expect, it } from 'vitest';
import { browserToolDefinitions, toCallToolResult } from './browserTools.ts';

describe('browser tools', () => {
  it('turns a result into text, a picture and an error flag', () => {
    expect(toCallToolResult({ text: 'Opened' })).toEqual({ content: [{ type: 'text', text: 'Opened' }] });
    expect(toCallToolResult({ text: 'The page', image: { data: 'AAAA', mimeType: 'image/png' } }).content).toEqual([
      { type: 'text', text: 'The page' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ]);
    expect(toCallToolResult({ text: 'No element e9', error: true })).toMatchObject({ isError: true });
  });

  it('hands each call on with its arguments, and says why one failed', async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    const tools = browserToolDefinitions(async (tool, args) => {
      calls.push({ tool, args });
      if (tool === 'click') throw new Error('no page is open');
      return { text: 'done' };
    });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    await byName.get('type')!.handler({ ref: 'e3', text: 'hello', submit: true }, undefined);
    expect(calls).toEqual([{ tool: 'type', args: { ref: 'e3', text: 'hello', submit: true } }]);
    await expect(byName.get('click')!.handler({ ref: 'e1' }, undefined)).resolves.toMatchObject({ isError: true, content: [{ text: 'The browser could not do that: no page is open' }] });
    // Reading the page never changes it.
    expect(byName.get('snapshot')!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get('click')!.annotations?.readOnlyHint).toBeUndefined();
  });
});
