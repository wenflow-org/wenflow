import { findUnfurnishedChoiceQuestion } from '../teaching-checkpoint';

/**
 * 出题附料确定性检测（修复批 11-②，交流体验评审 §20.4#2「盲答判对」）：
 * 正文抛选择题形态而无 control.checkpoint、无内联选项列表 → 判「裸选择题」，
 * 引擎带修复指令重调一次。病历单：u19 b211a517 轮 8「下面哪个开头算先给落点？」
 * 无选项，学员盲答还被先采认「方向对」——评估作废。
 */
describe('findUnfurnishedChoiceQuestion（裸选择题判定）', () => {
  it('病历单形态全命中：正文问「下面哪个/以下哪一项/选一个」且无选项', () => {
    expect(findUnfurnishedChoiceQuestion(
      '小陈要给对接方提个要求，下面哪个开头算先给落点？',
      false,
    )?.snippet).toContain('下面哪个');
    expect(findUnfurnishedChoiceQuestion(
      '以下哪一项最接近源站？想一想再答。',
      false,
    )).not.toBeNull();
    expect(findUnfurnishedChoiceQuestion(
      '这几个方案里，从中选一个你认为最稳的。',
      false,
    )).not.toBeNull();
  });

  it('豁免一：本轮已出带 options 的 control.checkpoint → 不判', () => {
    expect(findUnfurnishedChoiceQuestion(
      '下面哪个开头算先给落点？题目在下面的选择题里。',
      true,
    )).toBeNull();
  });

  it('豁免二：正文自带内联选项列表（A. … B. …）→ 不判', () => {
    expect(findUnfurnishedChoiceQuestion(
      '下面哪个开头算先给落点？A. 上季度我们对接了四家供应商 B. 需要采购部把预算再压一压，请回确认。',
      false,
    )).toBeNull();
  });

  it('豁免二：正文自带圈号选项（①②③④⑤ 多于两个）→ 不判', () => {
    expect(findUnfurnishedChoiceQuestion(
      '下列哪个句子是主张句？①先讲结论 ②背景铺垫 ③数据佐证 ④风险提示。',
      false,
    )).toBeNull();
  });

  it('非选择题内容 → 不判（普通开放问/陈述句不触发）', () => {
    expect(findUnfurnishedChoiceQuestion(
      '你先说说这句里哪个词让你觉得它是背景？用自己的话讲。',
      false,
    )).toBeNull();
    expect(findUnfurnishedChoiceQuestion('', false)).toBeNull();
    expect(findUnfurnishedChoiceQuestion(null, false)).toBeNull();
  });
});
