/**
 * 模块加载器和编译器
 */

import type { Module, CompiledModule, CompiledAtom } from '@/types/atomic'
import { loadAtoms, compileAtom } from './atomLoader'

// 模块注册表（临时：未来从文件加载）
const moduleRegistry: Record<string, Module> = {}

/**
 * 注册模块
 */
export function registerModule(module: Module): void {
  moduleRegistry[module.moduleId] = module
}

/**
 * 加载模块
 */
export function loadModule(moduleId: string): Module {
  const module = moduleRegistry[moduleId]
  if (!module) {
    throw new Error(`Module not found: ${moduleId}`)
  }
  return module
}

/**
 * 批量加载模块
 */
export function loadModules(moduleIds: string[]): Module[] {
  return moduleIds.map(id => loadModule(id))
}

/**
 * 编译模块
 */
export function compileModule(
  module: Module,
  values: Record<string, any>
): CompiledModule {
  // 1. 加载模块包含的所有原子
  const atoms = loadAtoms(module.atoms)

  // 2. 确定编译顺序
  const orderedAtomIds = module.compositionOrder || module.atoms

  // 3. 编译每个原子
  const compiledAtoms: CompiledAtom[] = []
  orderedAtomIds.forEach(atomId => {
    const atom = atoms.find(a => a.atomId === atomId)
    if (!atom) return

    const value = values[atomId]
    
    // 跳过未提供值且非必需的原子
    if (value === undefined && !atom.validation?.required) {
      return
    }

    try {
      const compiled = compileAtom(atom, value)
      compiledAtoms.push(compiled)
    } catch (error) {
      console.warn(`Failed to compile atom ${atomId}:`, error)
    }
  })

  // 4. 应用编译逻辑（条件性包含）
  if (module.compileLogic?.conditionalAtoms) {
    module.compileLogic.conditionalAtoms.forEach(conditional => {
      const conditionMet = evaluateCondition(conditional.condition, values)
      if (conditionMet) {
        // 确保必需的原子已编译
        conditional.requiredAtoms.forEach(atomId => {
          if (!compiledAtoms.find(ca => ca.atomId === atomId)) {
            const atom = atoms.find(a => a.atomId === atomId)
            if (atom) {
              const compiled = compileAtom(atom, values[atomId])
              compiledAtoms.push(compiled)
            }
          }
        })
      }
    })
  }

  // 5. 组合原子文本
  const atomsText = compiledAtoms.map(ca => ca.compiledText).join('\n')

  // 6. 应用章节模板
  const compiledText = module.sectionTemplate.replace('{{atoms}}', atomsText)

  return {
    moduleId: module.moduleId,
    displayName: module.displayName,
    compiledText
  }
}

/**
 * 评估条件表达式
 */
function evaluateCondition(condition: string, values: Record<string, any>): boolean {
  try {
    // 简单的条件评估（仅支持等值比较）
    // 例如: "fabrication_policy === 'forbidden'"
    const match = condition.match(/(\w+)\s*===\s*'([^']+)'/)
    if (match) {
      const [, key, value] = match
      return values[key] === value
    }

    // 布尔值检查
    // 例如: "strict_schema"
    if (/^\w+$/.test(condition)) {
      return !!values[condition]
    }

    return false
  } catch (error) {
    console.warn(`Failed to evaluate condition: ${condition}`, error)
    return false
  }
}

/**
 * 获取所有已注册的模块
 */
export function getAllModules(): Module[] {
  return Object.values(moduleRegistry)
}

/**
 * 根据分类获取模块
 */
export function getModulesByCategory(category: string): Module[] {
  return Object.values(moduleRegistry).filter(module => module.category === category)
}

/**
 * 搜索模块
 */
export function searchModules(query: string): Module[] {
  const lowercaseQuery = query.toLowerCase()
  return Object.values(moduleRegistry).filter(module => 
    module.moduleId.toLowerCase().includes(lowercaseQuery) ||
    module.displayName.toLowerCase().includes(lowercaseQuery)
  )
}

/**
 * 获取模块的所有原子
 */
export function getModuleAtoms(moduleId: string): string[] {
  const module = loadModule(moduleId)
  return module.atoms
}
