import { ipcMain } from 'electron';
import type { Remote } from 'comlink';
import { expose, wrap, proxy } from 'comlink';
import {
  registerElectronIpc,
  ipcEndpoint,
  patchGlobalMessageChannel,
  patchProxyTransferHandler,
} from './comlink';

registerElectronIpc(ipcMain);

//
export function messagePortExample(): void {
  const ep = ipcEndpoint('messagePortExample');
  ep.addEventListener('message', (a) => console.log(a));
  ep.start?.();
  ep.postMessage('HELLO THERE!');
}

export function remoteServerObjectExample(): void {
  const ep = ipcEndpoint('remoteServerObjectExample');
  const obj = { location: 'browser', tag: '', log: console.log };
  expose(obj, ep);
}

export async function remoteBrowserObjectExample(): Promise<void> {
  const ep = ipcEndpoint('remoteBrowserObjectExample');
  const remote = wrap(ep) as Remote<any>;

  remote.log('remoteBrowserObjectExample', 'calling browser function from server');
  remote.tag = 'value set by server';
  console.log(
    'remoteBrowserObjectExample',
    'location:',
    await remote.location,
    'tag:',
    await remote.tag,
  );
}

const sleep = (timeout: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, timeout));

export function passProxyToServerExample(): void {
  // to use proxy, we must patch the transferHandler or the global MessageChannel
  patchProxyTransferHandler();

  const ep = ipcEndpoint('passProxyToServerExample');
  const longRunningTask = async (progress: (percent: number) => void) => {
    // const longRunningTask = async () => {
    console.log('longRunningTask started');
    for (let i = 0; i < 10; ++i) {
      console.log('crunching numbers');
      progress(10 * i);
      await sleep(2000);
    }
    return 'longRunningTask on server finished!';
  };
  expose({ longRunningTask }, ep);
}

export async function passProxyToBrowserExample(): Promise<void> {
  // to use proxy, we must patch the transferHandler or the global MessageChannel
  patchGlobalMessageChannel();

  const ep = ipcEndpoint('passProxyToBrowserExample');
  const remote = wrap(ep) as Remote<any>;
  const onProgress = (percent: number) =>
    console.log('long running task in browser is ' + percent + '% complete.');
  const result = await remote.longRunningTask(proxy(onProgress));
  console.log('long running task in browser result:', result);
}

export const runAll = (): void =>
  [
    // remoteServerObjectExample,
    // remoteBrowserObjectExample,
    passProxyToServerExample,
    // passProxyToBrowserExample,
  ].forEach((example) => example());
