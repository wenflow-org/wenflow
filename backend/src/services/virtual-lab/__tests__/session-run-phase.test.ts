/**
 * 会话「在不在跑」的唯一判定（2026-10-21 口径统一）。
 * 背景：列表曾用 session.status 判断，但新会话在 goal/path 阶段是 created，
 * 即使自动驾驶正在推进也会被报成「已停止」；同一批 created 会话放久了又被算成「无响应」。
 */
import { classifySessionRunPhase } from '../session-run-phase'

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
