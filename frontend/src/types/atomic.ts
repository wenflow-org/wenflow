/**
 * 原子化蓝图类型定义
 * Stage 0: Atoms + Stage 1: Modules
 */

// ==================== Stage 0: 原子层 ====================

export interface Atom {
  atomId: string
  category: 'context' | 'behavior' | 'output' | 'identity' | 'constraint'
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array'
  range?: [number, number]
  enum?: string[]
  default?: any
  description: string
  
  // 编译模板（使用 {{value}} 占位符）
  compileTemplate: string
  
  // 验证规则
  validation?: {
    required?: boolean
    min?: number
    max?: number
    pattern?: string
    errorMessage?: string
  }
  
  // 适用的 Archetype
  applicableArchetypes?: string[]
  
  // 依赖的其他原子
  dependencies?: string[]
  
  // 示例
  examples?: Array<{
    value: any
    compiledTo: string
  }>
}

// ==================== Stage 1: 模块层 ====================

export interface Module {
  moduleId: string
  category: 'identity' | 'rules' | 'output' | 'constraints' | 'state_machine'
  displayName: string
  
  // 包含的原子 ID 列表
  atoms: string[]
  
  // 原子组合顺序（决定编译时的顺序）
  compositionOrder?: string[]
  
  // 章节模板（使用 {{atoms}} 占位符）
  sectionTemplate: string
  
  // 编译逻辑（条件性包含原子）
  compileLogic?: {
    conditionalAtoms?: Array<{
      condition: string
      requiredAtoms: string[]
    }>
  }
  
  // 适用的 Archetype
  applicableArchetypes?: string[]
  
  // 依赖的其他模块
  dependencies?: string[]
}

// ==================== Stage 2: 原子化蓝图 ====================

export interface AtomicBlueprint {
  blueprintId: string
  archetype: string
  name: string
  version: string
  
  // 引用的模块列表
  modules: string[]
  
  // 原子值（key = atomId, value = 原子的值）
  values: Record<string, any>
  
  // 可选：覆盖默认的编译逻辑
  overrides?: {
    atoms?: Record<string, string>  // 覆盖原子的编译模板
    modules?: Record<string, string>  // 覆盖模块的章节模板
  }
}

// ==================== 编译相关 ====================

export interface CompiledAtom {
  atomId: string
  compiledText: string
  ruleNumber?: number
}

export interface CompiledModule {
  moduleId: string
  displayName: string
  compiledText: string
}

export interface AtomicCompilationResult {
  markdown: string
  atoms: CompiledAtom[]
  modules: CompiledModule[]
  metadata: {
    atomCount: number
    moduleCount: number
    ruleCount: number
  }
}
