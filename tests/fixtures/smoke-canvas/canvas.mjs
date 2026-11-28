// The smoke run's canvas (docs/canvases.md): one page that says who it is and where it runs.
import { createServer } from 'node:http';
import { canvas, serve } from '@seshboard/canvas';

let server = null;

const host = serve(
  canvas({
    api: 1,
    name: 'Smoke canvas',
    description: 'A page for the smoke run',
    async open(ctx) {
      if (!server) {
        server = createServer((_request, response) => {
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end(`<!doctype html><title>Smoke canvas</title><h1 data-smoke-canvas>Smoke canvas page</h1><p>${ctx.instance}</p><a href="https://example.com/" id="out">Outside</a>`);
        });
        await new Promise((done) => server.listen(0, '127.0.0.1', done));
      }
      ctx.host.log(`serving on ${server.address().port}`);
      return { url: `http://127.0.0.1:${server.address().port}/`, title: 'Smoke canvas' };
    },
    close() {
      server?.close();
      server = null;
    },
    actions: {
      where: { description: 'Where the canvas shows', run: () => host.context() },
      ask: {
        description: 'Fills the message box',
        input: { type: 'object', properties: { text: { type: 'string' } } },
        run: (input) => (host.compose({ text: input?.text ?? 'From the smoke canvas', chips: [{ title: 'Smoke selection', text: 'picked in the canvas' }] }), { asked: true }),
      },
    },
  }),
);
