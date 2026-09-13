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
  coverageThreshold: {
    global: {
      statements: 45,
      branches: 33,
      functions: 43,
      lines: 45
    }
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  setupFilesAfterEnv: [],
  verbose: true,
  testTimeout: 10000
}