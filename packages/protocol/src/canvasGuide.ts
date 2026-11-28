/*
 * What an agent reads before it writes a canvas (the `canvas_guide` tool of the `seshboard` server, docs/canvases.md).
 * Keep it in step with the SDK in `packages/canvas/src/index.ts`: the example here is what agents copy.
 */
export const CANVAS_GUIDE = `# Writing a canvas for Seshboard

A canvas is a small web app of this project that Seshboard shows in a session's side panel, next to the conversation: a dashboard, an editor, a board, a preview. The user works in it, and the agent beside it helps through the canvas's actions and by changing the project's files.

## Where it lives

One folder per canvas, in the project's checkout:

    .seshboard/canvases/<id>/canvas.mjs

- \`<id>\` is lowercase letters, digits and dashes (at most 40). It is the canvas's id, and its name on the rail until it runs.
- \`canvas.mjs\` is an ES module. Seshboard starts it as a Node process in the project's folder (Node 24, no install step).
- Put the rest next to it: \`web/\` for the page, \`lib/\` for the Node side. Use Node's built-ins and browser code that needs no build. Do not add a package.json or node_modules for the SDK.
- \`@seshboard/canvas\` is resolved by Seshboard. Other packages are resolved as Node does from the canvas's folder, so the project's own node_modules work.

## The SDK

    import { canvas, serve } from '@seshboard/canvas';

    const host = serve(canvas({
      api: 1,                      // required: the API version
      name: 'Notes',               // on the rail and the panel, at most 40 characters
      description: 'The notes of this project',   // one sentence, for the agent and the user
      async open(ctx) { ... return { url, title }; },
      async close(ctx) { ... },    // optional
      actions: { ... },            // optional
    }));

- \`open(ctx)\` starts (or finds) a web server on 127.0.0.1 and returns \`{ url, title? }\`. The url must be http://127.0.0.1:<port>/ or localhost. Listen on port 0 so the system picks a free port. \`open\` can be called again for the same \`ctx.instance\`: answer with the same server, so unsaved work survives.
- \`ctx\` is \`{ instance, folder, input, host }\`. \`folder\` is the checkout the canvas works in (a worktree has its own). Read and write the project's files under it.
- \`close(ctx)\` stops the server.
- An action is \`name: { description, input, run(input, ctx) }\`. \`name\` is lowercase letters, digits and underscores. \`input\` is a JSON Schema. \`run\` returns JSON. Throw an Error with a clear message when it can't.
- \`host.log(message, level)\` writes to the canvas's log, with level 'info', 'warn' or 'error'. \`console.log\` goes there too, and \`console.error\` as a warning. The user opens the log from the panel's header, and you read it with canvas_log. Log what the user would want to know: what was saved, what was skipped, what failed and why.
- \`host.compose({ text, chips })\` puts text and chips in the message box of the session beside the canvas. It never sends: the user reads it and presses Send. A chip is \`{ file, lines: [start, end] }\` (a file by reference, lines optional) or \`{ title, text, file?, lines?, language? }\` (text that is not on disk as it is, such as a selection with unsaved edits).
- \`host.context()\` is \`{ folder, branch, theme, session }\` or null, and \`host.onContext(fn)\` is called when it changes. \`theme\` is 'light' or 'dark'.

## The page

- Plain web content from the canvas's own server. It has no bridge to Seshboard: it talks to its server (fetch, EventSource, WebSocket), and the server calls \`host\`.
- It runs in its own browser profile. Links to other sites open in the user's browser.
- Follow light and dark with \`prefers-color-scheme\`, and set a background colour: the panel is white behind a page that sets none.
- The panel can be narrow (about 400px) or the whole session area: lay the page out for both.
- The page stays as it is while its panel is behind another one. It loads again after the canvas stops (the user stops it, or nobody has had it open for five minutes) and when Seshboard restarts. So keep what matters in the server or in files, not only in the page.

## Working with the agent

- The agent changes files with its own tools. Watch the files you show (\`fs.watch\`) and update the page. If the user has unsaved edits in the page, ask which version wins instead of dropping them.
- Give the agent actions to see and steer, not to write: \`current\` (what the user has open, and their selection), \`open_item\`, \`list_items\`.
- For "ask the agent about this", call \`host.compose\` from a route the page posts to.
- Treat the project's content as untrusted in the page: escape it, and render Markdown through an allowlist.

## A complete example

    // .seshboard/canvases/notes/canvas.mjs
    import { createServer } from 'node:http';
    import { readFile, readdir } from 'node:fs/promises';
    import { join } from 'node:path';
    import { canvas, serve } from '@seshboard/canvas';

    let server = null;
    let current = null;

    const page = \`<!doctype html><meta charset="utf-8"><title>Notes</title>
    <style>
      :root { color-scheme: light dark; }
      body { font: 14px system-ui; margin: 16px; background: Canvas; color: CanvasText; }
      li { cursor: pointer; padding: 2px 0; }
    </style>
    <h1>Notes</h1><ul id="list"></ul><pre id="note"></pre><button id="ask" hidden>Ask about this note</button>
    <script>
      const show = async (name) => {
        const note = await (await fetch('/note?name=' + encodeURIComponent(name))).json();
        document.getElementById('note').textContent = note.text;
        document.getElementById('ask').hidden = false;
      };
      fetch('/notes').then((r) => r.json()).then((names) => {
        for (const name of names) {
          const li = document.createElement('li');
          li.textContent = name;
          li.onclick = () => show(name);
          document.getElementById('list').append(li);
        }
      });
      document.getElementById('ask').onclick = () => fetch('/ask', { method: 'POST' });
    </script>\`;

    const host = serve(canvas({
      api: 1,
      name: 'Notes',
      description: 'The Markdown notes in the notes folder of this project',
      async open(ctx) {
        if (!server) {
          const notes = join(ctx.folder, 'notes');
          server = createServer(async (request, response) => {
            const url = new URL(request.url, 'http://127.0.0.1');
            const json = (value) => response.setHeader('content-type', 'application/json').end(JSON.stringify(value));
            try {
              if (url.pathname === '/notes') return json((await readdir(notes)).filter((name) => name.endsWith('.md')));
              if (url.pathname === '/note') {
                const name = (url.searchParams.get('name') ?? '').replace(/[\\\\/]/g, '');
                current = join('notes', name);
                return json({ text: await readFile(join(notes, name), 'utf8') });
              }
              if (url.pathname === '/ask' && request.method === 'POST') {
                if (current) host.compose({ text: 'Tighten this note.', chips: [{ file: current }] });
                return json({});
              }
              response.setHeader('content-type', 'text/html; charset=utf-8').end(page);
            } catch (error) {
              response.statusCode = 500;
              json({ error: String(error.message ?? error) });
            }
          });
          await new Promise((done) => server.listen(0, '127.0.0.1', done));
        }
        return { url: 'http://127.0.0.1:' + server.address().port + '/' };
      },
      close() {
        server?.close();
        server = null;
      },
      actions: {
        current: { description: 'The note the user has open, or null', run: () => ({ file: current }) },
      },
    }));

## After you wrote or changed one

- Call open_canvas with its id. The first time, and after every change to canvas.mjs, the panel asks the user to trust it: tell them, and call open_canvas again after they did.
- If it fails, the panel shows why, with its log. canvas_log gives you the same lines. Fix the file and open it again.
- To try it without Seshboard there is no shortcut: \`@seshboard/canvas\` only resolves when Seshboard starts the canvas.
`;
