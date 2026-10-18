import type { Client } from './Connected.tsx';

/** A number per connection, so what a computer was asked for is asked again once it connected again. 0: none. */
const connections = new WeakMap<object, number>();
let last = 0;

export function connectionOf(client: Client): number {
  if (!client) return 0;
  let n = connections.get(client);
  if (n === undefined) connections.set(client, (n = ++last));
  return n;
}
