/**
 * #162：proposing 门禁必须校验**提案本身**，不只是 understanding 的硬必填字段。
 *
 * 病灶：routing 表加载成功后，`hasThinProposalPayload` 只看 hard-required 的 4 个
 * understanding 字段；`promptRole: proposal-output` 的 confirmedProposal.* 只被用于渲染
 * supplement，从无门禁消费。于是「理解够了但模型没给提案」照样停在 proposing，用户点确认
 * 后生成一条 confirmedProposal=null 的路径。
 *
 * 本测试的行清单**从真实声明源**（prompts/orchestration/goal.yaml，经 field-routing 解析器）
 * 取得，而不是手抄一份——声明里把某个 proposal-output 字段改回软字段时这里会跟着变。
 */
import { loadOrchestrationFiles } from '../../../services/field-routing/orchestration-file';
import { applyGoalGateRoutingRows, parseGoalConversationResponse } from '../index';

function goalConversationRows(): Array<{ fieldId: string; promptRole: string }> {
  const goal = loadOrchestrationFiles().find((stage) => stage.stage === 'goal');
  if (!goal) throw new Error('goal 编排文件缺失');
  const roleByField = new Map(goal.fields.map((field) => [field.fieldId, field.promptRole]));
  return goal.routings
    .filter((routing) => routing.agentId === 'skill:goal-conversation')
    .map((routing) => ({ fieldId: routing.fieldId, promptRole: roleByField.get(routing.fieldId) ?? '' }));
}

const rows = goalConversationRows();
const proposalOutputIds = rows.filter((row) => row.promptRole === 'proposal-output').map((row) => row.fieldId);

// understanding 硬必填齐全（surface_goal / real_problem / time_budget / observable_result）
const COMPLETE_UNDERSTANDING = {
  surface_goal: '学会用 Python 自动合并三个平台的订单表',
  real_problem: '每周手工合并两个多小时且容易出错',
  available_resources: { time_horizon: '一个月', time_budget: '每天 1 小时' },
  success_criteria: { observable_result: '能自己独立跑通一次周报合并' },
};

const COMPLETE_PROPOSAL = {
  learning_direction: '从明细合并到汇总报告的自动化',
  first_deliverable: '一张能交付的周报',
  key_stages: ['字段对齐', '合并去重', '分组汇总'],
  out_of_scope: [],
  scope_size: '中等偏小：核心是合并与汇总两个能力面',
};

function proposingContent(overrides: { understanding?: any; confirmedProposal?: any } = {}): string {
  const payload: Record<string, unknown> = {
    reply: '这一版先聚焦两段：先把三张表对齐字段合成一张明细，再按商品和日期汇总出销售额。',
    state: { stage: 'proposing', confidence: 0.85, done: false },
    understanding: overrides.understanding ?? COMPLETE_UNDERSTANDING,
    nextQuestions: [],
  };
  if ('confirmedProposal' in overrides) payload.confirmedProposal = overrides.confirmedProposal;
  return JSON.stringify(payload);
}

describe('#162 proposing 门禁：声明源里确实有 proposal-output 行', () => {
  it('goal.yaml 的 proposal-output 行含 learning_direction / first_deliverable / key_stages', () => {
    expect(proposalOutputIds).toEqual(expect.arrayContaining([
      'confirmedProposal.learning_direction',
      'confirmedProposal.first_deliverable',
      'confirmedProposal.key_stages',
    ]));
  });
});

describe('#162 proposing 门禁：提案为空不得进入 proposing', () => {
  beforeEach(() => applyGoalGateRoutingRows(rows));

  it('硬字段齐、confirmedProposal 缺席 → 压回 understanding（修复前停在 proposing）', () => {
    const parsed = parseGoalConversationResponse(proposingContent());
    expect(parsed.internal.core.stage).toBe('understanding');
    expect(parsed.internal.core.isCompleted).toBe(false);
  });

  it('硬字段齐、confirmedProposal 为空对象 → 压回 understanding', () => {
    const parsed = parseGoalConversationResponse(proposingContent({ confirmedProposal: {} }));
    expect(parsed.internal.core.stage).toBe('understanding');
  });

  it('提案齐备 → 停在 proposing', () => {
    const parsed = parseGoalConversationResponse(proposingContent({ confirmedProposal: COMPLETE_PROPOSAL }));
    expect(parsed.internal.core.stage).toBe('proposing');
  });

  it('提案只有 1 个阶段（key_stages 不足 2）→ 压回 understanding', () => {
    const parsed = parseGoalConversationResponse(proposingContent({
      confirmedProposal: { ...COMPLETE_PROPOSAL, key_stages: ['字段对齐'] },
    }));
    expect(parsed.internal.core.stage).toBe('understanding');
  });

  it('提案有方向与交付物、缺 out_of_scope（声明里的必填项）→ 压回 understanding', () => {
    const parsed = parseGoalConversationResponse(proposingContent({
      confirmedProposal: {
        learning_direction: '先合表再汇总',
        first_deliverable: '一张周报',
        key_stages: ['合表', '汇总'],
      },
    }));
    expect(parsed.internal.core.stage).toBe('understanding');
  });

  it('understanding 硬字段缺失时照旧压回（原门禁不回退）', () => {
    const parsed = parseGoalConversationResponse(proposingContent({
      understanding: { surface_goal: '想学点东西', real_problem: '想学点东西' },
      confirmedProposal: COMPLETE_PROPOSAL,
    }));
    expect(parsed.internal.core.stage).toBe('understanding');
  });

  // 跨轮语义（「缺席=不变」）：上一轮已经产出的提案，本轮模型没再复述时不能算「提案为空」，
  // 否则 delta 模式下每个不复述提案的回合都会被压回 understanding（比原缺陷更频繁的回退）。
  it('上一轮已有提案、本轮未复述 → 仍停在 proposing（不误判提案为空）', () => {
    const parsed = parseGoalConversationResponse(
      proposingContent(),
      COMPLETE_UNDERSTANDING,
      { previousState: { stage: 'proposing', confirmedProposal: COMPLETE_PROPOSAL } } as any
    );
    expect(parsed.internal.core.stage).toBe('proposing');
  });

  it('上一轮提案也是空的 → 仍压回（跨轮回填不放宽门禁）', () => {
    const parsed = parseGoalConversationResponse(
      proposingContent(),
      COMPLETE_UNDERSTANDING,
      { previousState: { stage: 'proposing', confirmedProposal: null } } as any
    );
    expect(parsed.internal.core.stage).toBe('understanding');
  });
});
