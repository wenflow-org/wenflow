/**
 * goal → path 请求装配的生产者接线（审计 P0 §1.1）。
 *
 * `buildGoalPathRequest` 是私有方法，但它是唯一把 goal 层产出物装进 `GoalPathRequest`
 * 的地方——前置探测结果此前就在这里被漏掉。这里直接驱动真实方法（运行时私有仅编译期约束），
 * 避免「规则说了但载荷没有」这类跨层断链只能靠真机跑到。
 */
import goalConversationService from '../goal-conversation.service';

// 本用例只关心 understanding → 请求的透传；handoff 抽取读路由配置，与断言无关且会刷 warn。
jest.mock('../../field-dispatcher', () => ({
  assembleGoalHandoff: jest.fn(async () => ({ fields: {}, skipped: [] })),
}));

/**
 * `buildGoalPathRequest` 是私有方法（运行时无私有概念，仅编译期约束）。
 * 用最小结构类型声明它的签名，避免在断言处散落 `as any`。
 */
interface GoalPathRequestLike {
  rawGoal?: string;
  prerequisiteCheckResults?: unknown;
}
const buildGoalPathRequest = (
  goalConversationService as unknown as {
    buildGoalPathRequest: (conversation: unknown, aiResponse: unknown) => Promise<GoalPathRequestLike>;
  }
).buildGoalPathRequest.bind(goalConversationService);

const PROBES = [
  { probeId: 'probe-1', targetConcept: '问题结构识别', userAnswer: 'B', isCorrect: false },
];

function makeConversation(understanding: Record<string, unknown>) {
  return {
    id: 'conv-test-1',
    userId: 'user-test-1',
    description: '想学会向上汇报',
    learningPathId: null,
    collectedData: JSON.stringify({
      messages: [],
      understanding,
      collected: {},
      confirmedProposal: null,
    }),
  };
}

function makeAiResponse(understanding: Record<string, unknown>) {
  return {
    userVisible: '好的，我帮你规划一下。',
    internal: {
      core: { stage: 'completed', confidence: 0.95, isCompleted: true },
      ext: { goalConversation: { understanding, nextQuestions: [], collected: {} } },
    },
  };
}

describe('buildGoalPathRequest · 前置探测结果透传（P0 §1.1）', () => {
  it('understanding 含探测结果 → 请求带 prerequisiteCheckResults', async () => {
    const understanding = { realProblem: '报告逻辑乱', prerequisiteCheckResults: PROBES };
    const request = await buildGoalPathRequest(
      makeConversation(understanding),
      makeAiResponse(understanding),
    );

    expect(request.prerequisiteCheckResults).toEqual(PROBES);
    expect(request.rawGoal).toBe('想学会向上汇报');
  });

  it('understanding 无探测结果 → 显式 null（下游按「无探测」处理）', async () => {
    const understanding = { realProblem: '报告逻辑乱' };
    const request = await buildGoalPathRequest(
      makeConversation(understanding),
      makeAiResponse(understanding),
    );

    expect(request.prerequisiteCheckResults).toBeNull();
  });

  // 取「当轮 understanding 优先」这一真实语义：getGoalExt 对缺失 understanding 返回 `{}`，
  // 而 `{}` 是 truthy ⇒ `goalExt.understanding || data.understanding` 的回落分支实际不可达。
  // 因此探测结果以**当轮**为准，不回落到会话持久化（两轮探测结果不会互串）。
  it('当轮 understanding 优先于会话持久化（探测结果不串轮）', async () => {
    const persisted = [{ probeId: 'probe-old', userAnswer: 'A', isCorrect: true }];
    const current = [{ probeId: 'probe-new', userAnswer: 'C', isCorrect: false }];

    const request = await buildGoalPathRequest(
      makeConversation({ prerequisiteCheckResults: persisted }),
      makeAiResponse({ prerequisiteCheckResults: current }),
    );

    expect(request.prerequisiteCheckResults).toEqual(current);
  });
});
