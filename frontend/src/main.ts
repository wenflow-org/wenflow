import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { ElLoading } from 'element-plus';
import 'element-plus/dist/index.css';

import App from './App.vue';
import router from './router';
import './styles/main.css';
import './styles/tremor-theme.css';  // Tremor 风格主题
import './styles/admin-theme.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
// Element Plus 组件由 unplugin-vue-components 按需自动引入；
// 此处仅注册全局指令与语言包（locale 通过 App.vue 的 el-config-provider 下发）
app.use(ElLoading);

app.mount('#app');
