import {createApp} from 'vue';
import App from '/@/App.vue';
import router from '/@/router';
import { runAll } from './example';

runAll();

createApp(App)
  .use(router)
  .mount('#app');
