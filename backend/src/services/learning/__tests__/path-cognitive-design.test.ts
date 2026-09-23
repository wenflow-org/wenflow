/**
 * `parsePathCognitiveDesign` 的载荷保真（审计 P1 §2.3a）。
 *
 * 它产出的对象会被**整份**当作 `cognitiveCore` 交给 stage-designer；stage 侧
 * `withLoadTargetForMilestone` 依赖 `cognitiveCore.loadProfile.stageLoadDistribution`
 * 才能挂出 `milestone.loadTarget`（CLT 负荷调整与规则 #13 的唯一输入）。
 * 此前只返回 {cognitiveDomain, coreConcepts}，把 loadProfile / prerequisiteTree 丢掉
 * ⇒ 生产与重规划两处 loadTarget 永不生效。
 */
import { parsePathCognitiveDesign } from '../learning.helpers';

describe('parsePathCognitiveDesign', () => {
  it('保留 loadProfile 与 prerequisiteTree（loadTarget 链路的唯一输入）', () => {
    const raw = JSON.stringify({
      cognitiveDesign: {
        cognitiveDomain: '汇报表达',
        coreConcepts: [{ id: 'concept-1', name: '结论先行', role: 'hub' }],
        loadProfile: {
          stageLoadDistribution: [{ stageNumber: 1, loadTarget: 'low' }, { stageNumber: 2, loadTarget: 'high' }],
        },
        prerequisiteTree: { rootConcept: '汇报表达', unknownConcepts: [{ concept: '问题结构' }] },
      },
    });

    const design = parsePathCognitiveDesign(raw);
    expect(design?.cognitiveDomain).toBe('汇报表达');
    expect(design?.coreConcepts).toHaveLength(1);
    const withProfile = design as unknown as {
      loadProfile?: { stageLoadDistribution?: unknown[] };
      prerequisiteTree?: { unknownConcepts?: Array<{ concept?: string }> };
    };
    expect(withProfile.loadProfile?.stageLoadDistribution).toHaveLength(2);
    expect(withProfile.prerequisiteTree?.unknownConcepts?.[0]?.concept).toBe('问题结构');
  });

  it('缺 loadProfile 时不凭空造键（下游按"未提供"处理）', () => {
    const design = parsePathCognitiveDesign(JSON.stringify({
      cognitiveCore: { cognitiveDomain: 'x', coreConcepts: [{ name: 'A' }] },
    }));
    expect(design).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(design, 'loadProfile')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(design, 'prerequisiteTree')).toBe(false);
  });

  it('认知核心为空 / JSON 非法 / 空串 → null（不抛错）', () => {
    expect(parsePathCognitiveDesign(null)).toBeNull();
    expect(parsePathCognitiveDesign('')).toBeNull();
    expect(parsePathCognitiveDesign('not json')).toBeNull();
    expect(parsePathCognitiveDesign(JSON.stringify({ cognitiveCore: {} }))).toBeNull();
  });

  it('coreConcepts 归一仍生效（id 缺省补 concept-N、role 归一、空名丢弃）', () => {
    const design = parsePathCognitiveDesign(JSON.stringify({
      cognitiveCore: {
        cognitiveDomain: 'd',
        coreConcepts: [{ name: 'A', role: 'hub' }, { name: 'B' }, { name: '   ' }],
      },
    }));
    expect(design?.coreConcepts.map((c) => ({ id: c.id, role: c.role }))).toEqual([
      { id: 'concept-1', role: 'hub' },
      { id: 'concept-2', role: 'supporting' },
    ]);
  });
});
