import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// @element-plus/icons-vue 的全部导出名，用于模板图标的按需自动引入
const iconNames = new Set(Object.keys(require('@element-plus/icons-vue')));

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [
        ElementPlusResolver({ importStyle: 'css' }),
        // 模板中使用的 EP 图标组件按需自动引入（替代 main.ts 的全量注册）
        (name) => {
          if (iconNames.has(name)) {
            return { name, from: '@element-plus/icons-vue' };
          }
        }
      ],
      // 本地组件目录不参与自动解析，避免与图标重名时误判
      dirs: [],
      dts: false
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          // 管理台大页此前把 EP 组件与 markdown/highlight 栈一并打进单个路由 chunk（696KB），
          // 按库域拆分以改善缓存与加载
          'vendor-element': ['element-plus', '@element-plus/icons-vue'],
          'vendor-content': ['markdown-it', 'dompurify', 'highlight.js', 'markdown-it-texmath'],
          mermaid: ['mermaid'],
          katex: ['katex']
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:3001',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // 仅对 JSON API 响应强制 UTF-8（避免破坏 CSV 等二进制导出）
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('application/json') || !contentType) {
              proxyRes.headers['content-type'] = 'application/json; charset=utf-8';
            }
          });
        }
      }
    }
  }
});
