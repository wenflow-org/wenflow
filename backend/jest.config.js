// 产品日边界口径 = 应用时区本地日（中文产品，Asia/Shanghai）。CI runner 默认 UTC，
// 不钉时区则 day-boundary 类断言（audit-logs timeRange、platform-overview 24h 桶等）
// 在 CI 必挂而本地（UTC+8）全绿。此处赋值在 worker 派生前生效，CI 与本地同口径。
process.env.TZ = 'Asia/Shanghai';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts'
  ],
  // 防劣化门槛（2026-09 审计接入）：按当时实测 49.69/37.91/48.3/50.45 略降设置，
  // 只允许上调、不允许为过 CI 下调。
  // COVERAGE_THRESHOLDS_OFF=1：CI 矩阵分片跑（quality-check.yml test-backend）时置位——
  // 分片只含 1/3 套件，自身覆盖率天然低于全局阈值（实证 shard1=34% vs 阈值 45%），
  // jest 的分片末自验必须关闭；阈值由 coverage-merge 合并三分片后统一验收
  // （scripts/merge-coverage.mjs require 本配置同一份阈值，单一真相源不变）。
  coverageThreshold: process.env.COVERAGE_THRESHOLDS_OFF === '1'
    ? { global: { statements: 0, branches: 0, functions: 0, lines: 0 } }
    : {
        global: {
          statements: 45,
          branches: 33,
          functions: 43,
          lines: 45
        }
      },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  setupFilesAfterEnv: [],
  verbose: true,
  testTimeout: 10000
}