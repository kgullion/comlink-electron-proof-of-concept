import { ipcRendererEndpoint } from '../comlink';
import { wrap } from 'comlink';

const ep = ipcRendererEndpoint();
console.log('endpointDispenser', ep);

const remote = wrap<any>(ep) as any;

(async () => {
  remote.log('watup');
  console.log('from backend', await remote.platform());
  // , await remote.version(), await remote.root());
})();
