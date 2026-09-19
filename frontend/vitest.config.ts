import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

// element-plus 已整体移除：测试配置不再需要组件自动引入插件

export default defineConfig({
  plugins: [vue()],
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
      // 即使有测试失败也产出覆盖率报告：否则「测试红 → 看不到覆盖率」会让门槛形同虚设
      reportOnFailure: true,
      // 纳入 include 范围内未被测试触达的文件（按 0% 计入），阈值才有防劣化意义
      all: true,
      include: [
        'src/views/admin-redesign/**/*.{ts,vue}',
        'src/router/index.ts',
        // 安全核心（sanitize/projection/sse/toast）必须纳入覆盖率度量，
        // 防止「零测试」被报告口径系统性掩盖
        'src/utils/**/*.ts'
      ],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      // 防劣化门槛（2026-09 审计接入）：按当时实测 60.85/65.5/43.53/60.85 略降设置，
      // 目标是「不允许继续变差」，后续随补测逐步上调。
      thresholds: {
        statements: 55,
        branches: 55,
        functions: 40,
        lines: 55
      }
    }
  }
});
