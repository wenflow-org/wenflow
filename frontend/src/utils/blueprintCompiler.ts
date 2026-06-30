/**
 * 蓝图编译器 - 将 YAML 蓝图编译成可执行的 Prompt
 * Blueprint (YAML) → Compiler → Prompt (Markdown)
 */

import type { YamlBlueprint } from '@/types/blueprint'

export interface CompileOptions {
  includeComments?: boolean
  ruleNumbering?: boolean
}

/**
 * 编译蓝图为 Prompt Markdown
 */
export function compileBlueprint(blueprint: YamlBlueprint, options: CompileOptions = {}): string {
  const lines: string[] = []
  let ruleCounter = 1
  let outCounter = 1
  let conCounter = 1

  const { ruleNumbering = true } = options

  // ==================== Frontmatter ====================
  lines.push('---')
  lines.push(`agentId: skill:${blueprint.blueprintId}`)
  lines.push(`archetype: ${blueprint.archetype}`)
  lines.push(`description: ${blueprint.name}`)
  lines.push(`temperature: 0.7`)
  lines.push(`maxTokens: 8000`)
  lines.push('---')
  lines.push('')

  // ==================== 身份定义 ====================
  if (blueprint.identity) {
    lines.push('## 身份定义')
    lines.push('')
    lines.push(`你是一个${blueprint.identity.role}。`)
    lines.push('')
    
    let missionLine = `你的任务是${blueprint.identity.mission}。`
    
    if (blueprint.identity.scope) {
      const scopeItems: string[] = []
      if (blueprint.identity.scope.not_business_consultant) scopeItems.push('不是业务顾问')
      if (blueprint.identity.scope.not_full_path_generator) scopeItems.push('不是正式的学习路径生成器')
      if (blueprint.identity.scope.not_teaching_agent) scopeItems.push('不是教学代理')
      
      if (scopeItems.length > 0) {
        missionLine += `你${scopeItems.join('，也')}。`
      }
    }
    
    lines.push(missionLine)
    lines.push('')
  }

  // ==================== 执行规则 ====================
  if (blueprint.rules) {
    lines.push('## 执行规则')
    lines.push('')

    // 上下文使用规则
    if (blueprint.rules.context_usage) {
      lines.push('### 上下文使用规则')
      lines.push('')
      const ctx = blueprint.rules.context_usage
      
      if (ctx.evaluation_mode === 'fresh_turn') {
        lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 这是 fresh turn evaluation。${ctx.priority}，不要把 conversationContext 当作需要续写的多轮聊天。`)
      }
      if (ctx.conflict_resolution) {
        lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 若 state 与 current turn payload 里的 userInput 冲突，必须以 userInput 为准，并在输出中修正状态。`)
      }
      if (ctx.fabrication_policy === 'forbidden') {
        lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 不要为了补全字段而编造用户没有明确提供的信息；${ctx.fabrication_fallback}。`)
      }
      lines.push('')
    }

    // 行为规则
    if (blueprint.rules.behavior) {
      lines.push('### 行为规则')
      lines.push('')
      const beh = blueprint.rules.behavior
      
      if (beh.max_questions_per_turn) {
        lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 每次最多问 ${beh.max_questions_per_turn} 个核心问题，避免连续追问。`)
      }
      
      if (beh.understanding_stage) {
        const us = beh.understanding_stage
        if (us.reply_structure) {
          lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 在 understanding 阶段，reply 默认先用 ${us.reply_structure}。`)
        }
        if (us.tone) {
          lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 提问语气优先使用${us.tone}。`)
        }
        if (us.no_interrogation) {
          lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 提问语气${us.no_interrogation}。`)
        }
      }
      
      if (beh.proposing_stage) {
        const ps = beh.proposing_stage
        if (ps.scope) {
          lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 在 proposing 阶段，范围为 ${ps.scope}。`)
        }
        if (ps.detail_level) {
          lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 详细程度：${ps.detail_level}。`)
        }
      }
      
      if (beh.ready_stage) {
        const rs = beh.ready_stage
        if (rs.scope) {
          lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: 在 ready 阶段，范围为 ${rs.scope}。`)
        }
      }
      
      if (beh.subject) {
        lines.push(`RULE-${String(ruleCounter++).padStart(2, '0')}: ${beh.subject}。`)
      }
      
      lines.push('')
    }
  }

  // ==================== 输出规格 ====================
  if (blueprint.output) {
    lines.push('## 输出规格')
    lines.push('')
    
    if (blueprint.output.format === 'json') {
      lines.push(`OUT-${String(outCounter++).padStart(2, '0')}: 只输出一个合法JSON对象，不要输出额外说明文本。`)
      
      if (blueprint.output.top_level_fields && blueprint.output.top_level_fields.length > 0) {
        lines.push(`OUT-${String(outCounter++).padStart(2, '0')}: JSON 顶层字段固定为：${blueprint.output.top_level_fields.join('、')}`)
      }
      
      if (!blueprint.output.wrapper) {
        lines.push(`OUT-${String(outCounter++).padStart(2, '0')}: JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言。`)
      }
      
      if (blueprint.output.strict_schema) {
        lines.push(`OUT-${String(outCounter++).padStart(2, '0')}: 严格按照 schema 输出，不允许额外字段。`)
      }
    }
    
    lines.push('')
  }

  // ==================== 边界约束 ====================
  if (blueprint.constraints && blueprint.constraints.length > 0) {
    lines.push('## 边界约束')
    lines.push('')
    
    blueprint.constraints.forEach(constraint => {
      let constraintText: string
      
      if (typeof constraint === 'string') {
        // 字符串格式
        constraintText = constraint
      } else if (typeof constraint === 'object') {
        // 对象格式：{ key: value }
        const entries = Object.entries(constraint)
        if (entries.length > 0) {
          const [key, value] = entries[0]
          constraintText = value as string
        } else {
          return // 跳过空对象
        }
      } else {
        return // 跳过无效类型
      }
      
      lines.push(`CON-${String(conCounter++).padStart(2, '0')}: ${constraintText}`)
    })
    
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 加载并编译 YAML 文本
 */
export function loadAndCompile(yamlText: string, options: CompileOptions = {}): string {
  const yaml = require('js-yaml')
  const blueprint = yaml.load(yamlText) as YamlBlueprint
  return compileBlueprint(blueprint, options)
}
