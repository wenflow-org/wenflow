import { mapReviewStatusToRating } from '../ReviewCompletedConsumer'

describe('mapReviewStatusToRating（复习结果 → FSRS 语义评分映射）', () => {
  it('mastered 满进度 → easy + 0.9', () => {
    expect(mapReviewStatusToRating('mastered', 100)).toEqual({ rating: 'easy', masteryScore: 0.9 })
  })

  it('mastered 未满进度 → good + 0.85', () => {
    expect(mapReviewStatusToRating('mastered', 60)).toEqual({ rating: 'good', masteryScore: 0.85 })
  })

  it('learning（推进但未掌握）→ hard + 0.5', () => {
    expect(mapReviewStatusToRating('learning', 40)).toEqual({ rating: 'hard', masteryScore: 0.5 })
  })

  it('其他状态（未推进，如 review/pending）→ again + 0.5', () => {
    expect(mapReviewStatusToRating('review', 50)).toEqual({ rating: 'again', masteryScore: 0.5 })
    expect(mapReviewStatusToRating('pending', 0)).toEqual({ rating: 'again', masteryScore: 0.5 })
  })
})
