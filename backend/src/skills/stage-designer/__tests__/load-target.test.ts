import { withLoadTargetForMilestone } from '../index';
import { parsePathCognitiveDesign } from '../../../services/learning/learning.helpers';

/**
 * 回归（审计 §3.19 P1⑤）：规则 39 以 `milestone.loadTarget` 为键，而 path 层把它写在
 * `cognitiveCore.loadProfile.stageLoadDistribution[]`（按 stageNumber）里；两个调用点此前都不注入 ⇒ 规则永不生效。
 */
describe('stage-designer：loadTarget 注入（P1⑤）', () => {
  const cognitiveCore = {
    loadProfile: {
      stageLoadDistribution: [
        { stageNumber: 1, loadTarget: 'low', zpdDistance: 'close' },
        { stageNumber: 2, loadTarget: 'medium', zpdDistance: 'moderate' },
        { stageNumber: 3, loadTarget: 'high', zpdDistance: 'far' },
      ],
    },
  };

  it('按 stageNumber 取回 loadTarget 并挂到 milestone 上', () => {
    expect(withLoadTargetForMilestone({ stageNumber: 2, title: 't' }, cognitiveCore)).toEqual({
      stageNumber: 2,
      title: 't',
      loadTarget: 'medium',
    });
    // 兼容 stage 字段名（path-planning 的里程碑形状）
    expect(withLoadTargetForMilestone({ stage: 3, name: 'n' }, cognitiveCore).loadTarget).toBe('high');
  });

  it('已提供 loadTarget 时不覆盖；找不到对应阶段/无 loadProfile 时原样返回', () => {
    expect(withLoadTargetForMilestone({ stageNumber: 1, loadTarget: 'high' }, cognitiveCore).loadTarget).toBe('high');
    expect(withLoadTargetForMilestone({ stageNumber: 9 }, cognitiveCore)).toEqual({ stageNumber: 9 });
    expect(withLoadTargetForMilestone({ stageNumber: 1 }, null)).toEqual({ stageNumber: 1 });
    expect(withLoadTargetForMilestone({ stageNumber: 1 }, { loadProfile: null })).toEqual({ stageNumber: 1 });
  });

  it('脏输入不抛错（milestone 非对象）', () => {
    expect(withLoadTargetForMilestone(null, cognitiveCore)).toBeNull();
    expect(withLoadTargetForMilestone(undefined, cognitiveCore)).toBeUndefined();
  });

  /**
   * 集成（审计 P1 §2.3a）：真实链路是 path 落库的 aiPromptTemplate →
   * parsePathCognitiveDesign → cognitiveCore → withLoadTargetForMilestone。
   * 两端单测各自通过、链路仍可能断（loadProfile 曾在中途被丢）——这里把整条链钉住。
   */
  it('集成：落库模板 → parsePathCognitiveDesign → loadTarget 注入（整链）', () => {
    const persistedTemplate = JSON.stringify({
      cognitiveDesign: {
        cognitiveDomain: '汇报表达',
        coreConcepts: [{ id: 'concept-1', name: '结论先行', role: 'hub' }],
        loadProfile: {
          stageLoadDistribution: [{ stageNumber: 1, loadTarget: 'low' }, { stageNumber: 2, loadTarget: 'high' }],
        },
      },
    });

    const parsedCore = parsePathCognitiveDesign(persistedTemplate);
    expect(parsedCore).not.toBeNull();

    expect(withLoadTargetForMilestone({ stageNumber: 1, title: 't' }, parsedCore).loadTarget).toBe('low');
    expect(withLoadTargetForMilestone({ stageNumber: 2, title: 't' }, parsedCore).loadTarget).toBe('high');
    // 未列出的阶段不加键（规则文本本就写"若输入提供"）
    expect(withLoadTargetForMilestone({ stageNumber: 3, title: 't' }, parsedCore).loadTarget).toBeUndefined();
  });
});
