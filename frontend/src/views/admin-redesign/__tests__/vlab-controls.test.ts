/**
 * 虚拟学习者生命周期模型（vlab-controls）单测：
 * 三层控制台（列表/画像/座舱）共用同一操作模型——
 * 状态推导、操作守卫、确认文案集中在此，防止入口层自行改词/放宽守卫导致语义漂移。
 */
import { describe, expect, it } from 'vitest'
import { VS_CONTROL_DEFS, VS_STATE_META, deriveVsLifecycleState, vlabControlsFor } from '../vlab-controls'

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