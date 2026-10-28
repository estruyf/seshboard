import type { MessagePortMain } from 'electron';
import { isWireMessage, type Transport } from '@seshboard/protocol';

/** Adapts Electron's MessagePortMain (main and utility processes) to the protocol Transport. */
export function mainPortTransport(port: MessagePortMain): Transport {
  return {
    send: (message) => port.postMessage(message),
    onMessage(listener) {
      const handler = (event: Electron.MessageEvent) => {
        if (isWireMessage(event.data)) listener(event.data);
      };
      port.on('message', handler);
      port.start();
      return () => port.off('message', handler);
    },
    close: () => port.close(),
  };
}
