import { mergeStateDelta } from '../goal-conversation/delta-merge';
import { validateGoalConversationStructuredOutput } from '../goal-conversation/structured-validator';

describe('delta-merge：mergeStateDelta（§5.4 缺席=不变 / null=清空 / 输出=覆盖）', () => {
  const previous = {
    surface_goal: '学 Python',
    motivation: '转行',
    available_resources: { time_horizon: '1个月', time_budget: '每周5小时' },
    constraints_and_boundaries: ['不加班'],
  };

  it('缺席字段保持不变', () => {
    const merged = mergeStateDelta(previous, { motivation: '升职加薪' });
    expect(merged).toEqual({
      surface_goal: '学 Python',
      motivation: '升职加薪',
      available_resources: { time_horizon: '1个月', time_budget: '每周5小时' },
      constraints_and_boundaries: ['不加班'],
    });
  });

  it('null 清空对应键', () => {
    const merged = mergeStateDelta(previous, { motivation: null, surface_goal: '改学 Java' });
    expect(merged).toEqual({
      surface_goal: '改学 Java',
      available_resources: { time_horizon: '1个月', time_budget: '每周5小时' },
      constraints_and_boundaries: ['不加班'],
    });
    expect(merged).not.toHaveProperty('motivation');
  });

  it('嵌套对象深合并，不丢兄弟键', () => {
    const merged = mergeStateDelta(previous, { available_resources: { time_budget: '每周8小时' } });
    expect((merged as any).available_resources).toEqual({ time_horizon: '1个月', time_budget: '每周8小时' });
  });

  it('数组整体替换而非追加', () => {
    const merged = mergeStateDelta(previous, { constraints_and_boundaries: ['不熬夜', '不加班'] });
    expect((merged as any).constraints_and_boundaries).toEqual(['不熬夜', '不加班']);
  });

  it('delta 缺席/为 null 时返回 previous 副本（不共享引用）', () => {
    const a = mergeStateDelta(previous, undefined);
    const b = mergeStateDelta(previous, null);
    expect(a).toEqual(previous);
    expect(b).toEqual(previous);
    expect(a).not.toBe(previous);
  });

  it('嵌套 null 清空只删子键', () => {
    const merged = mergeStateDelta(previous, { available_resources: { time_horizon: null } });
    expect((merged as any).available_resources).toEqual({ time_budget: '每周5小时' });
  });
});

describe('structured-validator：Delta 模式', () => {
  const fullOutput = JSON.stringify({
    reply: '好的',
    state: { stage: 'understanding', confidence: 0.3, done: false },
    understanding: { surface_goal: '学 Python' },
    nextQuestions: ['问题一'],
  });

  const deltaOutput = JSON.stringify({
    reply: '收到',
    nextQuestions: ['问题二'],
    understanding: { motivation: '转行' },
  });

  const deltaNoUnderstanding = JSON.stringify({
    reply: '嗯',
    nextQuestions: [],
  });

  it('非 Delta 模式：完整输出通过，缺 state/understanding 拒绝', () => {
    expect(validateGoalConversationStructuredOutput(fullOutput).valid).toBe(true);
    const missing = validateGoalConversationStructuredOutput(deltaNoUnderstanding);
    expect(missing.valid).toBe(false);
    expect(missing.failureType).toBe('missing_required_fields');
  });

  it('Delta 模式：state/understanding 缺席合法（缺席=不变）', () => {
    expect(validateGoalConversationStructuredOutput(deltaOutput, { deltaMode: true }).valid).toBe(true);
    expect(validateGoalConversationStructuredOutput(deltaNoUnderstanding, { deltaMode: true }).valid).toBe(true);
  });

  it('Delta 模式：reply 仍必出', () => {
    const noReply = JSON.stringify({ nextQuestions: [], understanding: { motivation: 'x' } });
    const result = validateGoalConversationStructuredOutput(noReply, { deltaMode: true });
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain('reply');
  });

  it('Delta 模式：state 存在时按字段出现校验', () => {
    const badStage = JSON.stringify({ reply: '好', nextQuestions: [], state: { stage: 'wild' } });
    expect(validateGoalConversationStructuredOutput(badStage, { deltaMode: true }).valid).toBe(false);

    const onlyConfidence = JSON.stringify({ reply: '好', nextQuestions: [], state: { confidence: 0.6 } });
    expect(validateGoalConversationStructuredOutput(onlyConfidence, { deltaMode: true }).valid).toBe(true);

    const badConfidence = JSON.stringify({ reply: '好', nextQuestions: [], state: { confidence: 'high' } });
    expect(validateGoalConversationStructuredOutput(badConfidence, { deltaMode: true }).valid).toBe(false);
  });
});
