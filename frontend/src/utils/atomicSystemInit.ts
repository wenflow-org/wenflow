/**
 * 原子化系统初始化
 */

import { registerCoreAtoms } from './coreAtoms'
import { registerCoreModules } from './coreModules'

/**
 * 初始化原子化系统
 * 注册所有核心原子和模块
 */
export function initAtomicSystem(): void {
  // 1. 注册核心原子
  registerCoreAtoms()
  console.log('✅ 已注册 10 个核心原子')

  // 2. 注册核心模块
  registerCoreModules()
  console.log('✅ 已注册 6 个核心模块')

  console.log('🎉 原子化系统初始化完成')
}

/**
 * 获取系统统计信息
 */
export function getAtomicSystemStats(): {
  atomCount: number
  moduleCount: number
  categories: string[]
} {
  const { getAllAtoms } = require('./atomLoader')
  const { getAllModules } = require('./moduleLoader')

  const atoms = getAllAtoms()
  const modules = getAllModules()

  const categories = new Set<string>()
  atoms.forEach((atom: any) => categories.add(atom.category))
  modules.forEach((module: any) => categories.add(module.category))

  return {
    atomCount: atoms.length,
    moduleCount: modules.length,
    categories: Array.from(categories)
  }
}
