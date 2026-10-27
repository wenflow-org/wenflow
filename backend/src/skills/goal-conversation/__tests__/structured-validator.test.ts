import {
  validateGoalConversationStructuredOutput,
  hasValidStructuredPayload,
} from '../structured-validator';
import { normalizeGoalConversationModelPayload } from '../index';
import { buildCollected } from '../../goal-understanding-composer';

const VALID_UNDERSTANDING = {
  surface_goal: '掌握 React',
  real_problem: '需要做前端项目',
  motivation: '职业转型',
};

function buildValidPayload(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    reply: '这是一条回复',
    state: { stage: 'understanding', confidence: 0.4, done: false },
    understanding: { ...VALID_UNDERSTANDING },
    nextQuestions: ['第一步做什么？'],
    quickReplies: ['继续'],
    ...overrides,
  });
}

function buildStateNestedUnderstanding(overrides: Record<string, any> = {}): string {
  // 模型按输入形状回写：understanding 嵌进 state，无顶层 understanding
  return JSON.stringify({
    reply: '这是一条回复',
    state: {
      stage: 'understanding',
      confidence: 0.4,
      done: false,
      understanding: { ...VALID_UNDERSTANDING },
      nextQuestions: ['第一步做什么？'],
    },
    quickReplies: ['继续'],
    ...overrides,
  });
}

function buildGoalConversationWrapped(overrides: Record<string, any> = {}): string {
  // 旧版 goalConversation 包装
  return JSON.stringify({
    reply: '这是一条回复',
    state: { stage: 'understanding', confidence: 0.4, done: false },
    goalConversation: {
      understanding: { ...VALID_UNDERSTANDING },
      nextQuestions: ['第一步做什么？'],
    },
    ...overrides,
  });
}

describe('validateGoalConversationStructuredOutput', () => {
  test('顶层 understanding 通过', () => {
    const result = validateGoalConversationStructuredOutput(buildValidPayload());
    expect(result.valid).toBe(true);
    expect(result.failureType).toBe('none');
  });

  test('state.understanding hoist 通过（统一协议 v2 止血）', () => {
    const result = validateGoalConversationStructuredOutput(buildStateNestedUnderstanding());
    expect(result.valid).toBe(true);
    expect(result.failureType).toBe('none');
  });

  test('goalConversation 包装层 understanding 通过（旧版兼容）', () => {
    const result = validateGoalConversationStructuredOutput(buildGoalConversationWrapped());
    expect(result.valid).toBe(true);
    expect(result.failureType).toBe('none');
  });

  test('顶层 needsMaterial 允许（goal→path 资料采集缝，hidden 输出）', () => {
    const payload = buildValidPayload({ needsMaterial: { kind: '指南', title: '《3-6 岁儿童学习与发展指南》' } });
    const result = validateGoalConversationStructuredOutput(payload);
    expect(result.valid).toBe(true);
    expect(result.failureType).toBe('none');
  });

  test('understanding 完全缺失 → 失败，violation 提示三个查找位置', () => {
    const payload = JSON.stringify({
      reply: '这是一条回复',
      state: { stage: 'understanding', confidence: 0.4, done: false },
      nextQuestions: ['第一步？'],
    });
    const result = validateGoalConversationStructuredOutput(payload);
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('missing_required_fields');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('understanding');
    expect(result.violations[0]).toContain('顶层');
    expect(result.violations[0]).toContain('goalConversation.understanding');
    expect(result.violations[0]).toContain('state.understanding');
  });

  test('nextQuestions 嵌进 state 通过（state.nextQuestions hoist）', () => {
    const payload = JSON.stringify({
      reply: '这是一条回复',
      state: {
        stage: 'understanding',
        confidence: 0.4,
        done: false,
        understanding: { ...VALID_UNDERSTANDING },
        nextQuestions: ['第一步？'],
      },
    });
    const result = validateGoalConversationStructuredOutput(payload);
    expect(result.valid).toBe(true);
  });

  test('hasValidStructuredPayload 应反映新增 hoist 行为', () => {
    expect(hasValidStructuredPayload(buildStateNestedUnderstanding())).toBe(true);
    expect(hasValidStructuredPayload(buildGoalConversationWrapped())).toBe(true);
    expect(hasValidStructuredPayload(buildValidPayload())).toBe(true);
  });

  test('parser normalization hoists state fields with top-level priority', () => {
    const normalized = normalizeGoalConversationModelPayload({
      understanding: { surface_goal: '顶层目标' },
      nextQuestions: ['顶层问题'],
      state: {
        understanding: { surface_goal: '嵌套目标' },
        nextQuestions: ['嵌套问题'],
        quickReplies: ['嵌套快捷回复'],
      },
      goalConversation: {
        understanding: { surface_goal: '旧包装目标' },
        nextQuestions: ['旧包装问题'],
      },
    });

    expect(normalized.understanding).toEqual({ surface_goal: '顶层目标' });
    expect(normalized.nextQuestions).toEqual(['顶层问题']);
    expect(normalized.quickReplies).toEqual(['嵌套快捷回复']);
  });

  test('parser normalization preserves state-only understanding and questions', () => {
    const normalized = normalizeGoalConversationModelPayload({
      state: {
        understanding: VALID_UNDERSTANDING,
        nextQuestions: ['state 问题'],
      },
    });

    expect(normalized.understanding).toEqual(VALID_UNDERSTANDING);
    expect(normalized.nextQuestions).toEqual(['state 问题']);
  });

  test('collected projection preserves canonical camelCase nextQuestions', () => {
    const collected = buildCollected(VALID_UNDERSTANDING, {
      nextQuestions: ['下一步？'],
    });

    expect(collected.questions_to_ask).toEqual(['下一步？']);
  });

  test('miss reply 仍报错', () => {
    const payload = buildValidPayload({ reply: '' });
    const result = validateGoalConversationStructuredOutput(payload);
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('missing_required_fields');
    expect(result.violations[0]).toContain('reply');
  });

  test('非法 stage 仍报错', () => {
    const payload = buildValidPayload({ state: { stage: 'invalid', confidence: 0.4, done: false } });
    const result = validateGoalConversationStructuredOutput(payload);
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_stage');
  });

  // 审计 P0 §1.2：规则要求维护 state.motivation_signal / state.mi_frames，但字段表未声明，
  // 模型若照输入 shape 写在顶层会被整轮判 invalid_top_level_keys，伴生 hidden 字段直接丢。
  test('顶层 motivation_signal / mi_frames 允许（hidden 动机字段，不再整轮失败）', () => {
    const payload = buildValidPayload({
      motivation_signal: { change_talk_score: 1.5 },
      mi_frames: { GoalFrame: { desire: '想自己带团队' } },
    });
    const result = validateGoalConversationStructuredOutput(payload);
    expect(result.valid).toBe(true);
    expect(result.failureType).toBe('none');
  });

  test('state 下嵌套 motivation_signal / mi_frames 允许（规则里的规范位置）', () => {
    const payload = buildValidPayload({
      state: {
        stage: 'understanding',
        confidence: 0.4,
        done: false,
        motivation_signal: { change_talk_score: -1 },
        mi_frames: { PlanFrame: { commitment: '试试看' } },
      },
    });
    const result = validateGoalConversationStructuredOutput(payload);
    expect(result.valid).toBe(true);
  });

  test('normalize 把 state 下的动机字段展开到顶层（读取路径可达）', () => {
    const normalized = normalizeGoalConversationModelPayload({
      state: {
        stage: 'understanding',
        motivation_signal: { change_talk_score: 2 },
        mi_frames: { GoalFrame: { desire: '独立完成汇报' } },
      },
    });

    expect(normalized.motivation_signal).toEqual({ change_talk_score: 2 });
    expect(normalized.mi_frames).toEqual({ GoalFrame: { desire: '独立完成汇报' } });
  });

  test('放行动机字段后，未声明的顶层字段仍然失败（没有放宽闸门）', () => {
    const payload = buildValidPayload({ totallyUnknownField: 1 });
    const result = validateGoalConversationStructuredOutput(payload);
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_top_level_keys');
    expect(result.violations[0]).toContain('totallyUnknownField');
  });
});

/**
 * R8 时间模型校验（2026-10-27）：只硬校验新权威字段。
 * legacy 算术字段（totalWeeks/estimatedHours/...）非法不阻断（只诊断），
 * 新字段写错会导致下游预算静默走兜底，必须 invalid_goal_payload 触发 retry。
 */
describe('R8 time_dimensions 校验', () => {
  const withTimeDimensions = (timeDimensions: any) =>
    buildValidPayload({
      understanding: { ...VALID_UNDERSTANDING, time_dimensions: timeDimensions },
    });

  test('合法三字段通过', () => {
    const result = validateGoalConversationStructuredOutput(
      withTimeDimensions({
        timeModelVersion: 2,
        sessionsLengthMin: 60,
        objectiveScopeHours: 18,
        deadlineDate: '2027-01-05',
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.failureType).toBe('none');
  });

  test('单数别名 sessionLengthMin 通过（兼容旧拼写）', () => {
    const result = validateGoalConversationStructuredOutput(withTimeDimensions({ sessionLengthMin: 45 }));
    expect(result.valid).toBe(true);
  });

  test('objectiveScopeHours 非数字 → invalid_goal_payload', () => {
    const result = validateGoalConversationStructuredOutput(withTimeDimensions({ objectiveScopeHours: '18' }));
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_goal_payload');
  });

  test('objectiveScopeHours 越界（5000）→ invalid_goal_payload', () => {
    const result = validateGoalConversationStructuredOutput(withTimeDimensions({ objectiveScopeHours: 5000 }));
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_goal_payload');
  });

  test('sessionsLengthMin 越界（0 / 1000）→ invalid_goal_payload', () => {
    expect(validateGoalConversationStructuredOutput(withTimeDimensions({ sessionsLengthMin: 0 })).valid).toBe(false);
    expect(validateGoalConversationStructuredOutput(withTimeDimensions({ sessionsLengthMin: 1000 })).valid).toBe(false);
  });

  test('deadlineDate 非法日历日（2027-02-30）→ invalid_goal_payload', () => {
    const result = validateGoalConversationStructuredOutput(withTimeDimensions({ deadlineDate: '2027-02-30' }));
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_goal_payload');
  });

  test('timeModelVersion 非法（3）→ invalid_goal_payload', () => {
    const result = validateGoalConversationStructuredOutput(withTimeDimensions({ timeModelVersion: 3 }));
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_goal_payload');
  });

  test('time_dimensions 非对象 → invalid_goal_payload', () => {
    const result = validateGoalConversationStructuredOutput(withTimeDimensions('每周5小时'));
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_goal_payload');
  });

  test('旧字段非法不阻断（只诊断，不影响 valid）', () => {
    const result = validateGoalConversationStructuredOutput(
      withTimeDimensions({ estimatedHours: '很多', totalWeeks: -1, sessionsPerWeek: '高频' }),
    );
    expect(result.valid).toBe(true);
  });

  test('delta 模式：state.understanding.time_dimensions 同样校验通过', () => {
    const payload = JSON.stringify({
      reply: '这是一条回复',
      state: {
        stage: 'understanding',
        confidence: 0.4,
        done: false,
        understanding: {
          ...VALID_UNDERSTANDING,
          time_dimensions: { timeModelVersion: 2, objectiveScopeHours: 18, deadlineDate: null },
        },
        nextQuestions: ['下一步？'],
      },
    });
    const result = validateGoalConversationStructuredOutput(payload, { deltaMode: true });
    expect(result.valid).toBe(true);
  });

  test('delta 模式下 state 里的非法 objective 仍然报错', () => {
    const payload = JSON.stringify({
      reply: '这是一条回复',
      state: {
        stage: 'understanding',
        confidence: 0.4,
        done: false,
        understanding: {
          ...VALID_UNDERSTANDING,
          time_dimensions: { objectiveScopeHours: '18' },
        },
        nextQuestions: ['下一步？'],
      },
    });
    const result = validateGoalConversationStructuredOutput(payload, { deltaMode: true });
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_goal_payload');
  });
});
