import type { BrowserWindow, WebFrameMain } from 'electron';
import { setFieldValue, settle, waitInPage } from './pageDriver.ts';
import { isVisualFrameUrl } from './visualFrame.ts';

// The smoke step for Claude's inline visuals (#289), on the demo's "Show the checkout flow" (`screenshot-demo.ts`).
// Nothing is sent: the visual's button puts a prompt in the message box, which the step empties again.

const S = '[data-current-session]';
const q = (selector: string) => `document.querySelector(${JSON.stringify(`${S} ${selector}`)})`;

/** The visual's frame, from main: its page is sandboxed on another origin, so the window's own scripts can't reach it. */
async function visualFrame(win: BrowserWindow, timeoutMs = 5_000): Promise<WebFrameMain | null> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const frame = win.webContents.mainFrame.framesInSubtree.find((f) => isVisualFrameUrl(f.url));
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

/**
 * The visual draws between the reply's text (not in its steps) in a sandboxed frame that grows to fit, its scripts run,
 * its slider works and its button puts a prompt in the message box, a link can't take the frame elsewhere, it follows
 * light and dark, and Source shows its code. Read-only: it opens that session and goes back to the one it was on.
 */
export async function runVisualsStep(win: BrowserWindow, options: { demo: boolean; back: string | null; setScheme(scheme: 'light' | 'dark'): Promise<boolean>; scheme(): string; restoreScheme(scheme: string): void; shot(name: string): Promise<void> }): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!options.demo) return 'ok: needs the demo home, which has a session with a visual (npm run smoke:demo)';
  const row = (await js(`[...document.querySelectorAll('[data-session-id]')].find((row) => row.textContent.includes('Show the checkout flow'))?.dataset.sessionId ?? null`)) as string | null;
  if (!row) return 'failed: the demo session "Show the checkout flow" is not in the sidebar';
  const scheme = options.scheme();
  let draftBefore: string | null = null;
  try {
    await js(`document.querySelector('[data-session-id="${row}"]')?.click()`);
    if (!(await waitInPage(win, `document.querySelector('${S}')?.dataset.currentSession === ${JSON.stringify(row)} && ${q('[data-visual] [data-visual-state="drawn"]')}`, 10_000))) {
      const state = await js(`${q('[data-visual] [data-visual-state]')}?.dataset.visualState ?? 'no visual'`);
      return `the visual did not draw (${state})`;
    }
    if (await js(`!!${q('[data-visual]')}.closest('[data-steps]')`)) return 'the visual is folded into the steps';
    const height = (await js(`${q('[data-visual-frame]')}.getBoundingClientRect().height`)) as number;
    if (height < 60) return `the frame is ${height}px high, not the visual's height`;
    if ((await js(`${q('[data-visual-frame]')}.getAttribute('sandbox')`)) !== 'allow-scripts') return 'the frame is not sandboxed to scripts only';

    const frame = await visualFrame(win);
    if (!frame) return 'no frame on the visual page';
    if ((await frame.executeJavaScript('document.body.dataset.scripted ?? null')) !== 'yes') return "the visual's script did not run";
    if (await frame.executeJavaScript('(() => { try { return !!window.parent.document; } catch { return false; } })()')) return 'the visual can reach the app';

    // The slider: its script shows the value.
    const value = await frame.executeJavaScript("(() => { const r = document.getElementById('retries'); r.value = '4'; r.dispatchEvent(new Event('input')); return document.getElementById('retries-value').textContent; })()");
    if (value !== '4') return `the slider shows ${JSON.stringify(value)}, not 4`;

    // Its button: sendPrompt puts the text in the message box, for you to send.
    draftBefore = (await js(`${q('[data-composer]')}?.value ?? null`)) as string | null;
    if (draftBefore === null) return 'the session has no message box';
    // Without a click it does nothing; a click (a user gesture) puts the text in.
    await frame.executeJavaScript("sendPrompt('Not from a click'); true");
    await frame.executeJavaScript("document.getElementById('ask').click()", true);
    if (!(await waitInPage(win, `${q('[data-composer]')}.value.includes('Why does the payment step retry 4 times?')`, 3_000))) return "the visual's button did not put its prompt in the message box";
    if (await js(`${q('[data-composer]')}.value.includes('Not from a click')`)) return 'sendPrompt worked without a click';

    // Light and dark: the frame gets the theme's text colour each time.
    const textColour = async () => String(await (await visualFrame(win))?.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim()")).toLowerCase();
    await options.setScheme('light');
    const light = await textColour();
    await options.shot('visual-light.png');
    await options.setScheme('dark');
    if (!light) return 'the frame has no --text-primary in light';
    const started = performance.now();
    let dark = await textColour();
    while (dark === light && performance.now() - started < 3_000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      dark = await textColour();
    }
    if (dark === light) return `the frame kept ${light} in dark`;
    await options.shot('visual-dark.png');

    // Source shows the code; Preview draws it again.
    await js(`${q('[data-visual] [data-code-view="source"]')}.click()`);
    if (!(await waitInPage(win, `!${q('[data-visual-frame]')} && ${q('[data-visual]')}.innerText.includes('retries-value')`, 3_000))) return 'Source did not show the code';
    await js(`${q('[data-visual] [data-code-view="preview"]')}.click()`);
    if (!(await waitInPage(win, q('[data-visual] [data-visual-state="drawn"]'), 10_000))) return 'Preview did not draw the visual again';

    // A visual that sends its own frame to a site gets nowhere (its frame is left blank, so this goes last).
    await (await visualFrame(win))?.executeJavaScript("location.href = 'https://example.com/'; true").catch(() => {});
    await settle(win);
    // The app's frame-src policy blocks it: the frame holds Chromium's error page, not the site.
    const moved = win.webContents.mainFrame.framesInSubtree.find((f) => f.url.startsWith('https://example.com'));
    const holds = moved ? String(await moved.executeJavaScript('location.href').catch(() => '')) : '';
    if (moved && !holds.startsWith('chrome-error:')) return `the visual took its frame to another site (${holds})`;
    return `ok: drawn between the text at ${Math.round(height)}px, sandboxed, script, slider and sendPrompt work, links stay out, light ${light} and dark ${dark}, Source and back`;
  } finally {
    if (draftBefore !== null) await setFieldValue(win, `${S} [data-composer]`, draftBefore);
    options.restoreScheme(scheme);
    if (options.back) await js(`document.querySelector('[data-session-id="${options.back}"]')?.click()`);
  }
}

/**
 * Seshboard's `visualize` MCP server, started as an agent starts it (this binary as Node, on the built bundle): it
 * answers `initialize`, lists `read_me` and `show_widget`, gives the guide and serves its MCP App page. And the switch
 * in Settings › General turns it on for new sessions. Read-only: the switch is put back.
 */
export async function runVisualizeServerStep(
  win: BrowserWindow,
  options: { server: { command: string; args: string[]; env: Record<string, string> }; enabled(): boolean; setEnabled(on: boolean): void },
): Promise<string> {
  const { spawn } = await import('node:child_process');
  const child = spawn(options.server.command, options.server.args, { env: { ...process.env, ...options.server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const answers = new Map<number, Record<string, unknown>>();
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      try {
        const message = JSON.parse(line) as { id?: number };
        if (typeof message.id === 'number') answers.set(message.id, message as Record<string, unknown>);
      } catch {
        // Not JSON-RPC: the check below reports the missing answer.
      }
    }
  });
  let next = 0;
  const ask = async (method: string, params: object) => {
    const id = ++next;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const started = performance.now();
    while (!answers.has(id) && performance.now() - started < 10_000) await new Promise((resolve) => setTimeout(resolve, 20));
    return answers.get(id)?.result as Record<string, unknown> | undefined;
  };
  const was = options.enabled();
  try {
    const init = await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
    if ((init?.serverInfo as { name?: string } | undefined)?.name !== 'seshboard-visualize') return `the server did not start (${JSON.stringify(init ?? null)})`;
    const tools = ((await ask('tools/list', {}))?.tools as Array<{ name: string }> | undefined)?.map((t) => t.name) ?? [];
    if (tools.join() !== 'read_me,show_widget') return `the server lists ${JSON.stringify(tools)}`;
    const guide = (await ask('tools/call', { name: 'read_me', arguments: { modules: ['diagram'] } }))?.content as Array<{ text: string }> | undefined;
    if (!guide?.[0]?.text.includes('## Diagrams')) return 'read_me did not give the guide';
    const page = (await ask('resources/read', { uri: 'ui://visualize/widget' }))?.contents as Array<{ mimeType: string; text: string }> | undefined;
    if (page?.[0]?.mimeType !== 'text/html;profile=mcp-app' || !page[0].text.includes('ui/initialize')) return 'the server has no MCP App page';

    // The switch, off by default, saved when turned on.
    await win.webContents.executeJavaScript("document.querySelector('[data-settings]') || document.querySelector('[data-open-settings]')?.click()");
    if (!(await waitInPage(win, "document.querySelector('[data-settings] [data-settings-section=\"general\"]')", 3_000))) return 'no General page in Settings';
    await win.webContents.executeJavaScript("document.querySelector('[data-settings] [data-settings-section=\"general\"]').click()");
    const toggle = "document.querySelector('[data-agent-visuals-setting] [role=switch]') ?? document.querySelector('[data-agent-visuals-setting]')";
    if (!(await waitInPage(win, `!!(${toggle})`, 3_000))) return 'no Visuals in replies switch in Settings › General';
    if (was) return 'Visuals in replies is on by default';
    await win.webContents.executeJavaScript(`(${toggle}).click()`);
    const started = performance.now();
    while (!options.enabled() && performance.now() - started < 3_000) await new Promise((resolve) => setTimeout(resolve, 25));
    if (!options.enabled()) return 'turning on Visuals in replies was not saved';
    return 'ok: the server ran as this app, listed read_me and show_widget, gave the guide and its MCP App page; the switch is off by default and saves';
  } finally {
    child.kill();
    options.setEnabled(was);
    await win.webContents.executeJavaScript("document.querySelector('[data-close-settings]')?.click()").catch(() => {});
  }
}

/** Polls a condition in a frame (an app's page, which the window's own scripts can't reach). */
async function untilInFrame(frame: WebFrameMain, expression: string, timeoutMs: number): Promise<unknown> {
  const started = performance.now();
  for (;;) {
    const value: unknown = await frame.executeJavaScript(expression).catch(() => null);
    if (value || performance.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * The demo's second Codex session has an MCP App (the CI server's run card, `codexDemo.ts`): its page draws between the
 * text, gets Seshboard's theme and the call's input and result over the MCP Apps protocol, grows to its size, can't
 * reach a site it didn't declare, puts a message in the message box (for you to send), and is refused a tool call while
 * the session doesn't run here. Read-only: the message box is emptied again. Null when it all works, else what failed.
 */
export async function checkCodexMcpApp(win: BrowserWindow): Promise<string | null> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const id = (await js(`[...document.querySelectorAll('[data-session-id]')].find((row) => row.querySelector('[data-provider-mark="codex"]') && row.textContent.includes('orders test'))?.dataset.sessionId ?? null`)) as string | null;
  if (!id) return 'the demo Codex session with an MCP App is not in the sidebar';
  const view = `document.querySelector('[data-current-session="${id}"]')`;
  await js(`document.querySelector('[data-session-id="${id}"]')?.click()`);
  if (!(await waitInPage(win, `!!${view}?.querySelector('[data-mcp-app] [data-mcp-app-frame]')`, 10_000))) {
    return `the MCP App did not open (${String(await js(`${view}?.querySelector('[data-mcp-app]')?.innerText.slice(0, 160) ?? 'no app block'`))})`;
  }
  if (await js(`!!${view}.querySelector('[data-mcp-app]').closest('[data-steps]')`)) return 'the MCP App is folded into the steps';
  let frame: WebFrameMain | undefined;
  const started = performance.now();
  while (!frame && performance.now() - started < 5_000) {
    frame = win.webContents.mainFrame.framesInSubtree.find((f) => f.url.startsWith('seshboard-visual://app/'));
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!frame) return 'no frame on the MCP App page';
  if (!(await untilInFrame(frame, 'document.body?.dataset.result === "shown" && document.body.dataset.host === "Seshboard"', 5_000))) return 'the MCP App did not initialize with Seshboard and show the call result';
  if ((await frame.executeJavaScript('document.body.dataset.run')) !== '4821') return 'the MCP App did not get the call input';
  if (!(await frame.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary').trim()"))) return 'the MCP App has no theme variables';
  if (!(await waitInPage(win, `${view}.querySelector('[data-mcp-app-frame]').getBoundingClientRect().height > 60`, 3_000))) return 'the MCP App frame did not grow to its page';
  if ((await frame.executeJavaScript("fetch('https://example.com/').then(() => 'loaded', () => 'blocked')")) !== 'blocked') return 'the MCP App could reach a site it did not declare';

  const composer = `${view}.querySelector('[data-composer]')`;
  const before = (await js(`${composer}?.value ?? null`)) as string | null;
  if (before === null) return 'the Codex session has no message box';
  try {
    await frame.executeJavaScript("document.getElementById('ask').click()", true);
    if (!(await waitInPage(win, `${composer}.value.includes('Why does orders.test.ts fail on CI?')`, 3_000))) return "the MCP App's message did not go in the message box";
    await frame.executeJavaScript("document.getElementById('rerun').click()", true);
    const rerun = await untilInFrame(frame, 'document.body.dataset.rerun ?? null', 3_000);
    if (rerun !== 'refused') return `the MCP App's tool call ${rerun === 'ran' ? 'ran' : 'got no answer'} while the session doesn't run here`;
  } finally {
    await setFieldValue(win, `[data-current-session="${id}"] [data-composer]`, before);
  }
  return null;
}
