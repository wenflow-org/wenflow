/**
 * 开场材料落地护栏（2026-11-12 实测「开场问题非常严重」）：
 * 模型把 taskDescription 里的对话/清单说成「这段/上面给的」而不摆本体——
 * 学生第一屏没有任何材料，课从第一句就悬空。护栏从 description 抽出材料行，
 * 开场 message 未含大半时整块补挂。
 */
import { ensureOpeningMaterialGrounding, extractOpeningMaterialLines } from '../teaching-session-views';
import type { TeachingScenarioContext } from '../teaching-context-types';

const ctx = (taskDescription: string) => ({ taskDescription }) as unknown as TeachingScenarioContext;

const baseOpening = {
  message: '这段对话里，助手看起来像是记得你前面说过的话。今天我们就拿它当样本。',
  question: '',
  quickReplies: [{ text: '开始' }],
  mode: 'example-first' as const,
};

const RUN_DIALOG_DESCRIPTION = [
  '下面这段跑步咨询对话完整给出，可逐轮对照。',
  '轮1 用户：我在为下个月的全程马拉松做准备。',
  '轮2 助手：全程马拉松 42.195 公里，备赛周期通常 16-20 周。',
  '轮3 用户：我这几天睡眠不太好。',
  '轮4 助手：睡眠不足会影响恢复，建议今晚早点休息。',
  '轮5 用户：顺便看看补水要注意什么。',
  '轮6 助手：长距离训练中每 15-20 分钟补水一次。',
  '轮7 用户：今天跑多远？',
  '轮8 助手：你今天可以安排一次 30 公里的长距离跑。',
  '任务分两步。第一步：逐轮标注每轮各自给出了什么信息。第二步：判断这位助手是否记住了前面几轮说过的话。',
].join('');

describe('extractOpeningMaterialLines（材料行抽取）', () => {
  it('抽出「轮N / 1.」开头的材料行，指令句不进材料', () => {
    const lines = extractOpeningMaterialLines(RUN_DIALOG_DESCRIPTION);
    expect(lines).toHaveLength(8);
    expect(lines[0].startsWith('轮1')).toBe(true);
    expect(lines[7].startsWith('轮8')).toBe(true);
    expect(lines.join('')).not.toContain('任务分两步');
  });
});

describe('ensureOpeningMaterialGrounding（开场材料落地护栏）', () => {
  it('2026-11-12 实测形态：开场只说「这段对话」不摆本体 → 整块补挂', () => {
    const result = ensureOpeningMaterialGrounding(baseOpening, ctx(RUN_DIALOG_DESCRIPTION));
    expect(result.message).toContain('本课材料先摆出来');
    expect(result.message).toContain('轮1 用户：我在为下个月的全程马拉松做准备。');
    expect(result.message).toContain('轮8 助手：你今天可以安排一次 30 公里的长距离跑。');
    // 原开场保留在前
    expect(result.message.startsWith('这段对话里')).toBe(true);
  });

  it('模型已把材料摆出大半（≥60%）→ 不重复补挂', () => {
    const selfContained = {
      ...baseOpening,
      message: [
        '先把样本摆出来：',
        '轮1 用户：我在为下个月的全程马拉松做准备。轮2 助手：全程马拉松 42.195 公里，备赛周期通常 16-20 周。',
        '轮3 用户：我这几天睡眠不太好。轮4 助手：睡眠不足会影响恢复，建议今晚早点休息。',
        '轮5 用户：顺便看看补水要注意什么。轮6 助手：长距离训练中每 15-20 分钟补水一次。',
        '轮7 用户：今天跑多远？轮8 助手：你今天可以安排一次 30 公里的长距离跑。',
      ].join('\n'),
    };
    const result = ensureOpeningMaterialGrounding(selfContained, ctx(RUN_DIALOG_DESCRIPTION));
    expect(result.message).toBe(selfContained.message);
  });

  it('description 没有材料线索词（普通任务）→ 不动', () => {
    const result = ensureOpeningMaterialGrounding(baseOpening, ctx('练习 10 道时态选择题，逐题写排除理由。1. 先限时完成。'));
    expect(result).toBe(baseOpening);
  });

  it('材料行不足 2 条 → 不动（避免把编号步骤误当材料）', () => {
    const result = ensureOpeningMaterialGrounding(
      baseOpening,
      ctx('下面这三步走。1. 先读题。2. 再作答。'),
    );
    expect(result).toBe(baseOpening);
  });
});
