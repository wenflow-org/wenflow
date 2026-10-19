/**
 * 座舱「运行状态」卡的驱动器行（2026-10-19 运营走查）：
 * 运行中此前只有阶段点阵，没有任何「还在动」的证据——运营分不出「在跑」与「在跑但卡住」，
 * 也不知道自己在队列第几位（那份信息只在顶栏「取消排队（第 N 位）」按钮上，一点就取消了）。
 *
 * 判据全部来自已有字段（status / queuePosition / heartbeatAt），阈值与后端僵尸判定同值
 * （autopilot.service.ts `isStaleAutopilotRun` 10 分钟），这里把两者钉在一起防漂移。
 */
import { describe, expect, it } from 'vitest'
import { AUTOPILOT_STALE_MS, autopilotDriverLine } from '../cockpitAutopilot'

const NOW = Date.parse('2026-10-19T10:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('autopilotDriverLine', () => {
  it('idle / 无状态 → 不渲染（终态另有结果行，不重复）', () => {
    expect(autopilotDriverLine({ status: '' }, NOW)).toBeNull()
    expect(autopilotDriverLine({ status: 'idle' }, NOW)).toBeNull()
    expect(autopilotDriverLine({ status: 'completed' }, NOW)).toBeNull()
    expect(autopilotDriverLine({ status: 'stopped' }, NOW)).toBeNull()
  })

  it('排队中：给出位次（运营此前只能靠顶栏那枚「取消排队」按钮知道排第几）', () => {
    const line = autopilotDriverLine({ status: 'queued', queuePosition: 3 }, NOW)!
    expect(line.text).toBe('排队中 · 第 3 位')
    expect(line.tone).toBe('warn')
    expect(line.title).toContain('并发名额已满')
  })

  it('排队但位次缺失 → 按第 1 位兜底（后端给的是「第 N 位」，不自造空值）', () => {
    expect(autopilotDriverLine({ status: 'queued', queuePosition: null }, NOW)!.text).toBe('排队中 · 第 1 位')
  })

  it('运行中 + 新鲜心跳 → ok，文案带「X 秒前」', () => {
    const line = autopilotDriverLine({ status: 'running', heartbeatAt: ago(12_000) }, NOW)!
    expect(line.text).toBe('自动推进中 · 最后心跳 12 秒前')
    expect(line.tone).toBe('ok')
  })

  it('运行中 + 心跳超过后端阈值 → warn（与 isStaleAutopilotRun 同一把尺子）', () => {
    const line = autopilotDriverLine({ status: 'running', heartbeatAt: ago(AUTOPILOT_STALE_MS + 60_000) }, NOW)!
    expect(line.tone).toBe('warn')
    expect(line.title).toContain('10 分钟')
    expect(line.text).toContain('自动推进中')
  })

  it('刚好等于阈值不算卡住（判据是「超过」）', () => {
    expect(autopilotDriverLine({ status: 'running', heartbeatAt: ago(AUTOPILOT_STALE_MS) }, NOW)!.tone).toBe('ok')
  })

  it('已请求停止 → muted，且不再报心跳（此刻「不动」是预期）', () => {
    const line = autopilotDriverLine({ status: 'running', stopRequested: true, heartbeatAt: ago(60_000) }, NOW)!
    expect(line.text).toBe('已请求停止，等待当前回合收口')
    expect(line.tone).toBe('muted')
  })

  it('心跳缺失或不可解析 → 退回「自动推进中」，不编造时间', () => {
    expect(autopilotDriverLine({ status: 'running' }, NOW)!.text).toBe('自动推进中')
    expect(autopilotDriverLine({ status: 'running', heartbeatAt: 'not-a-date' }, NOW)!.text).toBe('自动推进中')
  })

  it('小时级心跳按小时表述（长时间卡住的读法）', () => {
    expect(autopilotDriverLine({ status: 'running', heartbeatAt: ago(3 * 3600_000) }, NOW)!.text)
      .toBe('自动推进中 · 最后心跳 3 小时前')
  })

  it('时钟落后于心跳（客户端时钟偏差）不出现负数', () => {
    const line = autopilotDriverLine({ status: 'running', heartbeatAt: ago(-5_000) }, NOW)!
    expect(line.text).toBe('自动推进中 · 最后心跳 0 秒前')
  })
})
