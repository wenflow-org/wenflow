/**
 * 会话「在不在跑」的唯一判定（2026-10-21 口径统一）。
 * 背景：列表曾用 session.status 判断，但新会话在 goal/path 阶段是 created，
 * 即使自动驾驶正在推进也会被报成「已停止」；同一批 created 会话放久了又被算成「无响应」。
 */
import { classifySessionRunPhase, readAutopilotError, collectAutopilotErrors } from '../session-run-phase'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const THRESHOLD = new Date('2026-10-21T11:00:00.000Z') // 一小时前
const fresh = new Date('2026-10-21T11:50:00.000Z')
const stale = new Date('2026-10-21T09:00:00.000Z')

const state = (autopilot?: string, teachingPaused?: boolean) =>
  JSON.stringify({
    ...(autopilot ? { autopilot: { status: autopilot } } : {}),
    ...(teachingPaused ? { teaching: { paused: true } } : {})
  })

describe('classifySessionRunPhase', () => {
  it('新会话（status=created）只要有自动驾驶在推就是 running，不看 session.status', () => {
    expect(classifySessionRunPhase({ status: 'created', stageResults: state('running'), updatedAt: fresh }, THRESHOLD)).toBe('running')
    expect(classifySessionRunPhase({ status: 'created', stageResults: state('queued'), updatedAt: fresh }, THRESHOLD)).toBe('running')
  })

  it('在推但心跳超阈值 → stalled（无响应）', () => {
    expect(classifySessionRunPhase({ status: 'running', stageResults: state('running'), updatedAt: stale }, THRESHOLD)).toBe('stalled')
  })

  it('autopilot stopped 或课堂暂停 → paused（不是无响应）', () => {
    expect(classifySessionRunPhase({ status: 'running', stageResults: state('stopped'), updatedAt: stale }, THRESHOLD)).toBe('paused')
    expect(classifySessionRunPhase({ status: 'running', stageResults: state('running', true), updatedAt: stale }, THRESHOLD)).toBe('paused')
  })

  it('没有自动驾驶（idle/completed/failed）或已终态 → idle（列表显示已停止）', () => {
    expect(classifySessionRunPhase({ status: 'created', stageResults: null, updatedAt: fresh }, THRESHOLD)).toBe('idle')
    expect(classifySessionRunPhase({ status: 'running', stageResults: state('completed'), updatedAt: fresh }, THRESHOLD)).toBe('idle')
    expect(classifySessionRunPhase({ status: 'abandoned', stageResults: state('running'), updatedAt: fresh }, THRESHOLD)).toBe('idle')
  })

  it('坏 JSON 不抛错，按 idle 处理', () => {
    expect(classifySessionRunPhase({ status: 'running', stageResults: '{oops', updatedAt: fresh }, THRESHOLD)).toBe('idle')
    expect(classifySessionRunPhase({ status: 'running', stageResults: null, updatedAt: null as never }, THRESHOLD)).toBe('idle')
  })
})

/**
 * 2026-11-09 运营流程核查：目标阶段（status=created）的会话自动驾驶失败（如渠道 503）时，
 * 列表「异常」列必须报出来；系统自愈（进程重启/对账收敛）与运营主动停（stopRequested/已暂停）
 * 不算异常，否则黄灯会被正常暂停刷满。
 */
describe('readAutopilotError', () => {
  const withError = (lastError: unknown) => JSON.stringify({ autopilot: { status: 'failed', lastError } })

  it('真实故障原样返回（渠道、未收敛、看门狗、黑盒重试）', () => {
    expect(readAutopilotError(withError('Provider request retry budget exhausted')))
      .toBe('Provider request retry budget exhausted')
    expect(readAutopilotError(withError('Goal 阶段 3 次尝试后仍未收敛'))).toContain('仍未收敛')
    expect(readAutopilotError(withError('no_progress_watchdog：连续 1 个回合分片无净进展'))).toContain('no_progress_watchdog')
    expect(readAutopilotError(withError('黑盒 step 连续失败（3 次）'))).toContain('黑盒 step')
  })

  it('预期态不算异常：进程重启 / 对账收敛 / stopRequested / 已暂停 / 排队取消', () => {
    expect(readAutopilotError(withError('进程重启，自动驾驶已中断（可重新启动）'))).toBeNull()
    expect(readAutopilotError(withError('会话已 abandoned，自动驾驶不可能仍在运行（对账收敛）'))).toBeNull()
    expect(readAutopilotError(withError('stopRequested / 已暂停 / 手动停止'))).toBeNull()
    expect(readAutopilotError(withError('排队中被取消'))).toBeNull()
  })

  it('空值 / 坏 JSON / 空白串一律返回 null（列表不因脏数据报异常）', () => {
    expect(readAutopilotError(null)).toBeNull()
    expect(readAutopilotError('{oops')).toBeNull()
    expect(readAutopilotError(JSON.stringify({}))).toBeNull()
    expect(readAutopilotError(withError('   '))).toBeNull()
    expect(readAutopilotError(withError(null))).toBeNull()
  })
})

describe('collectAutopilotErrors：列表「异常」列取数', () => {
  const err = (msg: string) => JSON.stringify({ autopilot: { status: 'failed', lastError: msg } })

  it('created 会话（goal/path 阶段）的失败也计入——这正是旧判据漏掉的一类', () => {
    const byProfile = collectAutopilotErrors([
      { virtualProfileId: 'p1', stageResults: err('Provider request retry budget exhausted') },
    ])
    expect(byProfile.get('p1')).toBe('Provider request retry budget exhausted')
  })

  it('同一画像多条会话：取第一条真故障，预期态不占位', () => {
    const byProfile = collectAutopilotErrors([
      { virtualProfileId: 'p1', stageResults: err('进程重启，自动驾驶已中断（可重新启动）') },
      { virtualProfileId: 'p1', stageResults: err('Path 生成等待超时（10 分钟无进展）') },
      { virtualProfileId: 'p1', stageResults: err('另一条更晚的故障') },
    ])
    expect(byProfile.get('p1')).toBe('Path 生成等待超时（10 分钟无进展）')
  })

  it('无错误 / 无画像 id 的会话直接跳过', () => {
    const byProfile = collectAutopilotErrors([
      { virtualProfileId: 'p1', stageResults: JSON.stringify({ autopilot: { status: 'running' } }) },
      { virtualProfileId: null, stageResults: err('孤儿会话的故障') },
      { stageResults: err('缺画像 id') },
    ])
    expect(byProfile.size).toBe(0)
  })
})
