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
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
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
