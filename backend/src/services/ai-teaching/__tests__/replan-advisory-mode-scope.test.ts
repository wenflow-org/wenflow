/**
 * 复习课不得产出路径调整建议（2026-10-21）
 *
 * 背景：复习课收束走与正课相同的 endSession，重排建议构建只排除了 extension。
 * 实测近 14 天 105 个复习课堂里 32 个带上了 shouldSuggest=true 的建议——而复习课的
 * 知识看板是**跨路径**到期点，建议却挂到「开课时借用的那条路径」上，属于对象错配。
 * 复习结果只走 FSRS / 课内温故，不推动路径重排。
 */
import { shouldBuildReplanAdvisory } from '../ReplanAdvisoryService';

describe('重排建议的课型门（review / extension 抑制）', () => {
  it('正课（tutor）照常构建建议', () => {
    expect(shouldBuildReplanAdvisory('tutor')).toBe(true);
    expect(shouldBuildReplanAdvisory(null)).toBe(true);
    expect(shouldBuildReplanAdvisory(undefined)).toBe(true);
  })

  it('复习课（review）不构建：跨路径到期点不能推动单一路径重排', () => {
    expect(shouldBuildReplanAdvisory('review')).toBe(false);
  })

  it('延伸课（extension）不构建（#124 一期只观测）', () => {
    expect(shouldBuildReplanAdvisory('extension')).toBe(false);
  })
});
