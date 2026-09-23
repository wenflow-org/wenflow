/**
 * goal→path 资料采集接线单测（全 mock：无网络、无 LLM）。
 *
 * 覆盖验收四点：
 *  1) needsMaterial 缺失 → 采集函数不被调用（零成本）
 *  2) 有需求 → resources.materials 被写入（含 pack 大纲/要点 + sectionId）
 *  3) 采集抛错 → 路径生成继续（fail-open）且记录 note + warn 日志
 *  4) 开关 MATERIAL_COLLECTION_DISABLED=1 → 不调用
 *
 * 额外覆盖：goal-path-visible-summary 白名单是否透传 needsMaterial。
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildGoalPathVisibleSummary } from '../../services/learning/goal-path-visible-summary'
import { writeMaterial } from '../../services/materials/material-store'

jest.mock('../../services/agentConfig.service', () => ({
  getPathAgentInputConfig: jest.fn(async () => ({
    normalizedInput: {
      descriptionSources: ['goalFinalPayload.rawGoal'],
      subjectSources: ['goalFinalPayload.visibleSummary.surfaceGoal'],
      skillLevelSources: ['goalFinalPayload.visibleSummary.currentBaseline.level'],
      timePerDaySources: ['goalFinalPayload.visibleSummary.resources.timeBudget'],
      deadlineTextSources: ['goalFinalPayload.visibleSummary.resources.deadlineText'],
      includeConfirmedProposal: true,
      includeConversationHistory: false,
    },
  })),
}))

jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// 采集依赖（search/fetch）全 mock，避免任何真实网络加载
jest.mock('../../services/search', () => ({ searchWeb: jest.fn() }))
jest.mock('../../services/fetch', () => ({ fetchWeb: jest.fn() }))

// 只 mock 采集入口；hasMaterialNeed 用真实实现（验证早退判定语义）
jest.mock('../../skills/material-collector', () => ({
  ...jest.requireActual('../../skills/material-collector'),
  collectMaterialForGoal: jest.fn(),
}))

import pathOrchestrator from '../path.coordinator'
import { collectMaterialForGoal } from '../../skills/material-collector'
import { logger } from '../../utils/logger'

const collectMock = collectMaterialForGoal as jest.Mock
const warnMock = logger.warn as jest.Mock

const NEED = {
  kind: '指南',
  title: '《3-6 岁儿童学习与发展指南》',
  why: '路径要按官方领域设计',
  queries: ['3-6岁儿童学习与发展指南'],
}

const VISIBLE_BASE: any = {
  surfaceGoal: '按指南设计幼儿活动',
  realProblem: '没读过指南，活动设计没依据',
  painPoints: ['不知道从哪下手'],
  constraintsAndBoundaries: [],
  currentBaseline: { level: 'beginner', evidence: null },
  resources: { timeBudget: '每周3小时', timeBudgetCadence: 'per_week', timePerWeek: '每周3小时', timePerSession: '45分钟', timeHorizon: '1个月', deadlineText: '1个月' },
  successCriteria: { observableResult: '产出一次活动方案', acceptanceCheck: null },
  confirmedProposal: { learningDirection: '指南落地', firstDeliverable: '一份活动方案', keyStages: ['读懂领域', '设计活动'], outOfScope: [], scopeSize: null },
}

const VISIBLE_WITH_NEED = { ...VISIBLE_BASE, needsMaterial: NEED }

const FAKE_PACK_RESULT = {
  status: 'ok' as const,
  pack: {
    title: '《3-6 岁儿童学习与发展指南》',
    publisher: '教育部',
    sourceTier: 'official' as const,
    sourceUrl: 'https://www.moe.gov.cn/example',
    version: '2012',
    fetchedAt: '2026-01-02T03:04:05.000Z',
    license: null,
    tldr: '健康/语言/社会/科学/艺术五大领域。',
    sections: [{ id: 's-1', title: '健康领域', summary: '身心状况/动作发展/生活习惯' }],
    keyPoints: [{ text: '健康领域包含三方面目标', cite: '健康包括……', sourceUrl: 'https://www.moe.gov.cn/example' }],
  },
  provenance: [{ pointId: 'p-1', sourceUrl: 'https://www.moe.gov.cn/example', quote: '健康包括……' }],
  coverage: { covered: ['健康领域'], missing: [] },
  notes: [],
}

afterEach(() => {
  collectMock.mockReset()
  warnMock.mockReset()
  delete process.env.MATERIAL_COLLECTION_DISABLED
  delete process.env.MATERIAL_COLLECTION_TIMEOUT_MS
  delete process.env.MATERIAL_UPLOAD_INJECTION_DISABLED
  if (uploadRoot) {
    try { fs.rmSync(uploadRoot, { recursive: true, force: true }) } catch { /* 忽略清理失败 */ }
    uploadRoot = ''
  }
  delete process.env.MATERIAL_UPLOAD_DIR
})

// ---- 附件（用户上传资料）测试夹具：真实落盘到临时目录，读路径与生产同构 ----
let uploadRoot = ''

function seedUpload(userId: string, name = '指南附件.pdf') {
  if (!uploadRoot) {
    uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-upload-'))
    process.env.MATERIAL_UPLOAD_DIR = uploadRoot
  }
  writeMaterial({
    id: '11111111-2222-3333-4444-555555555555',
    userId,
    name,
    ext: '.pdf',
    format: 'pdf',
    size: 100,
    charCount: 400,
    structure: {
      pageCount: 2, slideCount: 0, sheetCount: 0, headingCount: 2,
      tableCount: 0, listCount: 0, paragraphCount: 8, chunkCount: 2,
    },
    anchors: [
      { heading: '一、健康领域', location: '1', preview: '健康包括身心状况、动作发展和生活习惯三个方面' },
      { heading: '二、语言领域', location: '2', preview: '语言领域包括倾听与表达、阅读与书写准备' },
    ],
    warnings: [],
    createdAt: '2026-09-22T00:00:00.000Z',
  }, '附件正文……')
}

describe('goal-path-visible-summary：needsMaterial 白名单透传', () => {
  it('understanding.needsMaterial 进入 visibleSummary', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: { surface_goal: 'x', needsMaterial: NEED },
      confirmedProposal: null,
      collected: {},
    })
    expect(visible.needsMaterial).toEqual(NEED)
  })

  it('缺 title / 为空时不透传（返回 null，保持既有字段行为不变）', () => {
    expect(buildGoalPathVisibleSummary({ understanding: {}, collected: {} }).needsMaterial).toBeNull()
    expect(buildGoalPathVisibleSummary({ understanding: { needsMaterial: {} }, collected: {} }).needsMaterial).toBeNull()
    expect(buildGoalPathVisibleSummary({ understanding: { needsMaterial: { title: '  ' } }, collected: {} }).needsMaterial).toBeNull()
  })
})

describe('path.coordinator 资料采集接线', () => {
  it('needsMaterial 缺失 → 采集函数不被调用，materials 不写入', async () => {
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_BASE,
    } as any)

    expect(collectMock).not.toHaveBeenCalled()
    expect(result.userProfile.normalizedInput.resources.materials).toBeUndefined()
  })

  it('有需求 → 调用采集并写入 resources.materials（含 sections[].id / keyPoints）', async () => {
    collectMock.mockResolvedValue([FAKE_PACK_RESULT])

    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_WITH_NEED,
    } as any)

    expect(collectMock).toHaveBeenCalledTimes(1)
    const [needsArg, optionsArg] = collectMock.mock.calls[0]
    expect(Array.isArray(needsArg) ? needsArg[0].title : needsArg.title).toBe(NEED.title)
    expect(optionsArg?.signal).toBeDefined()

    const materials = result.userProfile.normalizedInput.resources.materials
    expect(materials).toHaveLength(1)
    expect(materials[0].pack.sections[0].id).toBe('s-1')
    expect(materials[0].pack.keyPoints[0].cite).toBe('健康包括……')
  })

  it('采集抛错 → fail-open：路径生成继续，materials 记 note + 一条 warn', async () => {
    collectMock.mockRejectedValue(new Error('检索服务不可用'))

    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_WITH_NEED,
    } as any)

    // 路径生成继续：基础输入仍在
    expect(result.userProfile.normalizedInput.learnerProfile.surfaceGoal).toBe('按指南设计幼儿活动')
    const materials = result.userProfile.normalizedInput.resources.materials
    expect(materials).toHaveLength(1)
    expect(materials[0].status).toBe('not_found')
    expect(materials[0].notes.join(' ')).toContain('fail-open')
    expect(warnMock).toHaveBeenCalledTimes(1)
  })

  it('开关关闭（MATERIAL_COLLECTION_DISABLED=1）→ 不调用采集', async () => {
    process.env.MATERIAL_COLLECTION_DISABLED = '1'

    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_WITH_NEED,
    } as any)

    expect(collectMock).not.toHaveBeenCalled()
    expect(result.userProfile.normalizedInput.resources.materials).toBeUndefined()
  })

  it('超时 → fail-open（不阻塞）', async () => {
    process.env.MATERIAL_COLLECTION_TIMEOUT_MS = '5'
    collectMock.mockImplementation(() => new Promise(() => { /* 永不 resolve，模拟检索卡死 */ }))

    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_WITH_NEED,
    } as any)

    const materials = result.userProfile.normalizedInput.resources.materials
    expect(materials[0].status).toBe('not_found')
    expect(materials[0].notes.join(' ')).toContain('TIMEOUT')
  })
})

describe('path.coordinator 附件注入（附件是主线）', () => {
  it('用户上传了附件但未声明 needsMaterial → 附件进入 materials，且联网采集零调用', async () => {
    seedUpload('u1')

    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_BASE,
    } as any)

    expect(collectMock).not.toHaveBeenCalled()
    const materials = result.userProfile.normalizedInput.resources.materials
    expect(materials).toHaveLength(1)
    expect(materials[0].status).toBe('ok')
    expect(materials[0].pack.sourceUrl).toContain('attachment://')
    expect(materials[0].pack.sections[0].id).toBe('s-1')
    expect(materials[0].pack.keyPoints[0].cite).toBe('健康包括身心状况、动作发展和生活习惯三个方面')
    expect(materials[0].notes.join(' ')).toContain('用户上传的本地附件')
  })

  it('附件 + 联网需求 → 合并，且**附件在前**（附件是主线，联网只补信息）', async () => {
    seedUpload('u1')
    collectMock.mockResolvedValue([FAKE_PACK_RESULT])

    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_WITH_NEED,
    } as any)

    const materials = result.userProfile.normalizedInput.resources.materials
    expect(materials).toHaveLength(2)
    expect(materials[0].pack.sourceUrl).toContain('attachment://')
    expect(materials[1].pack.sourceUrl).toBe('https://www.moe.gov.cn/example')
  })

  it('附件属于别的用户 → 不注入（用户隔离）', async () => {
    seedUpload('user-2')

    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_BASE,
    } as any)

    expect(result.userProfile.normalizedInput.resources.materials).toBeUndefined()
  })

  it('开关 MATERIAL_UPLOAD_INJECTION_DISABLED=1 → 附件不注入（灰度回滚）', async () => {
    seedUpload('u1')
    process.env.MATERIAL_UPLOAD_INJECTION_DISABLED = '1'

    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u1',
      rawGoal: '按指南设计活动',
      visibleSummary: VISIBLE_BASE,
    } as any)

    expect(result.userProfile.normalizedInput.resources.materials).toBeUndefined()
  })
})
