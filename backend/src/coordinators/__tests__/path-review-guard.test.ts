import { shouldForceAcceptPathReview } from '../simulation.coordinator';

/**
 * Path 评审 ↔ 重规划 收敛护栏（issue: 死循环）
 *
 * 根因：`reviewPathProposal` 把 `path_review.status` 重写为 'pending'，令
 * `replanPathFromReview` 里 `status === 'replanned'` 的守卫永不触发；而重规划常产出
 * 同一条 Path（resultPathId === learningPathId），导致无限 modify → replan 循环。
 */
describe('shouldForceAcceptPathReview（path 重规划护栏）', () => {
  const PATH = 'lp_1';

  it('decision=accept → 不强制（走正常接受分支）', () => {
    expect(shouldForceAcceptPathReview({ decision: 'accept', learningPathId: PATH, replanCount: 99 })).toBe(false);
  });

  it('已对「当前这条 Path」重规划过（resultPathId === learningPathId）→ 强制接受', () => {
    expect(shouldForceAcceptPathReview({
      decision: 'modify', learningPathId: PATH, replanResultPathId: PATH, replanCount: 1, limit: 2
    })).toBe(true);
  });

  it('重规划产出了「另一条 Path」且未达上限 → 不强制（允许继续修正）', () => {
    expect(shouldForceAcceptPathReview({
      decision: 'modify', learningPathId: PATH, replanResultPathId: 'lp_2', replanCount: 1, limit: 2
    })).toBe(false);
  });

  it('达到重规划上限 → 强制接受', () => {
    expect(shouldForceAcceptPathReview({
      decision: 'modify', learningPathId: PATH, replanResultPathId: null, replanCount: 2, limit: 2
    })).toBe(true);
    expect(shouldForceAcceptPathReview({
      decision: 'reject', learningPathId: PATH, replanResultPathId: null, replanCount: 3, limit: 2
    })).toBe(true);
  });

  it('未达上限且从未重规划过 → 不强制（保留「学生质疑 → 路径修正」的价值）', () => {
    expect(shouldForceAcceptPathReview({
      decision: 'modify', learningPathId: PATH, replanResultPathId: null, replanCount: 0, limit: 2
    })).toBe(false);
  });

  it('limit=0（关闭重规划）→ 首次 modify 即强制接受', () => {
    expect(shouldForceAcceptPathReview({
      decision: 'modify', learningPathId: PATH, replanResultPathId: null, replanCount: 0, limit: 0
    })).toBe(true);
  });

  it('decision 为空 → 不强制', () => {
    expect(shouldForceAcceptPathReview({ decision: null, learningPathId: PATH, replanCount: 5 })).toBe(false);
  });
});
