import type { Remote } from 'comlink';
import { expose, wrap, proxy } from 'comlink';
import { registerElectronIpc, ipcEndpoint } from './comlink';

registerElectronIpc();

export function messagePortExample(): void {
  const ep = ipcEndpoint('messagePortExample');
  ep.addEventListener('message', (a) => console.log(a));
  ep.start?.();
  ep.postMessage('GENERAL KENOBI!!');
}

export async function remoteServerObjectExample(): Promise<void> {
  const ep = ipcEndpoint('remoteServerObjectExample');
  const remote = wrap(ep) as Remote<any>;

  remote.log('remoteServerObjectExample', 'calling server function from browser');
  remote.tag = 'value set by browser';
  console.log(
    'remoteServerObjectExample',
    'location:',
    await remote.location,
    'tag:',
    await remote.tag,
  );
}

export function remoteBrowserObjectExample(): void {
  const ep = ipcEndpoint('remoteBrowserObjectExample');
  const obj = { location: 'browser', tag: '', log: console.log };
  expose(obj, ep);
}

const sleep = (timeout: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, timeout));

export async function passProxyToServerExample(): Promise<void> {
  const ep = ipcEndpoint('passProxyToServerExample');
  const remote = wrap(ep) as Remote<any>;
  const onProgress = (percent: number) =>
    console.log('long running task on server is ' + percent + '% complete.');
  const result = await remote.longRunningTask(proxy(onProgress));
  // const result = await remote.longRunningTask();
  console.log('long running task on server result:', result);
}

export function passProxyToBrowserExample(): void {
  const ep = ipcEndpoint('passProxyToBrowserExample');
  const longRunningTask = async (progress: (percent: number) => void) => {
    for (let i = 0; i < 10; ++i) {
      console.log('crunching numbers');
      progress(10 * i);
      await sleep(2000);
    }
    return 'longRunningTask in browser result!';
  };
  expose({ longRunningTask }, ep);
}

export const runAll = (): void =>
  [
    // remoteServerObjectExample,
    // remoteBrowserObjectExample,
    passProxyToServerExample,
    // passProxyToBrowserExample,
  ].forEach((example) => example());
