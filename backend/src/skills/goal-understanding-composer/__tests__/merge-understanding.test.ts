/**
 * `mergeUnderstanding` 对 canonical 容器的跨轮合并口径。
 *
 * 背景：这些容器是硬必填的读取来源（如 available_resources.time_budget/time_horizon、
 * success_criteria.observable_result）。非 delta 路径下模型某一轮只输出容器子集时，
 * 上一轮的兄弟键不能被整包覆盖丢掉，否则阶段会从 proposing 被压回 understanding。
 */
import { mergeUnderstanding } from '../index';

describe('mergeUnderstanding · canonical 容器跨轮合并', () => {
  it('本轮只给容器子集时，上一轮兄弟键仍在（不被整包覆盖）', () => {
    const previous = {
      real_problem: '一上坡就熄火，不敢开了',
      available_resources: { time_horizon: '三个月', time_budget: '每周5小时' },
      success_criteria: { observable_result: '能独立完成一次汇报', acceptance_check: '旧检查' },
      current_baseline: { level: 'beginner', evidence: '零基础' },
      time_dimensions: { timeModelVersion: 2, sessionsLengthMin: 60, objectiveScopeHours: 8, deadlineDate: null },
    };

    const merged = mergeUnderstanding(previous, {
      understanding: {
        available_resources: { time_budget: '每周8小时' },
        success_criteria: { acceptance_check: '能复述要点' },
      },
    });

    // 兄弟键保留 + 本轮新值覆盖同名键
    expect(merged.success_criteria).toEqual({ observable_result: '能独立完成一次汇报', acceptance_check: '能复述要点' });
    expect(merged.available_resources).toEqual({ time_horizon: '三个月', time_budget: '每周8小时' });
    // 本轮缺席的容器整体沿用上一轮
    expect(merged.current_baseline).toEqual({ level: 'beginner', evidence: '零基础' });
    expect(merged.time_dimensions).toEqual({ timeModelVersion: 2, sessionsLengthMin: 60, objectiveScopeHours: 8, deadlineDate: null });
  });

  it('本轮未提及的容器不被清空', () => {
    const merged = mergeUnderstanding(
      { success_criteria: { observable_result: '能独立完成一次汇报' } },
      { understanding: { real_problem: '诊断结论更具体了' } }
    );

    expect(merged.success_criteria).toEqual({ observable_result: '能独立完成一次汇报' });
    expect(merged.real_problem).toBe('诊断结论更具体了');
  });

  // #161 补口：canonical 四容器之外还有两个「静默累积」的对象容器，同样不能被
  // `...nextUnderstanding` 整包覆盖（sdt_needs 供 proposal 设计参考、
  // school_anchor 由 path.coordinator 读进 schoolAnchor）。修复前：
  // merged.sdt_needs = {competence}（autonomy 丢）、merged.school_anchor = {examScope}（textbook 丢）。
  it('静默累积容器（sdt_needs / school_anchor）本轮只给子集时，兄弟键仍在', () => {
    const merged = mergeUnderstanding(
      {
        sdt_needs: { autonomy: '想自己决定节奏', competence: '怕学不会' },
        school_anchor: { textbook: '人教版八年级上册 Unit 5', schoolPace: '每两周一单元' },
      },
      {
        understanding: {
          sdt_needs: { competence: '更怕答错被看见' },
          school_anchor: { examScope: '期中覆盖 Unit 1-5' },
        },
      }
    );

    expect(merged.sdt_needs).toEqual({ autonomy: '想自己决定节奏', competence: '更怕答错被看见' });
    expect(merged.school_anchor).toEqual({
      textbook: '人教版八年级上册 Unit 5',
      schoolPace: '每两周一单元',
      examScope: '期中覆盖 Unit 1-5',
    });
  });

  it('静默累积容器本轮缺席时整体沿用上一轮', () => {
    const merged = mergeUnderstanding(
      { school_anchor: { textbook: '人教A版必修第一册' } },
      { understanding: { surface_goal: '补数学' } }
    );

    expect(merged.school_anchor).toEqual({ textbook: '人教A版必修第一册' });
  });
});
