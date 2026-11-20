/**
 * Phase 2：澄清契约门控的响应改写。
 *
 * 钉死：
 * - 开关关闭时零行为变化（返回原对象）；
 * - 开关开启且契约拦截时，stage→understanding、confirmedProposal→null、reply→澄清提问；
 * - runtimeEnvelope.phase / nextState.stage / artifact.confirmedProposal 同步改写，
 *   防止持久化层把 proposing 又写回去；
 * - 契约允许提案时不动响应。
 */
import {
  applyClarificationGateToResponse,
  enforceClarificationGate,
  type ClarificationGateBlockedInfo,
} from '../goal-clarification-gate';

const clarification = {
  core: { question: '学习科学与 CLT 是包含还是冲突', evidence: ['和 clt 之间关系'] },
  baseline: {
    known: ['用户主动使用 CLT 缩写'],
    unknown: ['是否读过样例效应'],
    misconceptions: [],
    evidence: ['用户自然说出 CLT'],
  },
  stopping: {
    kind: 'explain',
    scope: 'class',
    evidence: 'platform',
    statement: '能解释两者关系并把新案例放进框架',
  },
  constraints: { timePerSessionMin: 25 },
  assumptions: [],
  blockingNeed: 'none',
  unknowns: [
    {
      id: 'u2',
      question: '你读过 Sweller 的样例效应/元素交互吗？',
      planImpact: 'first-station',
      discriminates: ['只听过：从实验讲起', '读过：直接进争论'],
    },
  ],
};

const makeResponse = () => ({
  userVisible: '给你两站的起步版：第一站从样例效应切入……',
  internal: {
    core: { stage: 'proposing', confidence: 0.8, isCompleted: false },
    ext: {
      goalConversation: {
        understanding: { surface_goal: '学习科学' },
        nextQuestions: [],
        quickReplies: [{ text: '确认' }],
        collected: {},
        confirmedProposal: {
          learning_direction: '从样例效应切入',
          first_deliverable: '能解释 CLT 关系',
          key_stages: ['样例效应', '2006 争论'],
          out_of_scope: ['完整学科版图'],
        },
        clarification: JSON.parse(JSON.stringify(clarification)),
        nextAction: 'propose',
      },
    },
  },
  runtimeEnvelope: {
    artifact: { reply: '给你两站的起步版', confirmedProposal: { learning_direction: 'x' }, nextQuestions: [] },
    businessState: { domain: 'goal', phase: 'proposing', status: 'succeeded', isTerminal: false, nextAction: 'confirm' },
    contextUpdate: {
      mode: 'state-refresh',
      stateOwner: 'platform',
      nextState: { stage: 'proposing', confirmedProposal: { learning_direction: 'x' }, understanding: {} },
    },
  },
});

describe('goal-clarification-gate · 响应改写', () => {
  it('开关关闭 → 返回原对象（回滚安全）', () => {
    const response = makeResponse();
    expect(applyClarificationGateToResponse(response, {
      conversationId: 'gc-1',
      enabled: false,
    })).toBe(response);
  });

  it('契约拦截 → stage/proposal/reply/runtimeEnvelope 全部改写', () => {
    const response = makeResponse();
    const blocked: ClarificationGateBlockedInfo[] = [];
    const result = applyClarificationGateToResponse(response, {
      conversationId: 'gc-1',
      enabled: true,
      onBlocked: (info) => blocked.push(info),
    });

    expect(result).not.toBe(response);
    expect(result.userVisible).toContain('样例效应');
    expect(result.internal.core.stage).toBe('understanding');
    expect(result.internal.ext.goalConversation.confirmedProposal).toBeNull();
    expect(result.internal.ext.goalConversation.nextAction).toBe('ask');
    expect(result.internal.ext.goalConversation.quickReplies).toEqual([]);
    expect(result.runtimeEnvelope.businessState.phase).toBe('understanding');
    expect(result.runtimeEnvelope.businessState.nextAction).toBe('ask');
    expect(result.runtimeEnvelope.artifact.confirmedProposal).toBeNull();
    expect(result.runtimeEnvelope.contextUpdate.nextState.stage).toBe('understanding');
    expect(result.runtimeEnvelope.contextUpdate.nextState.confirmedProposal).toBeNull();
    expect(blocked).toHaveLength(1);
    expect(blocked[0].blocking).toContain('unknowns.first-station');
  });

  it('契约允许提案 → 原样返回', () => {
    const response = makeResponse();
    response.internal.ext.goalConversation.clarification.unknowns = [];
    response.internal.ext.goalConversation.clarification.baseline.unknown = [];
    expect(applyClarificationGateToResponse(response, {
      conversationId: 'gc-2',
      enabled: true,
    })).toBe(response);
  });

  it('没有 clarification → 原样返回', () => {
    const response = makeResponse();
    delete (response.internal.ext.goalConversation as { clarification?: unknown }).clarification;
    expect(applyClarificationGateToResponse(response, {
      conversationId: 'gc-3',
      enabled: true,
    })).toBe(response);
  });

  it('enforceClarificationGate 默认开启，GOAL_CLARIFICATION_ENFORCE=0 才关闭', () => {
    const response = makeResponse();
    expect(enforceClarificationGate(response, {
      conversationId: 'gc-4',
      env: { GOAL_CLARIFICATION_ENFORCE: '0' } as NodeJS.ProcessEnv,
    })).toBe(response);
    expect(enforceClarificationGate(makeResponse(), {
      conversationId: 'gc-4',
      env: {} as NodeJS.ProcessEnv,
    })).not.toBe(response);
    expect(enforceClarificationGate(makeResponse(), {
      conversationId: 'gc-4',
      env: { GOAL_CLARIFICATION_ENFORCE: '1' } as NodeJS.ProcessEnv,
    })).not.toBe(response);
  });

  /**
   * 用户真实案例（设计稿附录 B）：CLT 第二轮。
   * 旧行为：模型直接 proposing，编出「学习法广告」式交付物。
   * 新行为（默认配置，不设任何 env）：提案必须被拦下，改成问 u2。
   */
  it('CLT 案例：默认配置下走澄清而不是提案', () => {
    const previous = process.env.GOAL_CLARIFICATION_ENFORCE;
    delete process.env.GOAL_CLARIFICATION_ENFORCE;
    try {
      const clt = {
        core: {
          question: '学习科学与 CLT 是包含关系还是冲突关系，边界在哪',
          evidence: ['和 clt 之间关系'],
        },
        baseline: {
          known: ['用户主动使用 CLT 缩写'],
          unknown: ['是否读过样例效应/元素交互', '关注学科史还是教学应用'],
          misconceptions: [],
          evidence: ['用户自然说出 CLT，说明不是零基础'],
        },
        stopping: {
          kind: 'explain',
          scope: 'class',
          evidence: 'platform',
          statement: '能解释两者的关系，并把一个新案例放进这个框架',
        },
        constraints: {},
        assumptions: [],
        blockingNeed: 'none',
        unknowns: [{
          id: 'u2',
          question: '你读过 Sweller 的样例效应/元素交互吗？',
          planImpact: 'first-station',
          discriminates: [
            '只听过名字：第一站从样例效应实验建立直觉',
            '读过：第一站直接进入 2006 年那场争论，跳过基础',
          ],
        }],
      };
      const response = makeResponse();
      response.userVisible = '给你一条两周路径：第一站做一份学习法广告……';
      response.internal.ext.goalConversation.clarification = clt;
      response.internal.ext.goalConversation.confirmedProposal = {
        learning_direction: '学习法广告',
        first_deliverable: '发一条学习法广告',
        key_stages: ['写文案', '投放'],
        out_of_scope: [],
      } as never;

      const blocked: ClarificationGateBlockedInfo[] = [];
      const result = enforceClarificationGate(response, {
        conversationId: 'gc-clt',
        onBlocked: (info) => blocked.push(info),
      });

      expect(result.internal.core.stage).toBe('understanding');
      expect(result.internal.ext.goalConversation.confirmedProposal).toBeNull();
      expect(result.internal.ext.goalConversation.nextAction).toBe('ask');
      expect(result.userVisible).toContain('样例效应');
      expect(result.userVisible).not.toContain('学习法广告');
      expect(blocked[0].blocking).toContain('unknowns.first-station');
    } finally {
      if (previous === undefined) delete process.env.GOAL_CLARIFICATION_ENFORCE;
      else process.env.GOAL_CLARIFICATION_ENFORCE = previous;
    }
  });
});
