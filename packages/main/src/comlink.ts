import type { IpcMain, MessagePortMain } from 'electron';
import { MessageChannelMain } from 'electron';
import type { Endpoint } from 'comlink';
import { expose, transferHandlers } from 'comlink';
import type { Message, WireValue } from 'comlink/src/protocol';
import { WireValueType, MessageType } from 'comlink/src/protocol';

// log toggler
const log = false;
const logger = log ? console.log : null;

// setup port exchange, anytime a port comes in on the exchange it is
// either added to ports or glued to a port already in ports
const exchangePorts = new Map<string, MessagePortMain>();
// "glues" two ports together, allowing us to immediately return a port
// from ipcEndpoint while still waiting for slow joiners
const glue = (id: string, port1: MessagePortMain) => {
  const port2 = exchangePorts.get(id);
  if (!port2) {
    logger?.('glue:set', id, port1);
    exchangePorts.set(id, port1);
  } else {
    logger?.('glue:join', id, port1, port2);
    exchangePorts.delete(id);

    const forward1 = ({ data, ports }: Electron.MessageEvent) => {
      logger?.('glue.forward1:' + id);
      port1.postMessage(data, ports);
    };

    const forward2 = ({ data, ports }: Electron.MessageEvent) => {
      logger?.('glue.forward2:' + id);
      port2.postMessage(data, ports);
    };

    port1.on('message', forward2);
    port2.on('message', forward1);

    const close = () => {
      logger?.('glue:close:' + id);
      port1.off('message', forward2);
      port2.off('message', forward1);
      port1.close();
      port2.close();
    };

    port1.once('close', close);
    port2.once('close', close);

    port1.start();
    port2.start();
  }
};

// sets up required listeners to transfer the initial exchange port. logic for
// handling multiple exchanges could be better, currently two browsers cannot
// request a port on the same channel, they will either be glued together or
// only one will be glued to the backend.
export const registerElectronIpc = (ipc: IpcMain): void => {
  logger?.('registerElectronIpc called');
  // setTimeout(() => {
  //   logger?.("race condition Fired");
  ipc.on('comlink-endpoint-exchange-ready', (e) =>
    e.ports[0].postMessage(null),
  );
  ipc.on('comlink-endpoint-exchange-port', (init) => {
    logger?.('comlink-endpoint-exchange-port received');
    const exchange = init.ports[0];
    exchange.on('message', ({ data: id, ports }) => {
      logger?.('exchange.received:', id, ports[0]);
      glue(id, ports[0]);
    });
    exchange.start();
  });
  // }, 3000);
};

// store original ports in case we need to transfer the ep
const epPorts = new WeakMap<Endpoint, MessagePortMain>();

// MessagePortMain is not StructuredCloneable but the proxy transferHandler
// relies on being able to pass a MessagePort via the postMessage body.
// Instead, we swap out the passed port for an index into transfers and set the
// message type to a proxy token.
const proxyToken = null;
// if val is transferred endpoint, remove it from the WireValue, and mark with
// our own WireValueType (null "SHOULD" be a safe sentinel value for WireValueType)
function packWireValue(val: WireValue, transfers: any[]) {
  if (val.type !== WireValueType.HANDLER) return val;
  const index = transfers.findIndex((p) => val.value === p);
  if (index >= 0) {
    val.type = (proxyToken as unknown) as WireValueType.HANDLER;
    val.value = index;
  }
  return val;
}
// check for our proxyToken sentinel value and swap out the index for the endpoint
function unpackWireValue(val: WireValue, transfers: any[]) {
  if (val.type !== ((proxyToken as unknown) as WireValueType)) return val;
  val.type = WireValueType.HANDLER;
  val.value = messagePortMainEndpoint(transfers[val.value as number]);
  return val;
}
// pack all the transferrables and make sure we are sending ports across
function packMessage(
  message: Message,
  transfers: any[],
): [message: Message, transfers: any[]] {
  if (message.type === MessageType.SET)
    message.value = packWireValue(message.value, transfers);
  else if (
    message.type === MessageType.APPLY ||
    message.type === MessageType.CONSTRUCT
  )
    message.argumentList = message.argumentList.map((v) =>
      packWireValue(v, transfers),
    );
  return [message, transfers.map((t) => (epPorts.has(t) ? epPorts.get(t) : t))];
}
// unpack the transferred ports into endpoints
function unpackMessage(message: Message, transfers: any[]) {
  if (message.type === MessageType.SET)
    message.value = unpackWireValue(message.value, transfers);
  else if (
    message.type === MessageType.APPLY ||
    message.type === MessageType.CONSTRUCT
  )
    message.argumentList = message.argumentList.map((v) =>
      unpackWireValue(v, transfers),
    );
  return message;
}

// wraps a messagePort in the logic required for a comlink endpoint,
export function messagePortMainEndpoint(port: MessagePortMain): Endpoint {
  const listeners = new WeakMap();
  const ep = {
    postMessage(message: Message, ports: any[]) {
      logger?.('messagePortMainEndpoint.postMessage', message, ports);
      // shim for comlink proxy
      if (ports?.length) port.postMessage(...packMessage(message, ports));
      else port.postMessage(message, ports);
    },
    addEventListener: (_: any, eh: any) => {
      logger?.('messagePortMainEndpoint.addEventListener', eh);
      const l = ({ data, ports }: Electron.MessageEvent) => {
        logger?.('messagePortMainEndpoint.emit', data);
        // shim for comlink proxy
        if (ports?.length) eh({ data: unpackMessage(data, ports as any) });
        else eh({ data });
      };
      port.on('message', l);
      listeners.set(eh, l);
    },
    removeEventListener: (_: any, eh: any) => {
      logger?.('messagePortMainEndpoint.removeEventListener', eh);
      const l = listeners.get(eh);
      if (!l) {
        return;
      }
      port.off('message', l);
      listeners.delete(eh);
    },
    start: port.start.bind(port),
  };
  epPorts.set(ep, port);
  return ep;
}

// creates an endpoint paired with one on the matching channel in the browser
// checks exchange for received port, registers for glueing if not found
export function ipcEndpoint(channel = ''): Endpoint {
  const port = exchangePorts.get(channel);
  if (port) {
    logger?.('ipcMainEndpoint:found' + channel);
    exchangePorts.delete(channel);
    return messagePortMainEndpoint(port);
  } else {
    logger?.('ipcMainEndpoint:glue' + channel);
    const { port1, port2 } = new MessageChannelMain();
    glue(channel, port2);
    return messagePortMainEndpoint(port1);
  }
}

// dummy MessageChannel class, for either patching proxy or injecting into globalThis
class MC {
  port1: Endpoint;
  port2: Endpoint;
  constructor() {
    const { port1, port2 } = new MessageChannelMain();
    this.port1 = messagePortMainEndpoint(port1);
    this.port2 = messagePortMainEndpoint(port2);
  }
}

let globalPatched = false;
// patch the MessageChannel class in global for the default proxyTransferHandler
export function patchGlobalMessageChannel(): void {
  if (globalPatched) return;
  globalPatched = true;
  (globalThis as any).MessageChannel = MC;
}

let handlerPatched = false;
// as an alternative to patching global, we can just patch the transferHandler instead
// based on https://github.com/GoogleChromeLabs/comlink/blob/v4.3.0/src/comlink.ts#L215
export const patchProxyTransferHandler = (): void => {
  if (handlerPatched) return;
  handlerPatched = true;
  logger?.('patchMainProxy');
  const handler = transferHandlers.get('proxy');
  if (!handler) return;
  handler.serialize = (obj: unknown) => {
    const { port1, port2 } = new MC();
    expose(obj, port1);
    return [port2, [port2 as any]];
  };
  transferHandlers.set('proxy', handler);
};

// calling both patchGlobalMessageChannel and patchProxyTransferHandler is fine
