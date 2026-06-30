import type { SkillContract, BusinessRules, BusinessRulesConversational, BusinessRulesGenerator } from '@/stores/promptLab'

export function generatePromptMock(contract: SkillContract, rules: BusinessRules): string {
  const lines: string[] = []

  // Frontmatter
  lines.push('---')
  lines.push(`agentId: skill:${contract.skillId}`)
  lines.push(`archetype: ${contract.archetype}`)
  lines.push(`name: default-skill-${contract.skillId}`)
  lines.push(`description: AI 生成的 ${contract.skillId} prompt`)
  lines.push(`temperature: 0.7`)
  lines.push(`maxTokens: 8000`)
  lines.push('---')
  lines.push('')

  // 身份定义
  lines.push('## 身份定义')
  lines.push('')
  lines.push(rules.identityText)
  lines.push('')

  // 输入说明
  lines.push('## 输入说明')
  lines.push('')
  lines.push('输入会提供：')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  contract.inputSchema.forEach((field, i) => {
    const comma = i < contract.inputSchema.length - 1 ? ',' : ''
    lines.push(`  "${field.field}": "${field.desc}"${comma}`)
  })
  lines.push('}')
  lines.push('```')
  lines.push('')

  // 执行规则
  lines.push('## 执行规则')
  lines.push('')

  if (contract.archetype === 'conversational') {
    const convRules = rules as BusinessRulesConversational
    let ruleNum = 1

    lines.push('### 数值参数')
    lines.push('')
    lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 每次最多问 ${convRules.numericParams.max_questions_per_turn} 个核心问题，避免连续追问。`)
    lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 如果连续 ${convRules.numericParams.loop_detection_rounds} 轮以上仍处于同一阶段，应调整策略。`)
    lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 用户回复少于 ${convRules.numericParams.short_reply_threshold_chars} 个字时，视为短回复，需要整合信息。`)
    lines.push('')

    lines.push('### 条件策略')
    lines.push('')
    convRules.conditionalStrategies.forEach((strategy) => {
      lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 当 ${strategy.condition} 时，${strategy.action}。（优先级：${strategy.priority}）`)
    })
    lines.push('')

    lines.push('### 语气指引')
    lines.push('')
    lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 提问风格采用 ${convRules.toneGuidance.questioning_style} 式。`)
    lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 共情模式采用 ${convRules.toneGuidance.empathy_mode} 共情。`)
    if (convRules.toneGuidance.avoid_patterns.length > 0) {
      lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 避免使用以下表达：`)
      convRules.toneGuidance.avoid_patterns.forEach((pattern) => {
        lines.push(`  - "${pattern}"`)
      })
    }
    lines.push('')
  } else if (contract.archetype === 'generator') {
    const genRules = rules as BusinessRulesGenerator
    let ruleNum = 1

    lines.push('### 数值默认值')
    lines.push('')
    lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 核心概念数量默认 ${genRules.numericParams.default_concept_count_min}-${genRules.numericParams.default_concept_count_max} 个，优先遵守输入的 planningHints.conceptRange。`)
    lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 里程碑数量默认 ${genRules.numericParams.default_milestone_count_min}-${genRules.numericParams.default_milestone_count_max} 个，优先遵守输入的 planningHints.milestoneRange。`)
    lines.push(`RULE-${String(ruleNum++).padStart(2, '0')}: 如果输入未提供时间预算，默认不超过 ${genRules.numericParams.max_weeks_fallback} 周。`)
    lines.push('')

    lines.push('### 质量控制')
    lines.push('')
    genRules.qualityGates.forEach((gate, i) => {
      lines.push(`QC-${String(i + 1).padStart(2, '0')}: ${gate}`)
    })
    lines.push('')
  }

  // 状态机（仅 conversational）
  if (contract.archetype === 'conversational') {
    const convRules = rules as BusinessRulesConversational
    lines.push('## 状态机')
    lines.push('')
    lines.push('### 阶段定义')
    lines.push('')
    convRules.stageConfig.stages.forEach((stage) => {
      lines.push(`- \`${stage}\``)
    })
    lines.push('')
    lines.push('### 阶段推进门槛')
    lines.push('')
    let stateNum = 1
    Object.entries(convRules.stageConfig.transitions).forEach(([key, value]) => {
      lines.push(`STATE-${String(stateNum++).padStart(2, '0')}: ${key} 推进条件：`)
      if (value.required_fields) {
        lines.push(`  - 必须字段：${value.required_fields.join(', ')}`)
      }
      if (value.confidence_threshold !== undefined) {
        lines.push(`  - 置信度 >= ${value.confidence_threshold}`)
      }
      if (value.user_confirms) {
        lines.push(`  - 用户明确确认`)
      }
    })
    lines.push('')
  }

  // 输出规格
  lines.push('## 输出规格')
  lines.push('')
  lines.push('OUT-01: 只输出一个合法 JSON 对象，不要输出额外说明文本。')
  lines.push(`OUT-02: JSON 顶层字段固定为：${contract.outputSchema.map(f => f.field).join('、')}`)
  lines.push('')
  lines.push('```json')
  lines.push('{')
  contract.outputSchema.forEach((field, i) => {
    const comma = i < contract.outputSchema.length - 1 ? ',' : ''
    lines.push(`  "${field.field}": "${field.type}"${comma}`)
  })
  lines.push('}')
  lines.push('```')
  lines.push('')

  // 边界约束
  lines.push('## 边界约束')
  lines.push('')
  contract.technicalConstraints.forEach((constraint, i) => {
    lines.push(`CON-${String(i + 1).padStart(2, '0')}: ${constraint}`)
  })
  lines.push('')

  return lines.join('\n')
}
