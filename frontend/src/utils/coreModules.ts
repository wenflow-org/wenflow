/**
 * 核心模块定义库
 * 这些模块组合原子形成功能块
 */

import type { Module } from '@/types/atomic'
import { registerModule } from './moduleLoader'

// ==================== 身份定义模块 ====================

const identityModule: Module = {
  moduleId: 'identity',
  category: 'identity',
  displayName: '身份定义',
  atoms: ['role', 'mission'],
  compositionOrder: ['role', 'mission'],
  sectionTemplate: `## 身份定义

{{atoms}}`,
  applicableArchetypes: ['conversational', 'generator', 'extractor', 'distiller', 'copywriter']
}

// ==================== 上下文使用规则模块 ====================

const contextUsageRulesModule: Module = {
  moduleId: 'context_usage_rules',
  category: 'rules',
  displayName: '上下文使用规则',
  atoms: [
    'evaluation_mode',
    'priority',
    'conflict_resolution',
    'fabrication_policy',
    'fabrication_fallback'
  ],
  compositionOrder: [
    'evaluation_mode',
    'conflict_resolution',
    'fabrication_policy'
  ],
  sectionTemplate: `### 上下文使用规则

{{atoms}}`,
  compileLogic: {
    conditionalAtoms: [
      {
        condition: "fabrication_policy === 'forbidden'",
        requiredAtoms: ['fabrication_fallback']
      }
    ]
  },
  applicableArchetypes: ['conversational']
}

// ==================== 行为规则模块 ====================

const behaviorRulesModule: Module = {
  moduleId: 'behavior_rules',
  category: 'rules',
  displayName: '行为规则',
  atoms: [
    'max_questions_per_turn',
    'tone',
    'no_interrogation',
    'understanding_stage_reply_structure',
    'proposing_stage_scope',
    'ready_stage_scope',
    'subject'
  ],
  compositionOrder: [
    'max_questions_per_turn',
    'understanding_stage_reply_structure',
    'tone',
    'no_interrogation',
    'proposing_stage_scope',
    'ready_stage_scope',
    'subject'
  ],
  sectionTemplate: `### 行为规则

{{atoms}}`,
  applicableArchetypes: ['conversational']
}

// ==================== 输出规格模块 ====================

const outputSpecModule: Module = {
  moduleId: 'output_spec',
  category: 'output',
  displayName: '输出规格',
  atoms: [
    'format',
    'wrapper',
    'top_level_fields',
    'strict_schema'
  ],
  compositionOrder: [
    'format',
    'top_level_fields',
    'wrapper',
    'strict_schema'
  ],
  sectionTemplate: `## 输出规格

{{atoms}}`,
  applicableArchetypes: ['conversational', 'generator', 'extractor', 'distiller']
}

// ==================== 边界约束模块 ====================

const constraintsModule: Module = {
  moduleId: 'constraints',
  category: 'constraints',
  displayName: '边界约束',
  atoms: ['constraint_list'],
  sectionTemplate: `## 边界约束

{{atoms}}`,
  applicableArchetypes: ['conversational', 'generator', 'extractor', 'distiller', 'copywriter']
}

// ==================== 执行规则模块（组合）====================

const executionRulesModule: Module = {
  moduleId: 'execution_rules',
  category: 'rules',
  displayName: '执行规则',
  atoms: [], // 此模块通过依赖其他模块组合而成
  sectionTemplate: `## 执行规则

{{atoms}}`,
  dependencies: ['context_usage_rules', 'behavior_rules'],
  applicableArchetypes: ['conversational']
}

// ==================== 注册所有核心模块 ====================

export function registerCoreModules(): void {
  registerModule(identityModule)
  registerModule(contextUsageRulesModule)
  registerModule(behaviorRulesModule)
  registerModule(outputSpecModule)
  registerModule(constraintsModule)
  registerModule(executionRulesModule)
}

// 导出模块定义
export const coreModules = {
  identity: identityModule,
  context_usage_rules: contextUsageRulesModule,
  behavior_rules: behaviorRulesModule,
  output_spec: outputSpecModule,
  constraints: constraintsModule,
  execution_rules: executionRulesModule
}
