/**
 * ESLint flat config（2026-10-17 从 .eslintrc.cjs 迁移）。
 *
 * 迁移原因：`eslint-plugin-vue` 10 修掉了 postcss-selector-parser 的 DoS 漏洞，但 v10 不再提供
 * 旧式 eslintrc 的 `plugin:vue/vue3-essential` 入口，且 ESLint 8 无法加载它 —— 两条路只能一起升。
 * 规则集与迁移前逐条对齐（含存量 any 冻结名单与幽灵组件门禁），不做顺带收紧。
 */
const js = require('@eslint/js');
const vue = require('eslint-plugin-vue');
const vueParser = require('vue-eslint-parser');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const globals = require('globals');

// 存量 any 冻结点（2026-09 审计）：清理后请同步删除对应条目。
const ANY_FROZEN = [
  'src/api/learning.ts',
  'src/stores/user.ts',
  'src/utils/sse.ts',
  'src/views/LearningEvaluationPage.vue',
  'src/views/Profile.vue',
  'src/views/admin-redesign/AdminConsole.vue',
  'src/views/admin-redesign/DataFlowGraph.vue',
  'src/views/admin-redesign/FieldAddWizard.vue',
  'src/views/admin-redesign/FieldRoutingTable.vue',
  'src/views/admin-redesign/HealthCenter.vue',
  'src/views/admin-redesign/Login.vue',
  'src/views/admin-redesign/MemoryReview.vue',
  'src/views/admin-redesign/OpsCenter.vue',
  'src/views/admin-redesign/Orchestrator.vue',
  'src/views/admin-redesign/PromptEvalPanel.vue',
  'src/views/admin-redesign/PromptWorkbench.vue',
  'src/views/admin-redesign/QuickLearnPanel.vue',
  'src/views/admin-redesign/SandboxView.vue',
  'src/views/admin-redesign/SkillFieldRouting.vue',
  'src/views/admin-redesign/VirtualLearners.vue',
  'src/views/admin-redesign/__tests__/dataFlow.test.ts',
  'src/views/admin-redesign/__tests__/sessionCockpit.real.test.ts',
  'src/views/admin-redesign/__tests__/skills.header.test.ts',
  'src/views/admin-redesign/skill-design/protocol-tab.vue',
  'src/views/admin-redesign/useRowMenu.ts',
  'src/views/user/AgentLogs.vue',
  'src/views/user/Settings.vue',
  'src/views/v2/V2Dashboard.vue',
  'src/views/v2/V2LearningPage.vue',
  'src/views/v2/V2LearningPathDetail.vue',
  'src/views/v2/V2LearningPaths.vue',
  'src/views/v2/V2LearningState.vue',
  'src/views/v2/V2NotifCenter.vue',
  'src/views/v2/learningKp.ts',
  'src/views/v2/learningScene.ts',
  'src/views/v2/useGoalLive.ts',
  'src/views/v2/useCheckpointFlow.ts',
  'src/views/v2/usePeerAssistant.ts',
];

module.exports = [
  // src/.zcode 是工具生成的 workflow 运行产物，不是项目源码
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/.zcode/**'] },

  js.configs.recommended,
  ...vue.configs['flat/essential'],
  // 关掉与 TypeScript 语义冲突的核心规则（no-undef 等），与插件推荐用法一致
  tseslint.configs['flat/eslint-recommended'],

  {
    files: ['**/*.{ts,vue,js,cjs,mjs}'],
    plugins: { '@typescript-eslint': tseslint },
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'vue/multi-word-component-names': 'off',
      // 存量冻结：以下 overrides 中的历史文件暂时豁免；新文件一律 error（见 CONTRIBUTING）。
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      '@typescript-eslint/no-require-imports': 'off',
      /* 幽灵组件门禁：模板用了却没 import 的组件（<Link> / <EyeOff> / <SquareTerminal>…）
         会渲染成空白，但点击/交互仍然生效——极难自查（同 EyeOff 一类已复发三次，2026-09-29）。
         该规则只认「模板里用了、组件作用域内没定义」的大写标签，原生 HTML 元素不受影响。 */
      'vue/no-undef-components': ['error', {
        // vue-router 全局注册的两个组件不在文件内定义，非幽灵组件
        ignorePatterns: ['^Mk[A-Z]', '^router-link$', '^RouterLink$', '^router-view$', '^RouterView$'],
      }],
    },
  },

  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsparser },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsparser, ecmaVersion: 2021, sourceType: 'module' },
    },
  },

  {
    files: ['**/*.{js,cjs}'],
    languageOptions: { sourceType: 'commonjs' },
  },

  {
    files: ANY_FROZEN,
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];
