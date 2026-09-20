import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  // element-plus 已整体移除（markup 与样式面先清零，本批删依赖、解析器与分包），仅保留 vue 插件
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    rollupOptions: {
      output: {
        // 函数形式分包:对象形式会把 Vite 的 __vitePreload 助手卷进具名分块,
        // 导致入口被 modulepreload mermaid/vendor-content(首屏强载 ~1MB 无关 JS)。
        // mermaid/katex 不再具名:mermaid 本就是动态 import 自然独立成块(且按图类型再拆),
        // katex 由默认算法收敛进共享 chunk,均不进首屏。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](vue|vue-router|pinia|@vue)[\\/]/.test(id)) return 'vendor-vue';
          if (/[\\/]node_modules[\\/](markdown-it|markdown-it-texmath|dompurify|highlight\.js)[\\/]/.test(id)) return 'vendor-content';
          return undefined;
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
