import type { IpcRenderer } from 'electron';

async function checkBackend(ipc: IpcRenderer) {
  // check for backend readiness (exponential backoff)
  for (let timeout = 1, ready = false; !ready; timeout *= 2) {
    // create channel for backend to send ACK on
    const { port1, port2 } = new MessageChannel();
    // ask backend if it's ready, retry after timeout
    ready = await new Promise<boolean>((resolve) => {
      port1.onmessage = () => resolve(true);
      ipc.postMessage('comlink-endpoint-exchange-ready', null, [port2]);
      setTimeout(() => resolve(false), timeout);
    });
    // can't retransfer the port so close and make new ports at top of loop
    port1.close();
    port2.close();
  }
}

export function registerElectronIpc(ipc: IpcRenderer): void {
  const backendReady = checkBackend(ipc);
  window.addEventListener('message', async ({ data, ports }) => {
    if (data !== 'comlink-endpoint-exchange-port') return;
    // once the backend is ready, forward the exchange ports
    await backendReady;
    ipc.postMessage(
      'comlink-endpoint-exchange-port',
      null,
      ports as MessagePort[],
    );
  });
}
