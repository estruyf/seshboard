import type { ComputerEvent, ComputerMethod, Contract, EventPayload, ParamsOf, RemoteContract, ResultOf, RpcClient } from '@seshboard/protocol/client';

/**
 * A request to another computer, typed with its remote contract. The engine passes it on as is; the other computer
 * checks the params. Its answer is shown as text, never as HTML, as in the remote app.
 */
export function callComputer<M extends ComputerMethod>(client: RpcClient<Contract>, computerId: string, method: M, params: ParamsOf<RemoteContract, M>): Promise<ResultOf<RemoteContract, M>> {
  return client.call('computers.call', { computerId, method, params: params as never }) as Promise<ResultOf<RemoteContract, M>>;
}

type RemoteEventName = keyof RemoteContract['events'] & string;

/** Listens for one event of a computer's remote contract. */
export function onComputerEvent<E extends RemoteEventName>(client: RpcClient<Contract>, computerId: string, name: E, listener: (payload: EventPayload<RemoteContract, E>) => void): () => void {
  return client.on('computers.event', (event: ComputerEvent) => {
    if (event.computerId === computerId && event.name === name) listener(event.payload as unknown as EventPayload<RemoteContract, E>);
  });
}
