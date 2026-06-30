/**
 * 原子加载器和编译器
 */

import type { Atom, CompiledAtom } from '@/types/atomic'

// 原子注册表（临时：未来从文件加载）
const atomRegistry: Record<string, Atom> = {}

/**
 * 注册原子
 */
export function registerAtom(atom: Atom): void {
  atomRegistry[atom.atomId] = atom
}

/**
 * 加载原子
 */
export function loadAtom(atomId: string): Atom {
  const atom = atomRegistry[atomId]
  if (!atom) {
    throw new Error(`Atom not found: ${atomId}`)
  }
  return atom
}

/**
 * 批量加载原子
 */
export function loadAtoms(atomIds: string[]): Atom[] {
  return atomIds.map(id => loadAtom(id))
}

/**
 * 编译原子
 */
export function compileAtom(atom: Atom, value: any): CompiledAtom {
  // 1. 验证值
  if (atom.validation?.required && value === undefined) {
    throw new Error(`Required atom value missing: ${atom.atomId}`)
  }

  // 2. 使用默认值
  const actualValue = value !== undefined ? value : atom.default

  // 3. 类型验证
  validateAtomValue(atom, actualValue)

  // 4. 编译模板
  const compiledText = compileTemplate(atom.compileTemplate, actualValue)

  return {
    atomId: atom.atomId,
    compiledText
  }
}

/**
 * 验证原子值
 */
function validateAtomValue(atom: Atom, value: any): void {
  if (value === undefined || value === null) {
    return // 允许空值（由 required 检查）
  }

  // 类型检查
  switch (atom.type) {
    case 'number':
      if (typeof value !== 'number') {
        throw new Error(`Atom ${atom.atomId} expects number, got ${typeof value}`)
      }
      // 范围检查
      if (atom.range) {
        const [min, max] = atom.range
        if (value < min || value > max) {
          throw new Error(`Atom ${atom.atomId} value ${value} out of range [${min}, ${max}]`)
        }
      }
      break

    case 'string':
      if (typeof value !== 'string') {
        throw new Error(`Atom ${atom.atomId} expects string, got ${typeof value}`)
      }
      break

    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new Error(`Atom ${atom.atomId} expects boolean, got ${typeof value}`)
      }
      break

    case 'enum':
      if (atom.enum && !atom.enum.includes(value)) {
        throw new Error(`Atom ${atom.atomId} value ${value} not in enum: ${atom.enum.join(', ')}`)
      }
      break
  }

  // 自定义验证
  if (atom.validation) {
    const { min, max, pattern } = atom.validation

    if (min !== undefined && typeof value === 'number' && value < min) {
      throw new Error(atom.validation.errorMessage || `Value must be >= ${min}`)
    }

    if (max !== undefined && typeof value === 'number' && value > max) {
      throw new Error(atom.validation.errorMessage || `Value must be <= ${max}`)
    }

    if (pattern && typeof value === 'string') {
      const regex = new RegExp(pattern)
      if (!regex.test(value)) {
        throw new Error(atom.validation.errorMessage || `Value does not match pattern: ${pattern}`)
      }
    }
  }
}

/**
 * 编译模板
 */
function compileTemplate(template: string, value: any): string {
  // 简单的模板引擎
  let compiled = template

  // 替换 {{value}}
  if (typeof value === 'object' && !Array.isArray(value)) {
    // 对象：替换 {{value.key}}
    Object.entries(value).forEach(([key, val]) => {
      const placeholder = new RegExp(`{{value\\.${key}}}`, 'g')
      compiled = compiled.replace(placeholder, String(val))
    })
  } else {
    // 简单值：替换 {{value}}
    compiled = compiled.replace(/{{value}}/g, String(value))
  }

  return compiled
}

/**
 * 获取所有已注册的原子
 */
export function getAllAtoms(): Atom[] {
  return Object.values(atomRegistry)
}

/**
 * 根据分类获取原子
 */
export function getAtomsByCategory(category: string): Atom[] {
  return Object.values(atomRegistry).filter(atom => atom.category === category)
}

/**
 * 搜索原子
 */
export function searchAtoms(query: string): Atom[] {
  const lowercaseQuery = query.toLowerCase()
  return Object.values(atomRegistry).filter(atom => 
    atom.atomId.toLowerCase().includes(lowercaseQuery) ||
    atom.description.toLowerCase().includes(lowercaseQuery)
  )
}
