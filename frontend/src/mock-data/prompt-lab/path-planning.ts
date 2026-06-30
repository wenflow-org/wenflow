import type { SkillContract, BusinessRulesGenerator } from '@/stores/promptLab'

export const PATH_PLANNING_CONTRACT: SkillContract = {
  skillId: 'path-planning',
  archetype: 'generator',
  inputSchema: [
    { field: 'normalizedInput.confirmedProposal', type: 'object', desc: '确认的学习方向提案' },
    { field: 'normalizedInput.successCriteria', type: 'object', desc: '成功标准' },
    { field: 'normalizedInput.planningHints', type: 'object', desc: '规划提示（概念范围、里程碑范围等）' },
  ],
  outputSchema: [
    { field: 'name', type: 'string', required: true, desc: '路径名称' },
    { field: 'summary', type: 'string', required: true, desc: '路径摘要' },
    { field: 'totalMilestones', type: 'number', required: true, desc: '总里程碑数' },
    { field: 'estimatedHours', type: 'number', required: true, desc: '预计总学时' },
    { field: 'estimatedWeeks', type: 'number', required: true, desc: '预计总周数' },
    { field: 'cognitiveCore', type: 'object', required: true, desc: '认知核心（领域+核心概念）' },
    { field: 'milestones', type: 'array', required: true, desc: '里程碑列表' },
  ],
  technicalConstraints: [
    'JSON 顶层必须是单个 object',
    'cognitiveCore 必须包含 1 个 cognitiveDomain 和 2-4 个 coreConcepts',
    'coreConcepts 中必须且只能有 1 个 role = "hub"',
    'milestone 数量默认 3-6 个，优先遵守 planningHints.milestoneRange',
    'cognitiveDesign 字段必须等于 cognitiveCore（兼容镜像）',
  ],
}

export const PATH_PLANNING_BUSINESS_RULES: BusinessRulesGenerator = {
  numericParams: {
    default_concept_count_min: 2,
    default_concept_count_max: 4,
    default_milestone_count_min: 3,
    default_milestone_count_max: 6,
    max_weeks_fallback: 52,
  },
  qualityGates: [
    'hub concept 必须是整条路径的认知枢纽，其他概念围绕它展开',
    '每个 milestone 必须有明确的 goal 和 coreConcept',
    'milestone 顺序必须符合认知递进逻辑',
    '总学时和总周数必须与输入的时间预算一致',
    'firstDeliverable 必须在前 2 个 milestone 内可达成',
    '不要为凑数字而硬拆 milestone，保持每个阶段的完整性',
  ],
  identityText: `你是学习路径规划生成器。

你的任务是根据已确认的学习方向，生成一条结构化的学习路径。路径由认知核心（cognitiveCore）和里程碑（milestones）组成。

你必须严格按以下顺序思考：
1. 第一步：定义 cognitiveCore（认知领域 + 核心概念，必须有 1 个 hub）
2. 第二步：根据 cognitiveCore 设计 milestone
3. 第三步：输出兼容镜像字段 cognitiveDesign

禁止跳过第一步直接生成 milestone。`,
}
