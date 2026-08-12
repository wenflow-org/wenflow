import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// 与 vite.config.ts 一致：模板内 Element Plus 图标/组件的按需自动引入
const iconNames = new Set(Object.keys(require('@element-plus/icons-vue')));

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [
        // 测试环境不注入 EP 样式（node_modules 内 .css 会被 Node 加载器直接解析而崩溃）；
        // 组件逻辑与渲染结构不受影响，样式断言不属于本套件范围
        ElementPlusResolver({ importStyle: false }),
        (name) => {
          if (iconNames.has(name)) {
            return { name, from: '@element-plus/icons-vue' };
          }
        }
      ],
      dirs: [],
      dts: false
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/views/admin-redesign/**/*.{ts,vue}', 'src/router/index.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage'
    }
  }
});
