import type { Endpoint } from 'comlink';
import type { Message, WireValue } from 'comlink/src/protocol';
import { WireValueType, MessageType } from 'comlink/src/protocol';

// log toggler
const log = false;
const logger = log ? console.log : null;

let setExchange: (value: MessagePort | PromiseLike<MessagePort>) => void;
const exchange = new Promise<MessagePort>((resolve) => (setExchange = resolve));

// create exchange port for passing ipc endpoints and pass to preload relay
export const registerElectronIpc = (): void => {
  const { port1, port2 } = new MessageChannel();
  window.postMessage('comlink-endpoint-exchange-port', '*', [port2]);
  port1.start();
  setExchange(port1);
};

// store original ports in case we need to transfer the ep
const epPorts = new WeakMap<Endpoint, MessagePort>();

// MessagePortMain is not StructuredCloneable but the proxy transferHandler
// relies on being able to pass a MessagePort via the postMessage body.
// Instead, we swap out the passed port for an index into transfers and set the
// message type to a proxy token.
const proxyToken = null;
// if val is transferred endpoint, remove it from the WireValue, and mark with
// our own WireValueType (null "SHOULD" be a safe sentinel value for WireValueType)
function packWireValue(val: WireValue, transfers: readonly MessagePort[]) {
  if (val.type !== WireValueType.HANDLER) return val;
  const index = transfers.findIndex((p) => val.value === p);
  if (index >= 0) {
    val.type = (proxyToken as unknown) as WireValueType.HANDLER;
    val.value = index;
  }
  return val;
}
// check for our proxyToken sentinel value and swap out the index for the endpoint
function unpackWireValue(val: WireValue, transfers: readonly MessagePort[]) {
  if (val.type !== ((proxyToken as unknown) as WireValueType)) return val;
  val.type = WireValueType.HANDLER;
  val.value = messagePortEndpoint(transfers[val.value as number]);
  return val;
}
// pack all the transferrables and make sure we are sending ports across
function packMessage(
  message: Message,
  transfers: readonly MessagePort[],
): [message: Message, transfers: MessagePort[]] {
  if (message.type === MessageType.SET)
    message.value = packWireValue(message.value, transfers);
  else if (
    message.type === MessageType.APPLY ||
    message.type === MessageType.CONSTRUCT
  )
    message.argumentList = message.argumentList.map((v) =>
      packWireValue(v, transfers),
    );
  return [
    message,
    transfers.map((t) => (epPorts.has(t) ? epPorts.get(t)! : t)),
  ];
}
// unpack the transferred ports into endpoints
function unpackMessage(message: Message, transfers: readonly MessagePort[]) {
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
export function messagePortEndpoint(port: MessagePort): Endpoint {
  const listeners = new WeakMap();
  const ep = {
    postMessage(message: Message, ports: MessagePort[]) {
      logger?.('messagePortEndpoint.postMessage', message, ports);
      // shim for comlink proxy
      if (ports?.length) port.postMessage(...packMessage(message, ports));
      else port.postMessage(message, ports);
    },
    addEventListener: (_, eh: CallableFunction) => {
      logger?.('messagePortEndpoint.addEventListener', eh);
      const l = ({ data, ports }: MessageEvent) => {
        logger?.('messagePortEndpoint.emit', data);
        // shim for comlink proxy
        if (ports?.length) eh({ data: unpackMessage(data, ports) });
        else eh({ data });
      };
      port.addEventListener('message', l);
      listeners.set(eh, l);
    },
    removeEventListener: (_, eh) => {
      logger?.('messagePortEndpoint.removeEventListener', eh);
      const l = listeners.get(eh);
      if (!l) {
        return;
      }
      port.removeEventListener('message', l);
      listeners.delete(eh);
    },
    start: port.start.bind(port),
  } as Endpoint;
  epPorts.set(ep, port);
  return ep;
}

// creates an endpoint and sends the other end to the exchange in main
export function ipcEndpoint(channel = ''): Endpoint {
  logger?.('ipcEndpoint:' + channel);
  const { port1, port2 } = new MessageChannel();
  exchange.then((ex) => ex.postMessage(channel, [port2]));
  return messagePortEndpoint(port1);
}
