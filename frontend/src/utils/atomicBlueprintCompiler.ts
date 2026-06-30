/**
 * 原子化蓝图编译器
 * 将原子化蓝图编译成 Markdown Prompt
 */

import type { AtomicBlueprint, AtomicCompilationResult } from '@/types/atomic'
import { loadModules, compileModule } from './moduleLoader'

/**
 * 编译原子化蓝图
 */
export function compileAtomicBlueprint(blueprint: AtomicBlueprint): AtomicCompilationResult {
  const lines: string[] = []
  let ruleCounter = 1

  // 1. 加载引用的模块
  const modules = loadModules(blueprint.modules)

  // 2. 编译每个模块
  const compiledModules = modules.map(module => {
    return compileModule(module, blueprint.values)
  })

  // 3. 生成 Frontmatter
  lines.push('---')
  lines.push(`agentId: skill:${blueprint.blueprintId}`)
  lines.push(`archetype: ${blueprint.archetype}`)
  lines.push(`description: ${blueprint.name}`)
  lines.push(`temperature: 0.7`)
  lines.push(`maxTokens: 8000`)
  lines.push('---')
  lines.push('')

  // 4. 组合所有模块
  compiledModules.forEach(compiledModule => {
    // 添加模块编译的文本
    let moduleText = compiledModule.compiledText

    // 自动编号（RULE-XX, OUT-XX, CON-XX）
    moduleText = addAutomaticNumbering(moduleText, ruleCounter)

    // 更新计数器
    const ruleMatches = moduleText.match(/RULE-\d{2}/g)
    if (ruleMatches) {
      ruleCounter += ruleMatches.length
    }

    lines.push(moduleText)
    lines.push('')
  })

  // 5. 收集所有编译的原子
  const allCompiledAtoms = compiledModules.flatMap(cm => {
    // 从编译文本中提取原子（简化实现）
    return []
  })

  // 6. 生成最终 Markdown
  const markdown = lines.join('\n')

  // 7. 统计信息
  const ruleCount = (markdown.match(/RULE-\d{2}/g) || []).length
  const outCount = (markdown.match(/OUT-\d{2}/g) || []).length
  const conCount = (markdown.match(/CON-\d{2}/g) || []).length

  return {
    markdown,
    atoms: allCompiledAtoms,
    modules: compiledModules,
    metadata: {
      atomCount: allCompiledAtoms.length,
      moduleCount: compiledModules.length,
      ruleCount: ruleCount + outCount + conCount
    }
  }
}

/**
 * 自动编号规则
 */
function addAutomaticNumbering(text: string, startNumber: number): string {
  let counter = startNumber

  // 为每一行添加编号（如果以特定关键词开头）
  const lines = text.split('\n')
  const numberedLines = lines.map(line => {
    const trimmed = line.trim()

    // 检查是否需要编号
    const needsNumbering = 
      trimmed.startsWith('每次最多问') ||
      trimmed.startsWith('提问语气') ||
      trimmed.startsWith('在 understanding 阶段') ||
      trimmed.startsWith('在 proposing 阶段') ||
      trimmed.startsWith('在 ready 阶段') ||
      trimmed.startsWith('这是 fresh turn') ||
      trimmed.startsWith('若 state 与') ||
      trimmed.startsWith('不要为了补全字段') ||
      trimmed.startsWith('默认始终面向')

    if (needsNumbering && !trimmed.match(/^(RULE|OUT|CON)-\d{2}/)) {
      const numbered = `RULE-${String(counter++).padStart(2, '0')}: ${trimmed}`
      return line.replace(trimmed, numbered)
    }

    return line
  })

  return numberedLines.join('\n')
}

/**
 * 验证原子化蓝图
 */
export function validateAtomicBlueprint(blueprint: AtomicBlueprint): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // 1. 检查必填字段
  if (!blueprint.blueprintId) {
    errors.push('blueprintId is required')
  }
  if (!blueprint.archetype) {
    errors.push('archetype is required')
  }
  if (!blueprint.modules || blueprint.modules.length === 0) {
    errors.push('At least one module is required')
  }

  // 2. 检查模块是否存在
  try {
    loadModules(blueprint.modules)
  } catch (error) {
    errors.push(`Module not found: ${(error as Error).message}`)
  }

  // 3. 检查值的完整性
  // TODO: 检查所有必需的原子是否都有值

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * 从传统蓝图转换为原子化蓝图
 */
export function convertToAtomicBlueprint(
  traditionalBlueprint: any
): AtomicBlueprint {
  // 简化实现：将传统蓝图转换为原子化格式
  return {
    blueprintId: traditionalBlueprint.blueprintId,
    archetype: traditionalBlueprint.archetype,
    name: traditionalBlueprint.name,
    version: traditionalBlueprint.version || '1.0.0',
    modules: inferModulesFromBlueprint(traditionalBlueprint),
    values: extractValuesFromBlueprint(traditionalBlueprint)
  }
}

/**
 * 从传统蓝图推断需要的模块
 */
function inferModulesFromBlueprint(blueprint: any): string[] {
  const modules: string[] = []

  if (blueprint.identity) modules.push('identity')
  if (blueprint.rules?.context_usage) modules.push('context_usage_rules')
  if (blueprint.rules?.behavior) modules.push('behavior_rules')
  if (blueprint.output) modules.push('output_spec')
  if (blueprint.constraints) modules.push('constraints')

  return modules
}

/**
 * 从传统蓝图提取原子值
 */
function extractValuesFromBlueprint(blueprint: any): Record<string, any> {
  const values: Record<string, any> = {}

  // identity
  if (blueprint.identity) {
    values.role = blueprint.identity.role
    values.mission = blueprint.identity.mission
    values.scope = blueprint.identity.scope
  }

  // rules
  if (blueprint.rules) {
    // context_usage
    if (blueprint.rules.context_usage) {
      Object.assign(values, blueprint.rules.context_usage)
    }

    // behavior
    if (blueprint.rules.behavior) {
      Object.assign(values, blueprint.rules.behavior)
    }
  }

  // output
  if (blueprint.output) {
    Object.assign(values, blueprint.output)
  }

  // constraints
  if (blueprint.constraints) {
    values.constraints = blueprint.constraints
  }

  return values
}
