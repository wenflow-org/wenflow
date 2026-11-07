/**
 * 模型结构化确认意图（confirmIntent）的解析接线（2026-11-07 切片）：
 * 原始模型 JSON 的 state.confirmIntent → 归一化结果 internal.core.confirmIntent。
 *
 * Hidden 布尔、可缺省：仅当为显式布尔时才写入 internal.core；缺省 / 非布尔一律不写键
 * （服务侧 extractConfirmIntent 只认 === true，拿不准不得猜）。
 */
import { parseGoalConversationResponse } from '../index';

function content(confirmIntent?: unknown): string {
  return JSON.stringify({
    reply: '这版方向就定住了，你点确认我就开始排路径。',
    state: {
      stage: 'proposing',
      confidence: 0.85,
      done: false,
      ...(confirmIntent !== undefined ? { confirmIntent } : {}),
    },
    understanding: {
      surface_goal: '学习最新的 ai 教育知识',
      real_problem: '看过文章听过说法但不成体系，想系统串起发展演变脉络',
      available_resources: { time_horizon: '有空就看' },
      success_criteria: { observable_result: '看得懂门道的判断力' },
    },
    nextQuestions: [],
    quickReplies: [],
    confirmedProposal: {
      learning_direction: '近期案例切入 + 演变脉络 + 教育理论经纬',
      key_stages: ['近期案例', '演变脉络'],
      first_deliverable: '看到一条 AI 教育新闻能说出底层技术与站不住的承诺',
      out_of_scope: [],
    },
  });
}

describe('parseGoalConversationResponse → internal.core.confirmIntent', () => {
  it('state.confirmIntent=true 透传到 internal.core.confirmIntent（服务侧据此推进）', () => {
    const result = parseGoalConversationResponse(content(true));
    expect(result.internal.core.confirmIntent).toBe(true);
  });

  it('state.confirmIntent=false 透传（不推进，但字段存在）', () => {
    const result = parseGoalConversationResponse(content(false));
    expect(result.internal.core.confirmIntent).toBe(false);
  });

  it('state.confirmIntent 缺省 → internal.core 不带该键（拿不准不得猜）', () => {
    const result = parseGoalConversationResponse(content());
    expect('confirmIntent' in result.internal.core).toBe(false);
  });

  it('state.confirmIntent 非布尔（如字符串）→ 不落键，避免被当成 true', () => {
    const result = parseGoalConversationResponse(content('true'));
    expect('confirmIntent' in result.internal.core).toBe(false);
  });
});
