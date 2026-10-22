/**
 * 虚拟学习者生命周期模型（vlab-controls）单测：
 * 三层控制台（列表/画像/座舱）共用同一操作模型——
 * 状态推导、操作守卫、确认文案集中在此，防止入口层自行改词/放宽守卫导致语义漂移。
 */
import { describe, expect, it } from 'vitest'
import {
  VS_CONTROL_DEFS,
  VS_STATE_META,
  deriveVsLifecycleState,
  deriveVsLifecycleStateFromRuns,
  vlabControlsFor
} from '../vlab-controls'

describe('deriveVsLifecycleState（状态推导）', () => {
  it('running + teachingPaused → paused（暂停是派生态）', () => {
    expect(deriveVsLifecycleState({ status: 'running', teachingPaused: true })).toBe('paused')
    expect(deriveVsLifecycleState({ status: 'running', teachingPaused: false })).toBe('running')
  })
  it('终态分别映射 failed / abandoned / completed', () => {
    expect(deriveVsLifecycleState({ status: 'failed' })).toBe('failed')
    expect(deriveVsLifecycleState({ status: 'abandoned' })).toBe('abandoned')
    expect(deriveVsLifecycleState({ status: 'completed' })).toBe('completed')
  })
  it('空态 → idle', () => {
    expect(deriveVsLifecycleState({})).toBe('idle')
    expect(deriveVsLifecycleState({ status: null })).toBe('idle')
  })

  /* 2026-10-19 运营走查：这两个分支原先只有座舱的状态徽章算得出来，顶栏按钮簇那份派生漏了，
     同一个会话会同时显示「已暂停」与「暂停」按钮。现在派生单源，分支优先级在此锁定。 */
  it('紧急停止 manualStopped → abandoned（会话可能仍记 failed，但对运营是被终止）', () => {
    expect(deriveVsLifecycleState({ status: 'running', manualStopped: true })).toBe('abandoned')
    expect(deriveVsLifecycleState({ status: 'failed', manualStopped: true })).toBe('failed')
  })
  it('自动驾驶 stopped → paused（驱动停了、会话没结束）', () => {
    expect(deriveVsLifecycleState({ status: 'running', autopilotStatus: 'stopped' })).toBe('paused')
    // 终态优先于驱动状态：跑完的会话即使留了 stopped 也不该被读成「已暂停」
    expect(deriveVsLifecycleState({ status: 'completed', autopilotStatus: 'stopped' })).toBe('completed')
  })
  it('优先级：终态 > 紧急停止 > 管理员暂停 > 自动驾驶停止', () => {
    expect(deriveVsLifecycleState({
      status: 'abandoned', manualStopped: true, teachingPaused: true, autopilotStatus: 'stopped'
    })).toBe('abandoned')
    expect(deriveVsLifecycleState({
      status: 'running', manualStopped: true, teachingPaused: true, autopilotStatus: 'stopped'
    })).toBe('abandoned')
    expect(deriveVsLifecycleState({
      status: 'running', teachingPaused: true, autopilotStatus: 'stopped'
    })).toBe('paused')
  })
})

describe('deriveVsLifecycleStateFromRuns（画像级聚合）', () => {
  const run = (o: Partial<{ result: string; tone: string; paused: boolean }>) => ({
    result: '', tone: '', paused: false, ...o
  })
  it('无记录 → idle', () => {
    expect(deriveVsLifecycleStateFromRuns([])).toBe('idle')
  })
  it('有暂停中的活跃会话 → paused（优先于其它活跃会话）', () => {
    expect(deriveVsLifecycleStateFromRuns([
      run({ result: 'running', tone: 'warn' }),
      run({ result: 'running', tone: 'warn', paused: true })
    ])).toBe('paused')
  })
  it('活跃会话优先于历史终态（最近在跑就是 running，不看旧失败）', () => {
    expect(deriveVsLifecycleStateFromRuns([
      run({ result: 'failed', tone: 'bad' }),
      run({ result: 'running', tone: 'warn' })
    ])).toBe('running')
  })
  it('无活跃会话时：失败优先于完成', () => {
    expect(deriveVsLifecycleStateFromRuns([
      run({ result: 'completed', tone: 'ok' }),
      run({ result: 'failed', tone: 'bad' })
    ])).toBe('failed')
    expect(deriveVsLifecycleStateFromRuns([run({ result: 'completed', tone: 'ok' })])).toBe('completed')
  })
})

describe('vlabControlsFor（状态 × 操作守卫）', () => {
  const keys = (state: Parameters<typeof vlabControlsFor>[0]) => vlabControlsFor(state).map((c) => c.key)

  it('running：只给 暂停/自动/推进/停止，不给重试（终态专属）', () => {
    const ks = keys('running')
    expect(ks).toContain('pause')
    expect(ks).toContain('auto')
    expect(ks).toContain('step')
    expect(ks).toContain('stop')
    expect(ks).not.toContain('retry')
    expect(ks).not.toContain('resume')
  })
  it('paused：只给 继续/停止，不给重复暂停', () => {
    const ks = keys('paused')
    expect(ks).toEqual(expect.arrayContaining(['resume', 'stop']))
    expect(ks).not.toContain('pause')
    expect(ks).not.toContain('retry')
  })
  it('failed/abandoned：给 重试/停止/删除/座舱（重试=续传，保进度）', () => {
    for (const st of ['failed', 'abandoned'] as const) {
      const ks = keys(st)
      expect(ks).toContain('retry')
      expect(ks).toContain('delete')
      expect(ks).not.toContain('auto')
      expect(ks).not.toContain('step')
    }
  })
  it('completed：只给 删除/座舱', () => {
    expect(keys('completed')).toEqual(expect.arrayContaining(['delete', 'cockpit']))
    expect(keys('completed')).not.toContain('retry')
  })
})

describe('vlabControlsFor（阶段能力收窄）', () => {
  const keys = (state: Parameters<typeof vlabControlsFor>[0], stage: string | null) =>
    vlabControlsFor(state, { stage }).map((c) => c.key)

  /* 回归（2026-10-22 走查）：goal/path 阶段顶栏仍给「暂停」，点下去后端 409
     「仅教学（teaching）阶段支持暂停」——控制项按阶段能力收窄，别让用户点一次才知道。 */
  it('running + goal/path：不给暂停，其余运行期操作照旧', () => {
    for (const stage of ['goal', 'path']) {
      const ks = keys('running', stage)
      expect(ks).not.toContain('pause')
      expect(ks).toEqual(expect.arrayContaining(['auto', 'step', 'stop', 'cockpit']))
    }
  })

  it('running + teaching / learn / teach：恢复给暂停', () => {
    for (const stage of ['teaching', 'learn', 'teach']) {
      expect(keys('running', stage)).toContain('pause')
    }
  })

  it('不传阶段（无阶段信息的调用点）：保持旧的按状态全集', () => {
    expect(vlabControlsFor('running').map((c) => c.key)).toContain('pause')
  })
})

describe('危险操作必须带确认（统一文案）', () => {
  it('stop / retry / delete 均带 confirm', () => {
    for (const key of ['stop', 'retry', 'delete'] as const) {
      expect(VS_CONTROL_DEFS[key].confirm).toBeTruthy()
    }
  })
  it('stop 的确认文案明确「不可恢复」；retry 明确「进度保留」', () => {
    expect(VS_CONTROL_DEFS.stop.confirm!.message).toContain('不可恢复')
    expect(VS_CONTROL_DEFS.retry.confirm!.message).toContain('保留')
    expect(VS_CONTROL_DEFS.retry.confirm!.message).toContain('续传')
  })
  it('状态元数据 7 态齐全', () => {
    expect(Object.keys(VS_STATE_META).sort()).toEqual(
      ['abandoned', 'completed', 'created', 'failed', 'idle', 'paused', 'running']
    )
  })
})