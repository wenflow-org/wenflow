/**
 * YAML 蓝图类型定义
 * 对应 BLUEPRINT_SPEC_V3.md
 */

export interface YamlBlueprint {
  blueprintId: string
  archetype: 'conversational' | 'generator' | 'extractor' | 'distiller' | 'copywriter' | 'code-only'
  name: string
  version: string
  
  identity: {
    role: string
    mission: string
    scope?: Record<string, boolean>
  }
  
  rules: {
    context_usage?: ContextUsageRules
    behavior?: BehaviorRules
    state_machine?: StateMachineRules
  }
  
  output: {
    format: 'json' | 'markdown' | 'text'
    wrapper: boolean
    top_level_fields?: string[]
    field_definitions?: Record<string, FieldDefinition>
    strict_schema?: boolean
    forbidden_extra_text?: string[]
  }
  
  constraints: string[] | Array<Record<string, string>>  // 支持字符串数组或对象数组
  
  io_schema: {
    input: Record<string, any>
    output: Record<string, any>
  }
}

export interface ContextUsageRules {
  evaluation_mode: 'fresh_turn' | 'continuation'
  priority: string
  conflict_resolution: string
  fabrication_policy: 'forbidden' | 'allowed'
  fabrication_fallback: string
}

export interface BehaviorRules {
  max_questions_per_turn?: number
  understanding_stage?: StageRules
  proposing_stage?: StageRules
  ready_stage?: StageRules
  subject?: string
}

export interface StageRules {
  reply_structure?: string
  tone?: string
  no_interrogation?: string
  scope?: string
  detail_level?: string
  [key: string]: any
}

export interface StateMachineRules {
  stages: string[]
  stage_definitions: Record<string, string>
  transitions: Record<string, any>
  phase_rules?: string[]
}

export interface FieldDefinition {
  type: string
  description: string
  required?: boolean
  enum?: string[]
  properties?: Record<string, any>
  items?: any
}
