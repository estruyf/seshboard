/*
 * What Seshboard starts for a canvas: `runner <sdk> <canvas.mjs>`, as Node (the app's own binary). It hands the canvas
 * `@seshboard/canvas` (the SDK next to it, so a canvas installs nothing) and then loads the canvas's file.
 */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const [sdk, entry] = process.argv.slice(2);
if (!sdk || !entry) {
  console.error('Usage: runner <sdk> <canvas.mjs>');
  process.exit(2);
}
const sdkUrl = pathToFileURL(sdk).href;
registerHooks({
  resolve: (specifier, context, next) => (specifier === '@seshboard/canvas' ? { url: sdkUrl, shortCircuit: true } : next(specifier, context)),
});
try {
  await import(pathToFileURL(entry).href);
} catch (error) {
  process.send?.({ type: 'log', level: 'error', message: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  console.error(error);
  process.exit(1);
}
