/**
 * 蓝图优化器 - 编译前的自动优化
 */

import type { YamlBlueprint } from '@/types/blueprint'

export interface OptimizationResult {
  optimized: YamlBlueprint
  changes: OptimizationChange[]
}

export interface OptimizationChange {
  type: 'added' | 'removed' | 'modified' | 'merged'
  field: string
  description: string
  before?: any
  after?: any
}

/**
 * 优化蓝图
 */
export function optimizeBlueprint(blueprint: YamlBlueprint): OptimizationResult {
  const optimized = JSON.parse(JSON.stringify(blueprint)) as YamlBlueprint
  const changes: OptimizationChange[] = []

  // 1. 去重约束
  if (optimized.constraints && Array.isArray(optimized.constraints)) {
    // 检查是字符串数组还是对象数组
    if (optimized.constraints.length > 0) {
      const firstItem = optimized.constraints[0]
      
      if (typeof firstItem === 'string') {
        // 字符串数组：去重
        const { deduplicated, removed } = deduplicateConstraints(optimized.constraints as string[])
        if (removed.length > 0) {
          optimized.constraints = deduplicated
          changes.push({
            type: 'removed',
            field: 'constraints',
            description: `移除 ${removed.length} 个重复约束`,
            before: removed
          })
        }
      } else if (typeof firstItem === 'object') {
        // 对象数组：跳过去重（结构化约束）
        console.log('Constraints are objects, skipping deduplication')
      }
    }
  }

  // 2. 自动推断缺失字段
  const inferred = inferMissingFields(optimized)
  changes.push(...inferred.changes)
  Object.assign(optimized, inferred.blueprint)

  // 3. 根据 Archetype 补全
  const archetypeOptimized = optimizeByArchetype(optimized)
  changes.push(...archetypeOptimized.changes)
  Object.assign(optimized, archetypeOptimized.blueprint)

  // 4. 优化规则顺序
  if (optimized.rules) {
    const reordered = optimizeRuleOrder(optimized.rules)
    if (reordered.changed) {
      optimized.rules = reordered.rules
      changes.push({
        type: 'modified',
        field: 'rules',
        description: '优化规则顺序以提高可读性'
      })
    }
  }

  return {
    optimized,
    changes
  }
}

/**
 * 去重约束
 */
function deduplicateConstraints(constraints: string[]): {
  deduplicated: string[]
  removed: string[]
} {
  const seen = new Set<string>()
  const deduplicated: string[] = []
  const removed: string[] = []

  constraints.forEach(constraint => {
    // 确保是字符串
    if (typeof constraint !== 'string') {
      console.warn('Invalid constraint type:', constraint)
      return
    }
    
    const normalized = constraint.trim().toLowerCase()
    if (!seen.has(normalized)) {
      seen.add(normalized)
      deduplicated.push(constraint)
    } else {
      removed.push(constraint)
    }
  })

  return { deduplicated, removed }
}

/**
 * 自动推断缺失字段
 */
function inferMissingFields(blueprint: YamlBlueprint): {
  blueprint: YamlBlueprint
  changes: OptimizationChange[]
} {
  const optimized = { ...blueprint }
  const changes: OptimizationChange[] = []

  // 推断 1: JSON 格式自动添加禁止额外文本
  if (optimized.output?.format === 'json' && !optimized.output.wrapper) {
    if (!optimized.output.forbidden_extra_text) {
      optimized.output.forbidden_extra_text = [
        '前言',
        '解释',
        '总结',
        '道歉',
        '注释',
        'markdown 包装',
        '自然语言'
      ]
      changes.push({
        type: 'added',
        field: 'output.forbidden_extra_text',
        description: 'JSON 格式自动添加禁止额外文本列表',
        after: optimized.output.forbidden_extra_text
      })
    }
  }

  // 推断 2: 默认 wrapper 为 false
  if (optimized.output && optimized.output.wrapper === undefined) {
    optimized.output.wrapper = false
    changes.push({
      type: 'added',
      field: 'output.wrapper',
      description: '默认不使用包装符',
      after: false
    })
  }

  // 推断 3: conversational 默认需要行为规则
  if (optimized.archetype === 'conversational') {
    if (!optimized.rules) {
      optimized.rules = {}
    }
    
    if (!optimized.rules.behavior) {
      optimized.rules.behavior = {}
      changes.push({
        type: 'added',
        field: 'rules.behavior',
        description: 'conversational archetype 自动添加行为规则块'
      })
    }

    // 默认提问数为 1
    if (!optimized.rules.behavior.max_questions_per_turn) {
      optimized.rules.behavior.max_questions_per_turn = 1
      changes.push({
        type: 'added',
        field: 'rules.behavior.max_questions_per_turn',
        description: 'conversational archetype 默认每次最多提问 1 个',
        after: 1
      })
    }
  }

  return { blueprint: optimized, changes }
}

/**
 * 根据 Archetype 优化
 */
function optimizeByArchetype(blueprint: YamlBlueprint): {
  blueprint: YamlBlueprint
  changes: OptimizationChange[]
} {
  const optimized = { ...blueprint }
  const changes: OptimizationChange[] = []

  switch (optimized.archetype) {
    case 'conversational':
      // 对话型：确保有上下文使用规则
      if (!optimized.rules) optimized.rules = {}
      if (!optimized.rules.context_usage) {
        optimized.rules.context_usage = {
          evaluation_mode: 'fresh_turn',
          priority: 'state优先',
          conflict_resolution: 'userInput_always_wins',
          fabrication_policy: 'forbidden',
          fabrication_fallback: '不确定就空白或继续追问'
        }
        changes.push({
          type: 'added',
          field: 'rules.context_usage',
          description: 'conversational archetype 自动添加上下文使用规则'
        })
      }
      break

    case 'generator':
      // 生成型：确保输出格式严格
      if (optimized.output && optimized.output.strict_schema === undefined) {
        optimized.output.strict_schema = true
        changes.push({
          type: 'added',
          field: 'output.strict_schema',
          description: 'generator archetype 默认使用严格 schema',
          after: true
        })
      }
      break

    case 'extractor':
      // 提取型：确保输出格式为 JSON
      if (optimized.output && !optimized.output.format) {
        optimized.output.format = 'json'
        changes.push({
          type: 'added',
          field: 'output.format',
          description: 'extractor archetype 默认输出 JSON 格式',
          after: 'json'
        })
      }
      break
  }

  return { blueprint: optimized, changes }
}

/**
 * 优化规则顺序
 */
function optimizeRuleOrder(rules: any): {
  rules: any
  changed: boolean
} {
  const optimized = { ...rules }
  const changed = false

  // 推荐顺序：context_usage → behavior → state_machine
  const recommendedOrder = ['context_usage', 'behavior', 'state_machine']
  const currentKeys = Object.keys(rules)

  // 检查是否需要重排
  const needsReorder = recommendedOrder.some((key, index) => {
    const currentIndex = currentKeys.indexOf(key)
    return currentIndex !== -1 && currentIndex !== index
  })

  if (needsReorder) {
    const reordered: any = {}
    
    // 按推荐顺序添加
    recommendedOrder.forEach(key => {
      if (rules[key]) {
        reordered[key] = rules[key]
      }
    })
    
    // 添加其他键
    currentKeys.forEach(key => {
      if (!recommendedOrder.includes(key)) {
        reordered[key] = rules[key]
      }
    })

    return { rules: reordered, changed: true }
  }

  return { rules: optimized, changed: false }
}

/**
 * 合并相似规则（高级优化）
 */
export function mergeRedundantRules(blueprint: YamlBlueprint): {
  blueprint: YamlBlueprint
  merged: number
} {
  const optimized = JSON.parse(JSON.stringify(blueprint)) as YamlBlueprint
  let merged = 0

  // 示例：合并理解阶段和提议阶段的相似配置
  if (optimized.rules?.behavior) {
    const beh = optimized.rules.behavior

    // 如果多个阶段有相同的 tone，提取为公共配置
    const tones = new Set<string>()
    if (beh.understanding_stage?.tone) tones.add(beh.understanding_stage.tone)
    if (beh.proposing_stage?.tone) tones.add(beh.proposing_stage.tone)
    if (beh.ready_stage?.tone) tones.add(beh.ready_stage.tone)

    if (tones.size === 1) {
      const commonTone = Array.from(tones)[0]
      // 可以提升为通用配置
      // beh.common_tone = commonTone
      merged++
    }
  }

  return { blueprint: optimized, merged }
}

/**
 * 获取优化摘要
 */
export function getOptimizationSummary(result: OptimizationResult): string {
  if (result.changes.length === 0) {
    return '无需优化'
  }

  const grouped = {
    added: result.changes.filter(c => c.type === 'added').length,
    removed: result.changes.filter(c => c.type === 'removed').length,
    modified: result.changes.filter(c => c.type === 'modified').length,
    merged: result.changes.filter(c => c.type === 'merged').length
  }

  const parts: string[] = []
  if (grouped.added > 0) parts.push(`新增 ${grouped.added} 项`)
  if (grouped.removed > 0) parts.push(`移除 ${grouped.removed} 项`)
  if (grouped.modified > 0) parts.push(`修改 ${grouped.modified} 项`)
  if (grouped.merged > 0) parts.push(`合并 ${grouped.merged} 项`)

  return parts.join('，')
}
