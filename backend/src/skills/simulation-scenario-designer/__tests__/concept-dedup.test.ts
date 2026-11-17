/**
 * 画像概念去重（A/B 报告 D13，2026-10-13）：scenario-designer 侧同口径。
 *
 * story.problemKnowledge 与 personaSeed 的 known/struggle 都会落库为画像的 known/struggle 列，
 * 同一概念不得同时出现在两侧（struggle 优先，与 persona-designer / persistProfileConcepts 一致）。
 */
import { normalizeScenarioOutput, normalizeStory } from '../index';

describe('scenario-designer 概念去重（A/B 报告 D13）', () => {
  it('normalizeScenarioOutput：personaSeed 的 known 与 struggle 去重（struggle 优先）', () => {
    const out = normalizeScenarioOutput({
      personaSeed: { knownConcepts: ['信度与效度', '皮亚杰'], struggleConcepts: ['信度与效度', '能力推断'] },
    });
    const p = out.personaSeed;
    expect(p.knownConcepts).toContain('皮亚杰');
    expect(p.knownConcepts).not.toContain('信度与效度');
    expect(p.struggleConcepts).toContain('信度与效度');
    expect(p.knownConcepts.filter((c: string) => p.struggleConcepts.includes(c))).toEqual([]);
  });

  it('normalizeStory：problemKnowledge 的 known 与 struggle 去重（struggle 优先）', () => {
    const story = normalizeStory({
      problemKnowledge: { knownConcepts: ['学习理论', '数据指标'], struggleConcepts: ['学习理论', '能力推断'] },
    });
    const pk = story.problemKnowledge;
    expect(pk.knownConcepts).toContain('数据指标');
    expect(pk.knownConcepts).not.toContain('学习理论');
    expect(pk.struggleConcepts).toContain('学习理论');
    expect(pk.knownConcepts.filter((c: string) => pk.struggleConcepts.includes(c))).toEqual([]);
  });
});
