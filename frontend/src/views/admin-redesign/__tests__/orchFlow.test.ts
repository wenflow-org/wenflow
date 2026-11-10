/**
 * 管线总览的字段交接统计（2026-11-10 用户「教学画像入为什么是 0」）。
 *
 * 契约口径（promptRole=hard-required）和交接口径（routing.handoff）不是一回事：
 * 前者是「模型必须产出的字段」，教学/画像/仿真没有，所以旧口径恒显示「入 0」；
 * 后者才回答数据从哪来、到哪去。这里用真实形状的夹具钉住计算：
 *   - handoff 目标可以是阶段 id（goal→'path'），也可以是下游 Agent id（teaching→skill:learning-predictor）
 *   - 同一字段在多条 routing 里被交接，按唯一字段计数
 *   - 自己交给自己（同阶段内）不计
 *   - 明细按「每个来源阶段最多 8 条」截断，避免 goal→path 的 36 条撑满悬停
 */
import { describe, expect, it } from 'vitest'
import { computeStageFlow, type StageDetailLike } from '../orchFlow'

const NAMES: Record<string, string> = {
  goal: '澄清阶段',
  path: '规划阶段',
  teaching: '教学阶段',
  profile: '画像阶段',
}

const stageNameOf = (id: string) => NAMES[id] || id

function detail(over: Partial<StageDetailLike> = {}): StageDetailLike {
  return { agents: [], fields: [], routings: [], ...over }
}

describe('computeStageFlow', () => {
  it('阶段 id 与下游 Agent id 两种 handoff 目标都认', () => {
    const details: Record<string, StageDetailLike> = {
      goal: detail({
        agents: [{ agentId: 'goal-agent' }],
        fields: [{ fieldId: 'understanding.real_problem', description: '真实问题' }],
        // 目标是阶段 id
        routings: [{ fieldId: 'understanding.real_problem', handoff: ['path'] }],
      }),
      path: detail({ agents: [{ agentId: 'path-agent' }] }),
      teaching: detail({
        agents: [{ agentId: 'teaching-agent' }, { agentId: 'skill:teaching-turn' }],
        fields: [{ fieldId: 'knowledgeStateSummary', description: '知识状态摘要' }],
        // 目标是下游 Agent id（learning-predictor 属于画像阶段）
        routings: [{ fieldId: 'knowledgeStateSummary', handoff: ['skill:learning-predictor'] }],
      }),
      profile: detail({
        agents: [{ agentId: 'profile-agent' }, { agentId: 'skill:learning-predictor' }],
      }),
    }
    const flow = computeStageFlow(['goal', 'path', 'teaching', 'profile'], stageNameOf, details)

    expect(flow.goal).toMatchObject({ inCount: 0, outCount: 1 })
    expect(flow.path).toMatchObject({ inCount: 1, outCount: 0 })
    expect(flow.teaching.outCount).toBe(1)
    expect(flow.profile.inCount).toBe(1)
    expect(flow.profile.inDetail).toContain('从「教学阶段」收到 1 个')
    expect(flow.profile.inDetail).toContain('知识状态摘要（knowledgeStateSummary）')
    expect(flow.goal.inDetail).toContain('没有从上游交接进来的字段')
  })

  it('同一字段多条 routing 重复交接只算一次；自交不计', () => {
    const details: Record<string, StageDetailLike> = {
      path: detail({
        agents: [{ agentId: 'path-agent' }],
        fields: [
          { fieldId: 'milestones.title', description: '阶段标题' },
          { fieldId: 'subtasks.title', description: '子任务标题' },
        ],
        routings: [
          { fieldId: 'milestones.title', handoff: ['teaching'] },
          { fieldId: 'milestones.title', handoff: ['teaching'] },
          // 同一阶段内的交接（path-agent）不算跨阶段流转
          { fieldId: 'subtasks.title', handoff: ['path-agent'] },
        ],
      }),
      teaching: detail({ agents: [{ agentId: 'teaching-agent' }] }),
    }
    const flow = computeStageFlow(['path', 'teaching'], stageNameOf, details)
    expect(flow.path.outCount).toBe(1)
    expect(flow.teaching.inCount).toBe(1)
    expect(flow.teaching.inDetail).toContain('阶段标题（milestones.title）')
  })

  it('明细每组最多 8 条，其余折成「另 N 个」', () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({ fieldId: `f${i}`, description: `字段${i}` }))
    const details: Record<string, StageDetailLike> = {
      goal: detail({
        fields,
        routings: fields.map((f) => ({ fieldId: f.fieldId, handoff: ['path'] })),
      }),
      path: detail(),
    }
    const flow = computeStageFlow(['goal', 'path'], stageNameOf, details)
    expect(flow.goal.outCount).toBe(12)
    expect(flow.path.inDetail.split('\n').filter((l) => l.startsWith('· ')).length).toBe(9) // 8 条 + 「另 4 个」
    expect(flow.path.inDetail).toContain('另 4 个')
  })

  it('未加载的阶段不出现；未知 handoff 目标忽略，不炸整块', () => {
    const details: Record<string, StageDetailLike> = {
      goal: detail({
        fields: [{ fieldId: 'a' }],
        routings: [
          { fieldId: 'a', handoff: ['path'] },
          { fieldId: 'a', handoff: ['skill:ghost'] },
        ],
      }),
    }
    const flow = computeStageFlow(['goal', 'path'], stageNameOf, details)
    expect(Object.keys(flow)).toEqual(['goal'])
    expect(flow.goal.outCount).toBe(0)
  })
})
