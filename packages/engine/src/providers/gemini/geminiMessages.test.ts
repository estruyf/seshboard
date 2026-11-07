import { describe, expect, it } from 'vitest';
import { INFO, LAST, PROMPT, REPLY, sessionJsonl, TOOLS } from './geminiFixtures.ts';
import { geminiMessages, geminiTool, toolResultText } from './geminiMessages.ts';
import { parseConversation } from './geminiRecords.ts';

const blocks = (message: { message: unknown }) => (message.message as { content: Array<Record<string, unknown>> }).content;

describe('geminiMessages', () => {
  const messages = geminiMessages(parseConversation(sessionJsonl()));

  it("leaves out Gemini's context prompt and shows what you typed, not the files Gemini read into it", () => {
    expect(messages[0]).toMatchObject({ type: 'user', uuid: PROMPT.id, timestamp: PROMPT.timestamp });
    expect(blocks(messages[0]!)).toEqual([{ type: 'text', text: 'Round the total to cents' }]);
  });

  it('shows a reply as its thinking and text', () => {
    expect(messages[1]).toMatchObject({ type: 'assistant', uuid: REPLY.id, message: { model: 'gemini-2.5-pro' } });
    expect(blocks(messages[1]!)).toEqual([
      { type: 'thinking', thinking: '**Finding the total**\nThe total lives in cart.ts.' },
      { type: 'text', text: 'I will look at how the total is computed.' },
    ]);
  });

  it('gives each tool call and its result messages of their own, so a call Gemini adds later is a new message', () => {
    const calls = messages.filter((m) => m.uuid.startsWith(`${TOOLS.id}~`));
    expect(calls.map((m) => [m.type, m.uuid])).toEqual([
      ['assistant', `${TOOLS.id}~read_file_1771604034776_0`],
      ['user', `${TOOLS.id}~read_file_1771604034776_0~result`],
      ['assistant', `${TOOLS.id}~replace_1771604063311_0`],
      ['user', `${TOOLS.id}~replace_1771604063311_0~result`],
      ['assistant', `${TOOLS.id}~run_shell_command_1771604241605_0`],
      ['user', `${TOOLS.id}~run_shell_command_1771604241605_0~result`],
    ]);
    expect(blocks(calls[0]!)).toEqual([{ type: 'tool_use', id: 'read_file_1771604034776_0', name: 'Read', input: { file_path: 'src/cart.ts' } }]);
    expect(blocks(calls[1]!)).toEqual([{ type: 'tool_result', tool_use_id: 'read_file_1771604034776_0', is_error: false, content: expect.stringContaining('export const total') }]);
    expect(blocks(calls[2]!)[0]).toMatchObject({ name: 'Edit', input: { file_path: '/repo/src/cart.ts', old_string: 'lines.reduce(', new_string: 'Math.round(lines.reduce(' } });
    expect(blocks(calls[4]!)[0]).toMatchObject({ name: 'Bash', input: { command: 'npm test', description: 'Run the tests.' } });
    // Cancelled: an error, with what the model was told.
    expect(blocks(calls[5]!)[0]).toMatchObject({ is_error: true, content: 'Tool "run_shell_command" was canceled by the user.' });
  });

  it("shows Gemini CLI's own notes as notes", () => {
    expect(messages.at(-2)).toMatchObject({ uuid: LAST.id, type: 'assistant' });
    expect(messages.at(-1)).toMatchObject({ uuid: INFO.id, type: 'system', message: { content: [{ type: 'text', text: 'Switched to fallback model gemini-2.5-flash' }] } });
  });

  it('leaves out a call that is still running until Gemini writes its result', () => {
    const running = { ...TOOLS, toolCalls: [{ id: 'glob_1_0', name: 'glob', args: { pattern: '**/*.ts' }, status: 'executing' }] };
    const out = geminiMessages({ sessionId: 's', messages: [running] });
    expect(out.map((m) => m.uuid)).toEqual([`${TOOLS.id}~glob_1_0`]);
  });

  it("shows a prompt's pasted images", () => {
    const out = geminiMessages({ sessionId: 's', messages: [{ id: 'p', type: 'user', content: [{ text: 'What is this?' }, { inlineData: { mimeType: 'image/png', data: 'iVBORw0' } }] }] });
    expect(blocks(out[0]!)).toEqual([{ type: 'text', text: 'What is this?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0' } }]);
  });
});

describe('geminiTool', () => {
  it("renames Gemini's tools to Claude Code's, with their input reshaped", () => {
    expect(geminiTool('write_file', { file_path: 'a.ts', content: 'x' })).toEqual({ name: 'Write', input: { file_path: 'a.ts', content: 'x' } });
    expect(geminiTool('glob', { pattern: '*.ts', dir_path: 'src' })).toEqual({ name: 'Glob', input: { pattern: '*.ts', path: 'src' } });
    expect(geminiTool('grep_search', { pattern: 'total', dir_path: 'src', include_pattern: '*.ts' })).toEqual({ name: 'Grep', input: { pattern: 'total', path: 'src', glob: '*.ts' } });
    expect(geminiTool('web_fetch', { prompt: 'Summarise https://example.com/docs please' })).toEqual({ name: 'WebFetch', input: { url: 'https://example.com/docs', prompt: 'Summarise https://example.com/docs please' } });
    expect(geminiTool('google_web_search', { query: 'vitest' })).toEqual({ name: 'WebSearch', input: { query: 'vitest' } });
    expect(geminiTool('write_todos', { todos: [{ description: 'Test it', status: 'in_progress' }, { description: 'Ship', status: 'cancelled' }] }).input).toEqual({
      todos: [
        { content: 'Test it', status: 'in_progress', activeForm: 'Test it' },
        { content: 'Ship', status: 'completed', activeForm: 'Ship' },
      ],
    });
    expect(geminiTool('invoke_agent', { agent_name: 'codebase_investigator', prompt: 'Map it' })).toEqual({ name: 'Agent', input: { description: 'codebase_investigator', prompt: 'Map it', subagent_type: 'codebase_investigator' } });
    expect(geminiTool('codebase_investigator', { objective: 'Map it' }, 'agent-1')).toMatchObject({ name: 'Agent', input: { prompt: 'Map it' } });
  });

  it('keeps any other tool as it is, for the generic card', () => {
    expect(geminiTool('list_directory', { dir_path: '.' })).toEqual({ name: 'list_directory', input: { dir_path: '.' } });
  });

  it("reads a result's output, its error, else what Gemini CLI showed", () => {
    expect(toolResultText({ result: [{ functionResponse: { response: { output: 'done' } } }] })).toBe('done');
    expect(toolResultText({ result: [{ functionResponse: { response: { error: 'nope' } } }] })).toBe('nope');
    expect(toolResultText({ result: undefined, resultDisplay: 'Listed 3 items' })).toBe('Listed 3 items');
  });
});
