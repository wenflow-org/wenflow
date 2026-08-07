/**
 * TT golden：teaching 回合输入通道配置化装配等价验证。
 * assembleTeachingTurnChannels 按 routings 表 teaching-agent 通道行 + pathInRawOutput
 * 从回合装配源 { session, teachingState, context } 抽值；本测试验证抽值与
 * buildTeachingTurnInput 手拼来源（AITeachingCoordinator 既有逻辑）等价。
 */

import { assembleTeachingTurnChannels } from '../field-dispatcher';
import { TEACHING_FIELD_ROUTING_FIELDS, TEACHING_FIELD_ROUTINGS } from '../../scripts/seed-execution-field-routings';

const TEACHING_CHANNEL_ROWS = TEACHING_FIELD_ROUTINGS
  .filter((r) => r.agentId === 'teaching-agent' && r.handoff.includes('skill:teaching-turn'))
  .map((r) => ({
    fieldId: r.fieldId,
    handoff: r.handoff,
    pathInRawOutput: TEACHING_FIELD_ROUTING_FIELDS.find((f) => f.fieldId === r.fieldId)?.pathInRawOutput || null,
  }))

const SESSION = {
  messages: [
    { role: 'assistant', content: '欢迎', analysis: { understanding: 0.5 } },
    { role: 'user', content: '开始吧' },
  ],
  knowledgeState: [
    { name: '闭包', status: 'learning', progress: 40 },
    { name: '作用域', status: 'mastered', progress: 100 },
  ],
  mode: 'standard',
}

const TEACHING_STATE = {
  classroomContext: { stage: { current: 'teaching' }, focus: { currentKnowledgePoint: '闭包' } },
  teachingControlContext: { priority: 'high', allowCheckpoint: true, allowPeerSupport: false },
}

const CONTEXT = {
  learnerProjection: { profile: { narrativeInsights: { goalNarrative: '想学会闭包' } } },
  subject: 'JavaScript',
  topic: '闭包',
  pathProgress: { pathTitle: '前端入门', pathSummary: '从零到可交付', currentMilestoneTitle: '函数进阶', currentStageNumber: 2, currentTaskOrder: 1, totalTasksInMilestone: 3 },
}

describe('assembleTeachingTurnChannels（回合输入通道配置化装配）', () => {
  it('5 个通道抽值与手拼来源等价', async () => {
    const source = { session: SESSION, teachingState: TEACHING_STATE, context: CONTEXT }
    const { channels, skipped } = await assembleTeachingTurnChannels(source, TEACHING_CHANNEL_ROWS)

    // learner ← context.learnerProjection（buildTeachingTurnInput 手拼来源）
    expect(channels['learner.learnerProjection']).toBe(CONTEXT.learnerProjection)
    // knowledge.state ← session.knowledgeState（手拼：knowledge.points = session.knowledgeState）
    expect(channels['knowledge.state']).toBe(SESSION.knowledgeState)
    // classroomContext ← teachingState.classroomContext
    expect(channels['classroomContext']).toBe(TEACHING_STATE.classroomContext)
    // controls.teachingControlContext ← teachingState.teachingControlContext
    expect(channels['controls.teachingControlContext']).toBe(TEACHING_STATE.teachingControlContext)
    // visibleDialogueContext ← session.messages（手拼映射 {role, content} 前）
    expect(channels['visibleDialogueContext']).toBe(SESSION.messages)

    expect(skipped).toEqual([])
  })

  it('通道行全部登记 pathInRawOutput（装配可执行）', () => {
    const rows = TEACHING_FIELD_ROUTINGS.filter((r) => r.agentId === 'teaching-agent' && r.handoff.includes('skill:teaching-turn'))
    expect(rows.length).toBe(5)
    for (const row of rows) {
      const field = TEACHING_FIELD_ROUTING_FIELDS.find((f) => f.fieldId === row.fieldId)
      expect(field?.pathInRawOutput).toBeTruthy()
    }
  })

  it('缺字段时跳过且不猜测路径', async () => {
    const { channels, skipped } = await assembleTeachingTurnChannels(
      { session: { ...SESSION, knowledgeState: undefined }, teachingState: TEACHING_STATE, context: CONTEXT },
      TEACHING_CHANNEL_ROWS,
    )
    expect(channels['knowledge.state']).toBeUndefined()
    expect(skipped.some((item) => item.includes('knowledge.state'))).toBe(true)
    expect(channels['classroomContext']).toBe(TEACHING_STATE.classroomContext)
  })
})
