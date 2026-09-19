/* eslint-env node */
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2021: true
  },
  extends: [
    'plugin:vue/vue3-essential',
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  plugins: ['vue', '@typescript-eslint'],
  rules: {
    'vue/multi-word-component-names': 'off',
    // 存量冻结：以下 overrides 中的历史文件暂时豁免；新文件一律 error（见 CONTRIBUTING）。
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    '@typescript-eslint/no-require-imports': 'off'
  },
  ignorePatterns: ['dist/**', 'node_modules/**'],
  overrides: [
    {
      // 存量 any 冻结点（2026-09 审计）；清理后请同步删除对应条目。
      files: [
    "src/api/learning.ts",
    "src/stores/user.ts",
    "src/utils/sse.ts",
    "src/views/LearningEvaluationPage.vue",
    "src/views/Profile.vue",
    "src/views/admin-redesign/AdminConsole.vue",
    "src/views/admin-redesign/DataFlowGraph.vue",
    "src/views/admin-redesign/FieldAddWizard.vue",
    "src/views/admin-redesign/FieldRoutingTable.vue",
    "src/views/admin-redesign/HealthCenter.vue",
    "src/views/admin-redesign/MemoryReview.vue",
    "src/views/admin-redesign/OpsCenter.vue",
    "src/views/admin-redesign/Orchestrator.vue",
    "src/views/admin-redesign/PromptEval.vue",
    "src/views/admin-redesign/PromptWorkbench.vue",
    "src/views/admin-redesign/SandboxView.vue",
    "src/views/admin-redesign/SkillFieldRouting.vue",
    "src/views/admin-redesign/VirtualLearners.vue",
    "src/views/admin-redesign/__tests__/dataFlow.test.ts",
    "src/views/admin-redesign/__tests__/sessionCockpit.real.test.ts",
    "src/views/admin-redesign/__tests__/skills.header.test.ts",
    "src/views/admin-redesign/skill-design/protocol-tab.vue",
    "src/views/admin-redesign/useRowMenu.ts",
    "src/views/admin/Login.vue",
    "src/views/admin/components/virtual/QuickLearnPanel.vue",
    "src/views/user/AgentLogs.vue",
    "src/views/user/Settings.vue",
    "src/views/v2/V2Dashboard.vue",
    "src/views/v2/V2LearningPage.vue",
    "src/views/v2/V2LearningPathDetail.vue",
    "src/views/v2/V2LearningPaths.vue",
    "src/views/v2/V2LearningState.vue",
    "src/views/v2/V2NotifCenter.vue",
    "src/views/v2/useGoalLive.ts"
  ],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off'
      }
    }
  ]
};
