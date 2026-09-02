import {
  fsrsGradeFromStatus,
  fsrsEmptyState,
  fsrsStateFromLegacy,
  fsrsSchedule,
  fsrsRetrievability,
} from '../fsrs'
import { Rating } from 'ts-fsrs'

const DAY_MS = 24 * 60 * 60 * 1000

describe('fsrs grade 映射', () => {
  it('mastered + progress>=100 → Easy', () => {
    expect(fsrsGradeFromStatus('mastered', 100)).toBe(Rating.Easy)
  })
  it('mastered → Good', () => {
    expect(fsrsGradeFromStatus('mastered', 80)).toBe(Rating.Good)
  })
  it('review → Hard', () => {
    expect(fsrsGradeFromStatus('review', 50)).toBe(Rating.Hard)
  })
  it('learning / pending → Again', () => {
    expect(fsrsGradeFromStatus('learning', 30)).toBe(Rating.Again)
    expect(fsrsGradeFromStatus('pending', 0)).toBe(Rating.Again)
  })
})

describe('fsrs 状态初始化', () => {
  it('空状态', () => {
    const s = fsrsEmptyState()
    expect(s.stability).toBe(0)
    expect(s.reps).toBe(0)
    expect(s.lastReviewAt).toBeNull()
  })

  it('从 legacy 字段迁移（mastery 越高稳定性越高）', () => {
    const low = fsrsStateFromLegacy(0.2, 1, null)
    const high = fsrsStateFromLegacy(0.9, 5, null)
    expect(high.stability).toBeGreaterThan(low.stability)
    expect(high.reps).toBe(5)
    expect(low.lastReviewAt).toBeNull()
  })
})

describe('fsrs 调度核心', () => {
  it('首次 Good 复习建立稳定性（>0）', () => {
    const r = fsrsSchedule(null, Rating.Good, new Date())
    expect(r.state.stability).toBeGreaterThan(0)
    expect(r.state.lastReviewAt).not.toBeNull()
    expect(r.intervalDays).toBeGreaterThanOrEqual(1)
  })

  it('连续 Good 复习后稳定性单调递增（间隔拉长）', () => {
    let state = fsrsEmptyState()
    let prevStability = 0
    const now = new Date()
    for (let i = 0; i < 3; i++) {
      const r = fsrsSchedule(state, Rating.Good, new Date(now.getTime() + i * 3 * DAY_MS))
      if (i > 0) {
        expect(r.state.stability).toBeGreaterThan(prevStability)
      }
      prevStability = r.state.stability
      state = r.state
    }
    expect(state.reps).toBe(3)
  })

  it('Again（失败）后稳定性低于 Good（失败缩短间隔）', () => {
    const base = fsrsSchedule(null, Rating.Good, new Date()).state
    const afterGood = fsrsSchedule(base, Rating.Good, new Date(Date.now() + 3 * DAY_MS)).state
    const afterAgain = fsrsSchedule(base, Rating.Again, new Date(Date.now() + 3 * DAY_MS)).state
    expect(afterAgain.stability).toBeLessThan(afterGood.stability)
    expect(afterAgain.lapses).toBeGreaterThan(base.lapses)
  })

  it('intervalDays 至少 1 天（保护睡眠巩固窗口）', () => {
    const r = fsrsSchedule(null, Rating.Good, new Date())
    expect(r.intervalDays).toBeGreaterThanOrEqual(1)
  })

  it('desiredRetention 越高间隔越短（可作教学旋钮）', () => {
    const loose = fsrsSchedule(null, Rating.Good, new Date(), 0.8)
    const strict = fsrsSchedule(null, Rating.Good, new Date(), 0.95)
    expect(strict.intervalDays).toBeLessThanOrEqual(loose.intervalDays)
  })
})

describe('fsrs 可提取率', () => {
  it('无状态返回 0', () => {
    expect(fsrsRetrievability(fsrsEmptyState(), new Date())).toBe(0)
  })

  it('随时间衰减（越久越低）', () => {
    const state = fsrsSchedule(null, Rating.Good, new Date()).state
    const rSoon = fsrsRetrievability(state, new Date(state.lastReviewAt!.getTime() + 1 * DAY_MS))
    const rLate = fsrsRetrievability(state, new Date(state.lastReviewAt!.getTime() + 30 * DAY_MS))
    expect(rSoon).toBeGreaterThan(rLate)
  })

  it('结果钳制 0-1', () => {
    const state = fsrsSchedule(null, Rating.Good, new Date()).state
    expect(fsrsRetrievability(state, state.lastReviewAt!)).toBeLessThanOrEqual(1 + 1e-9)
    expect(fsrsRetrievability(state, new Date(state.lastReviewAt!.getTime() + 3650 * DAY_MS))).toBeGreaterThanOrEqual(0)
  })
})