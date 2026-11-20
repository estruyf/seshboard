import { visualizeServer } from './server.ts';

// Seshboard's `visualize` MCP server, over stdio: an agent starts it as Seshboard's own binary run as Node
// (ELECTRON_RUN_AS_NODE), so it needs no Node of its own. It ends when the agent closes its input.
const take = visualizeServer((line) => process.stdout.write(line));
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => take(chunk));
process.stdin.on('end', () => process.exit(0));
