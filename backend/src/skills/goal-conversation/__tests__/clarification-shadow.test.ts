/**
 * 澄清契约 shadow 透传（2026-11-20 Phase 1）。
 *
 * 钉死的契约：
 * - clarification / nextAction 只透传到 internal.ext.goalConversation，供服务端 shadow 日志读取；
 * - 它们不参与 stage、不参与 confirmedProposal 门禁、不改变 userVisible；
 * - nextAction 非法值直接丢弃，不污染观测。
 */
import { parseGoalConversationResponse } from '../index';

const basePayload = {
  reply: '你直接提到了 CLT，说明对这一支已经有接触了。你读过 Sweller 的样例效应/元素交互吗？',
  state: { stage: 'understanding', confidence: 0.72 },
  understanding: {
    surface_goal: '想了解学习科学和 CLT 的关系',
    intent_type: 'interest',
    entry_state: 'exploratory',
    current_baseline: { level: 'unknown', evidence: '用户未说明是否接触过' },
  },
  nextQuestions: ['你读过 Sweller 的样例效应/元素交互吗？'],
  clarification: {
    core: {
      question: '学习科学与 CLT 是包含关系还是冲突关系，边界在哪',
      evidence: ['和 clt 之间关系'],
    },
    baseline: {
      known: ['用户主动使用 CLT 缩写'],
      unknown: ['是否读过样例效应/元素交互'],
      misconceptions: [],
      evidence: ['用户自然说出 CLT，说明不是零基础'],
    },
    stopping: {
      kind: 'explain',
      scope: 'class',
      evidence: 'platform',
      statement: '能解释两者的关系，并把一个新案例放进这个框架',
    },
    constraints: { timePerSessionMin: 25 },
    assumptions: [],
    blockingNeed: 'none',
    unknowns: [
      {
        id: 'u2',
        question: '你读过 Sweller 的样例效应/元素交互吗？',
        planImpact: 'first-station',
        discriminates: ['只听过名字：从样例效应实验建立直觉', '读过：直接进入 2006 年争论'],
      },
    ],
  },
  nextAction: 'ask',
};

const parse = (payload: Record<string, unknown>) =>
  parseGoalConversationResponse(JSON.stringify(payload));

describe('goal-conversation · 澄清契约 shadow 透传', () => {
  it('clarification / nextAction 原样进入 ext，但不改变 stage 与 userVisible', () => {
    const result = parse(basePayload);
    const ext = result.internal.ext.goalConversation;

    expect(result.internal.core.stage).toBe('understanding');
    expect(ext.clarification).toEqual(basePayload.clarification);
    expect(ext.nextAction).toBe('ask');
    expect(result.userVisible).toContain('CLT');
    expect(ext.confirmedProposal).toBeUndefined();
  });

  it('已有提案的轮次：shadow 字段仍透传，但提案门禁仍按旧规则走', () => {
    const result = parse({
      ...basePayload,
      state: { stage: 'proposing', confidence: 0.8 },
      understanding: {
        ...basePayload.understanding,
        real_problem: '想弄清学习科学与 CLT 是包含还是冲突，边界在哪',
        available_resources: { time_budget: '两次坐学，每次 25 分钟' },
        success_criteria: {
          observable_result: '能解释两者关系，并把一个新案例放进框架',
        },
      },
      confirmedProposal: {
        learning_direction: '从样例效应实验切入',
        first_deliverable: '能解释 CLT 与学习科学的关系',
        key_stages: ['样例效应', '2006 争论'],
        scope_size: '[单点概念] 两站约 1 小时',
        out_of_scope: ['完整学科版图'],
      },
      nextAction: 'propose',
    });
    const ext = result.internal.ext.goalConversation;

    expect(result.internal.core.stage).toBe('proposing');
    expect(ext.confirmedProposal).toBeDefined();
    expect(ext.clarification).toEqual(basePayload.clarification);
    expect(ext.nextAction).toBe('propose');
  });

  it('nextAction 非法值丢弃，不产生脏观测', () => {
    const result = parse({ ...basePayload, nextAction: 'maybe' });
    expect(result.internal.ext.goalConversation.nextAction).toBeUndefined();
  });

  it('模型没产出 clarification 时 ext 形状保持原样（不新增空键）', () => {
    const withoutShadow: Record<string, unknown> = { ...basePayload };
    delete withoutShadow.clarification;
    delete withoutShadow.nextAction;
    const result = parse(withoutShadow);
    const ext = result.internal.ext.goalConversation;
    expect('clarification' in ext).toBe(false);
    expect('nextAction' in ext).toBe(false);
  });

  it('clarification 嵌在 state 下也兼容（模型回写输入 shape 的既有口径）', () => {
    const result = parse({
      ...basePayload,
      clarification: undefined,
      state: {
        stage: 'understanding',
        confidence: 0.72,
        clarification: basePayload.clarification,
        nextAction: 'ask',
      },
    });
    const ext = result.internal.ext.goalConversation;
    expect(ext.clarification).toEqual(basePayload.clarification);
    expect(ext.nextAction).toBe('ask');
  });
});
