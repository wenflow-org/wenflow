/**
 * 蓝图验证器 - 编译前的静态检查
 */

import type { YamlBlueprint } from '@/types/blueprint'

export interface ValidationError {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

/**
 * 验证蓝图
 */
export function validateBlueprint(blueprint: YamlBlueprint): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationError[] = []

  // ==================== 基础字段验证 ====================
  
  // 1. blueprintId
  if (!blueprint.blueprintId) {
    errors.push({
      field: 'blueprintId',
      message: 'blueprintId 不能为空',
      severity: 'error'
    })
  } else if (!/^[a-z0-9-]+$/.test(blueprint.blueprintId)) {
    errors.push({
      field: 'blueprintId',
      message: 'blueprintId 只能包含小写字母、数字和连字符',
      severity: 'error'
    })
  }

  // 2. archetype
  const validArchetypes = ['conversational', 'generator', 'extractor', 'distiller', 'copywriter', 'code-only']
  if (!blueprint.archetype) {
    errors.push({
      field: 'archetype',
      message: 'archetype 不能为空',
      severity: 'error'
    })
  } else if (!validArchetypes.includes(blueprint.archetype)) {
    errors.push({
      field: 'archetype',
      message: `archetype 必须是以下之一: ${validArchetypes.join(', ')}`,
      severity: 'error'
    })
  }

  // 3. name
  if (!blueprint.name) {
    errors.push({
      field: 'name',
      message: 'name 不能为空',
      severity: 'error'
    })
  }

  // 4. version
  if (!blueprint.version) {
    warnings.push({
      field: 'version',
      message: '建议添加版本号',
      severity: 'warning'
    })
  }

  // ==================== 身份定义验证 ====================
  
  if (!blueprint.identity) {
    errors.push({
      field: 'identity',
      message: 'identity 不能为空',
      severity: 'error'
    })
  } else {
    // 角色
    if (!blueprint.identity.role) {
      errors.push({
        field: 'identity.role',
        message: '角色不能为空',
        severity: 'error'
      })
    } else if (blueprint.identity.role.length > 50) {
      warnings.push({
        field: 'identity.role',
        message: '角色描述过长，建议不超过 50 字符',
        severity: 'warning'
      })
    }

    // 任务
    if (!blueprint.identity.mission) {
      errors.push({
        field: 'identity.mission',
        message: '任务描述不能为空',
        severity: 'error'
      })
    }
  }

  // ==================== 规则验证 ====================
  
  if (blueprint.rules) {
    // 行为规则
    if (blueprint.rules.behavior) {
      const beh = blueprint.rules.behavior

      // 最大提问数
      if (beh.max_questions_per_turn !== undefined) {
        if (beh.max_questions_per_turn < 1) {
          errors.push({
            field: 'rules.behavior.max_questions_per_turn',
            message: '最大提问数不能小于 1',
            severity: 'error'
          })
        } else if (beh.max_questions_per_turn > 5) {
          warnings.push({
            field: 'rules.behavior.max_questions_per_turn',
            message: '最大提问数过多，建议不超过 5',
            severity: 'warning'
          })
        }
      }
    }

    // 上下文使用规则
    if (blueprint.rules.context_usage) {
      const ctx = blueprint.rules.context_usage

      // evaluation_mode
      if (ctx.evaluation_mode && !['fresh_turn', 'continuation'].includes(ctx.evaluation_mode)) {
        errors.push({
          field: 'rules.context_usage.evaluation_mode',
          message: 'evaluation_mode 必须是 fresh_turn 或 continuation',
          severity: 'error'
        })
      }

      // fabrication_policy
      if (ctx.fabrication_policy && !['forbidden', 'allowed'].includes(ctx.fabrication_policy)) {
        errors.push({
          field: 'rules.context_usage.fabrication_policy',
          message: 'fabrication_policy 必须是 forbidden 或 allowed',
          severity: 'error'
        })
      }

      // fabrication_fallback
      if (ctx.fabrication_policy === 'forbidden' && !ctx.fabrication_fallback) {
        warnings.push({
          field: 'rules.context_usage.fabrication_fallback',
          message: '禁止编造时建议提供回退策略',
          severity: 'warning'
        })
      }
    }
  }

  // ==================== 输出规格验证 ====================
  
  if (!blueprint.output) {
    errors.push({
      field: 'output',
      message: 'output 不能为空',
      severity: 'error'
    })
  } else {
    // format
    const validFormats = ['json', 'markdown', 'text']
    if (!blueprint.output.format) {
      errors.push({
        field: 'output.format',
        message: 'output.format 不能为空',
        severity: 'error'
      })
    } else if (!validFormats.includes(blueprint.output.format)) {
      errors.push({
        field: 'output.format',
        message: `output.format 必须是以下之一: ${validFormats.join(', ')}`,
        severity: 'error'
      })
    }

    // JSON 特定验证
    if (blueprint.output.format === 'json') {
      if (!blueprint.output.top_level_fields || blueprint.output.top_level_fields.length === 0) {
        warnings.push({
          field: 'output.top_level_fields',
          message: 'JSON 格式建议定义顶层字段',
          severity: 'warning'
        })
      }
    }

    // wrapper
    if (blueprint.output.wrapper === undefined) {
      warnings.push({
        field: 'output.wrapper',
        message: '建议明确是否允许包装符',
        severity: 'warning'
      })
    }
  }

  // ==================== Archetype 特定验证 ====================
  
  if (blueprint.archetype === 'conversational') {
    // conversational 需要状态机
    if (!blueprint.rules?.state_machine) {
      warnings.push({
        field: 'rules.state_machine',
        message: 'conversational archetype 建议定义状态机',
        severity: 'warning'
      })
    }

    // conversational 需要行为规则
    if (!blueprint.rules?.behavior) {
      warnings.push({
        field: 'rules.behavior',
        message: 'conversational archetype 建议定义行为规则',
        severity: 'warning'
      })
    }
  }

  if (blueprint.archetype === 'generator') {
    // generator 需要明确输出格式
    if (!blueprint.output?.format) {
      errors.push({
        field: 'output.format',
        message: 'generator archetype 必须定义输出格式',
        severity: 'error'
      })
    }
  }

  // ==================== 约束验证 ====================
  
  if (blueprint.constraints) {
    if (!Array.isArray(blueprint.constraints)) {
      errors.push({
        field: 'constraints',
        message: 'constraints 必须是数组',
        severity: 'error'
      })
    } else {
      // 检查重复约束
      const seen = new Set<string>()
      blueprint.constraints.forEach((constraint, index) => {
        if (seen.has(constraint)) {
          warnings.push({
            field: `constraints[${index}]`,
            message: `重复的约束: "${constraint}"`,
            severity: 'warning'
          })
        }
        seen.add(constraint)
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * 获取验证摘要
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.valid && result.warnings.length === 0) {
    return '✓ 验证通过，无警告'
  }

  const parts: string[] = []

  if (!result.valid) {
    parts.push(`✗ ${result.errors.length} 个错误`)
  } else {
    parts.push('✓ 验证通过')
  }

  if (result.warnings.length > 0) {
    parts.push(`⚠ ${result.warnings.length} 个警告`)
  }

  return parts.join('，')
}
