/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内构造最小状态载荷 */
/**
 * 点名阶段「困惑回退」（2026-11-27 苏格拉底论证课）：
 *
 * 实录：开场说「用的是两小段…的示意转述」但一句都没摆；学生回「我都不知道是什么事情啊」，
 * 老师给完背景仍在问「没有连接词还有没有结论」——学生连要拆的句子都没见过。
 *
 * 两条确定性修复：
 *  1) 学生发懵不消耗点名的唯一一轮：留在 orient，给「先摆第一组材料再问」的指令；
 *  2) 模型仍没摆材料时，引擎把第一组逐字插在最后一个问句之前。
 */
import {
  ensureConfusionMaterialOnScreen,
} from '../teaching-session-views';
import { isLearnerConfusionSignal, resolveLessonPhaseTurn, settleLessonPhase, type LessonPhaseState, type LessonPhaseTurnContext } from '../lesson-phase';

const MATERIAL = [
  '（以下按《申辩篇》受审段大意改写的示意性转述，非译本原文）',
  '',
  'A 组（带连接词）：',
  '① 一个人若从不收学费、也不靠教人说话谋生，就很难说他把这门手艺当成了营生。',
  '② 苏格拉底从不收学费，也不靠教人说话谋生。',
  '③ 所以说他以教人说话为业，站不住。',
  '',
  'B 组（顺序打乱、无连接词）：',
  '① 那些被我问住的人恼羞成怒。',
  '② 这些恼怒后来变成了对我的控告。',
].join('\n');

const SEGMENTS = [{ index: 1, title: 'A 组：带连接词', rows: [0] }];

function ctx(overrides: Partial<LessonPhaseTurnContext> = {}): LessonPhaseTurnContext {
  return {
    teachingTurns: 1,
    isResume: false,
    isSubmission: false,
    verdictPassed: null,
    pendingCheckpoint: false,
    endIntent: false,
    learnerSkipRequested: false,
    studentMessage: '我都不知道是什么事情啊',
    contract: null,
    evidence: [],
    segments: SEGMENTS,
    exploratory: false,
    taughtText: '',
    acceptanceCriteria: null,
    ...overrides,
  };
}

const settle = (state: LessonPhaseState) => settleLessonPhase(state, {
  segmentDone: false,
  checkpointEmitted: false,
  isSubmission: false,
  verdictPassed: null,
  checkpointVoided: false,
});

describe('isLearnerConfusionSignal', () => {
  it('认出「不知道是什么事情 / 啥意思 / 没看懂」', () => {
    expect(isLearnerConfusionSignal('我都不知道是什么事情啊')).toBe(true);
    expect(isLearnerConfusionSignal('啥意思啊，不明白')).toBe(true);
    expect(isLearnerConfusionSignal('没看懂这段')).toBe(true);
  });

  it('「不明白」出现在正常答题/已知声明里不误判', () => {
    expect(isLearnerConfusionSignal('这题我明白，选 B')).toBe(false);
    expect(isLearnerConfusionSignal('我知道了')).toBe(false);
    expect(isLearnerConfusionSignal('我觉得结论是第三句，因为前两句在撑它')).toBe(false);
  });
});

describe('点名阶段：困惑不推进', () => {
  it('第一次点名后学生仍发懵 → 留在 orient，指令要求先摆材料、问看得见的判断', () => {
    const first = resolveLessonPhaseTurn(null, ctx({ teachingTurns: 0, studentMessage: '开始了' }))!;
    expect(first.state.phase).toBe('orient');
    const view = resolveLessonPhaseTurn(settle(first.state), ctx())!;
    expect(view.state.phase).toBe('orient');
    expect(view.directive).toContain('不推进到建构');
    expect(view.directive).toContain('逐字');
    expect(view.directive).toContain('哪一句是在给另一句撑腰');
  });

  it('最多多留一轮：第二轮仍说「不明白」也进入建构，不卡在点名', () => {
    const first = resolveLessonPhaseTurn(null, ctx({ teachingTurns: 0, studentMessage: '开始了' }))!;
    const second = resolveLessonPhaseTurn(settle(first.state), ctx())!;
    const third = resolveLessonPhaseTurn(settle(second.state), ctx({ teachingTurns: 2, studentMessage: '还是不明白' }))!;
    expect(third.state.phase).toBe('build');
  });

  it('学生正常回应 → 照常进入建构', () => {
    const first = resolveLessonPhaseTurn(null, ctx({ teachingTurns: 0, studentMessage: '开始了' }))!;
    const view = resolveLessonPhaseTurn(settle(first.state), ctx({ studentMessage: '先猜一个：有结论。' }))!;
    expect(view.state.phase).toBe('build');
  });
});

describe('ensureConfusionMaterialOnScreen', () => {
  it('材料没上屏 → 第一组逐字插在最后一个问句之前，第二组不提前出现', () => {
    const reply = '没关系，先报个名：拆出论证骨架。\n\n先猜一个，猜错没关系：如果一段话里没有「所以」，你觉得它还有没有结论？';
    const grounded = ensureConfusionMaterialOnScreen(reply, MATERIAL);
    expect(grounded).toContain('① 一个人若从不收学费');
    expect(grounded).toContain('③ 所以说他以教人说话为业，站不住。');
    expect(grounded).not.toContain('那些被我问住的人');
    // 材料在问句之前
    expect(grounded.indexOf('A 组（带连接词）')).toBeLessThan(grounded.indexOf('先猜一个'));
    // 原问句仍在最后
    expect(grounded.trimEnd().endsWith('？')).toBe(true);
  });

  it('正文已含这组材料 → 不重复插', () => {
    const reply = '先看这组：\n① 一个人若从不收学费、也不靠教人说话谋生，就很难说他把这门手艺当成了营生。\n\n哪一句在给另一句撑腰？';
    expect(ensureConfusionMaterialOnScreen(reply, MATERIAL)).toBe(reply);
  });

  it('没有材料 / 空正文 → 原样返回', () => {
    expect(ensureConfusionMaterialOnScreen('先猜一下？', null)).toBe('先猜一下？');
    expect(ensureConfusionMaterialOnScreen('', MATERIAL)).toBe('');
  });
});
