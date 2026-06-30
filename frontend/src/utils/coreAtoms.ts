/**
 * 核心原子定义库
 * 这些原子是最常用的配置单元
 */

import type { Atom } from '@/types/atomic'
import { registerAtom } from './atomLoader'

// ==================== 身份相关原子 ====================

const roleAtom: Atom = {
  atomId: 'role',
  category: 'identity',
  type: 'string',
  description: '角色身份',
  compileTemplate: '你是一个{{value}}。',
  validation: {
    required: true,
    errorMessage: '角色不能为空'
  },
  applicableArchetypes: ['conversational', 'generator', 'extractor', 'distiller', 'copywriter'],
  examples: [
    { value: '学习目标澄清助手', compiledTo: '你是一个学习目标澄清助手。' }
  ]
}

const missionAtom: Atom = {
  atomId: 'mission',
  category: 'identity',
  type: 'string',
  description: '任务描述',
  compileTemplate: '你的任务是{{value}}。',
  validation: {
    required: true,
    errorMessage: '任务描述不能为空'
  },
  applicableArchetypes: ['conversational', 'generator', 'extractor', 'distiller', 'copywriter'],
  examples: [
    { value: '通过对话澄清学习目标', compiledTo: '你的任务是通过对话澄清学习目标。' }
  ]
}

// ==================== 行为相关原子 ====================

const maxQuestionsPerTurnAtom: Atom = {
  atomId: 'max_questions_per_turn',
  category: 'behavior',
  type: 'number',
  range: [1, 5],
  default: 1,
  description: '每次最多提问数',
  compileTemplate: '每次最多问 {{value}} 个核心问题，避免连续追问。',
  validation: {
    min: 1,
    max: 5,
    errorMessage: '提问数必须在 1-5 之间'
  },
  applicableArchetypes: ['conversational'],
  examples: [
    { value: 1, compiledTo: '每次最多问 1 个核心问题，避免连续追问。' },
    { value: 3, compiledTo: '每次最多问 3 个核心问题，避免连续追问。' }
  ]
}

const toneAtom: Atom = {
  atomId: 'tone',
  category: 'behavior',
  type: 'string',
  description: '提问语气',
  compileTemplate: '提问语气优先使用{{value}}。',
  applicableArchetypes: ['conversational'],
  examples: [
    { value: 'natural_transition', compiledTo: '提问语气优先使用natural_transition。' }
  ]
}

const noInterrogationAtom: Atom = {
  atomId: 'no_interrogation',
  category: 'behavior',
  type: 'string',
  description: '避免审问式提问',
  compileTemplate: '提问语气{{value}}。',
  applicableArchetypes: ['conversational'],
  examples: [
    { value: '不能像问卷或审问', compiledTo: '提问语气不能像问卷或审问。' }
  ]
}

// ==================== 上下文相关原子 ====================

const evaluationModeAtom: Atom = {
  atomId: 'evaluation_mode',
  category: 'context',
  type: 'enum',
  enum: ['fresh_turn', 'continuation'],
  default: 'fresh_turn',
  description: '评估模式',
  compileTemplate: '这是 {{value}} evaluation。{{priority}}，不要把 conversationContext 当作需要续写的多轮聊天。',
  applicableArchetypes: ['conversational'],
  dependencies: ['priority'],
  examples: [
    { value: 'fresh_turn', compiledTo: '这是 fresh_turn evaluation。state优先，不要把 conversationContext 当作需要续写的多轮聊天。' }
  ]
}

const conflictResolutionAtom: Atom = {
  atomId: 'conflict_resolution',
  category: 'context',
  type: 'string',
  default: 'userInput_always_wins',
  description: '冲突解决策略',
  compileTemplate: '若 state 与 current turn payload 里的 userInput 冲突，必须以 userInput 为准，并在输出中修正状态。',
  applicableArchetypes: ['conversational'],
  examples: [
    { value: 'userInput_always_wins', compiledTo: '若 state 与 current turn payload 里的 userInput 冲突，必须以 userInput 为准，并在输出中修正状态。' }
  ]
}

const fabricationPolicyAtom: Atom = {
  atomId: 'fabrication_policy',
  category: 'context',
  type: 'enum',
  enum: ['forbidden', 'allowed'],
  default: 'forbidden',
  description: '编造策略',
  compileTemplate: '不要为了补全字段而编造用户没有明确提供的信息；{{fabrication_fallback}}。',
  applicableArchetypes: ['conversational', 'generator'],
  dependencies: ['fabrication_fallback'],
  examples: [
    { value: 'forbidden', compiledTo: '不要为了补全字段而编造用户没有明确提供的信息；不确定就空白或继续追问。' }
  ]
}

// ==================== 输出相关原子 ====================

const outputFormatAtom: Atom = {
  atomId: 'format',
  category: 'output',
  type: 'enum',
  enum: ['json', 'markdown', 'text'],
  default: 'json',
  description: '输出格式',
  compileTemplate: '只输出一个合法{{value}}对象，不要输出额外说明文本。',
  validation: {
    required: true,
    errorMessage: '输出格式不能为空'
  },
  applicableArchetypes: ['conversational', 'generator', 'extractor', 'distiller'],
  examples: [
    { value: 'json', compiledTo: '只输出一个合法json对象，不要输出额外说明文本。' }
  ]
}

const wrapperAtom: Atom = {
  atomId: 'wrapper',
  category: 'output',
  type: 'boolean',
  default: false,
  description: '是否允许包装符',
  compileTemplate: 'JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言。',
  applicableArchetypes: ['conversational', 'generator', 'extractor'],
  examples: [
    { value: false, compiledTo: 'JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言。' }
  ]
}

// ==================== 注册所有核心原子 ====================

export function registerCoreAtoms(): void {
  // Identity
  registerAtom(roleAtom)
  registerAtom(missionAtom)

  // Behavior
  registerAtom(maxQuestionsPerTurnAtom)
  registerAtom(toneAtom)
  registerAtom(noInterrogationAtom)

  // Context
  registerAtom(evaluationModeAtom)
  registerAtom(conflictResolutionAtom)
  registerAtom(fabricationPolicyAtom)

  // Output
  registerAtom(outputFormatAtom)
  registerAtom(wrapperAtom)
}

// 导出原子定义
export const coreAtoms = {
  role: roleAtom,
  mission: missionAtom,
  max_questions_per_turn: maxQuestionsPerTurnAtom,
  tone: toneAtom,
  no_interrogation: noInterrogationAtom,
  evaluation_mode: evaluationModeAtom,
  conflict_resolution: conflictResolutionAtom,
  fabrication_policy: fabricationPolicyAtom,
  format: outputFormatAtom,
  wrapper: wrapperAtom
}
