import { findRepeatedQuestionAfterAnswer } from '../question-loop-guard';

/**
 * 已答不推进守卫（修复批 19-①，F_LOOP u17 批 R critical 可复算杠杆）：
 * 学员实质性作答后教师原样重复同一问句 → 判「已答不推进」，引擎带修复指令重调一次。
 * 病历单：学员答对「失效策略是主因」后，教师对「最先该动的是哪个机制？」原样重复，
 * 学员开始自我怀疑。
 */
describe('findRepeatedQuestionAfterAnswer（已答不推进判定）', () => {
  it('病历单形态命中：学员实质作答后同一问句原样重复', () => {
    expect(findRepeatedQuestionAfterAnswer({
      priorTeacherReply: '三个刷新路径摆在这了。你觉得最先该动的是哪个机制？',
      learnerReply: '我觉得最先该动的是失效策略，因为 TTL 到了它自己就换了内容。',
      currentReply: '再想想——你觉得最先该动的是哪个机制？',
    })?.repeated).toContain('最先该动的是哪个机制');
  });

  it('豁免：短确认/反问不算「已答」→ 不判', () => {
    expect(findRepeatedQuestionAfterAnswer({
      priorTeacherReply: '你觉得最先该动的是哪个机制？',
      learnerReply: '嗯',
      currentReply: '你觉得最先该动的是哪个机制？',
    })).toBeNull();
    expect(findRepeatedQuestionAfterAnswer({
      priorTeacherReply: '你觉得哪个机制最先动？',
      learnerReply: '是失效策略吗？我不太确定。',
      currentReply: '你觉得哪个机制最先动？',
    })).toBeNull();
  });

  it('豁免：本轮没有重复问句（教师接住作答推进）→ 不判', () => {
    expect(findRepeatedQuestionAfterAnswer({
      priorTeacherReply: '你觉得最先该动的是哪个机制？',
      learnerReply: '最先该动的是失效策略，TTL 到了它自己就换内容。',
      currentReply: '对，失效策略先动——那 TTL 是谁设的，改动它会影响什么？',
    })).toBeNull();
  });

  it('空输入 → 不判', () => {
    expect(findRepeatedQuestionAfterAnswer({ priorTeacherReply: '', learnerReply: '', currentReply: '' })).toBeNull();
    expect(findRepeatedQuestionAfterAnswer({ priorTeacherReply: null, learnerReply: '答案', currentReply: '问句？' })).toBeNull();
  });
});
