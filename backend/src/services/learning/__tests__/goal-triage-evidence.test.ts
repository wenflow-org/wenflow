/**
 * #222：直生成 API 的判定凭证改为读服务端已落库结论，且必须与本次目标绑定。
 *
 * 这里驱动真实解析函数（最小 prisma 桩），锁三条复核实测出过的绕过：
 *  1. 借用自己另一场 judgeable 会话为别的目标建路径 → description 不匹配 ⇒ null；
 *  2. 未完成会话的兜底 responseTriage（learning_path/low）被当凭证 → null；
 *  3. understanding 无任何判定字段、只有默认分诊 → null。
 * 另按 id + userId 收敛他人会话。
 */
const mockGoalFindFirst = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    goal_conversations: { findFirst: (...args: unknown[]) => mockGoalFindFirst(...args) },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  normalizeGoalDescription,
  parseGoalTriageEvidence,
  resolveGoalTriageEvidenceForUser,
} from '../goal-triage-evidence';
import { evaluateGoalTriageEvidence } from '../path-generation-gate';

const WEDDING =
  '我今年 28 岁，吉他完全零基础。三个月后好朋友结婚，我想在婚礼上自弹自唱一首民谣。连琴都还没有，谱也不识。每天能练 40 分钟。帮我做一个计划。';

const BLOCKED_COLLECTED = {
  understanding: {
    surface_goal: '三个月后在婚礼上自弹自唱一首民谣',
    platform_judgment: 'not_judgeable',
    skill_nature: 'physical_internalized',
  },
  responseTriage: { mode: 'referral', confidence: 'high', reasons: ['平台不可判定'] },
};

const JUDGEABLE_COLLECTED = {
  understanding: {
    surface_goal: '通过公司内部的数据岗转岗机考（上机写 SQL）',
    platform_judgment: 'judgeable_output',
    skill_nature: 'tool_operation',
    primary_block_type: 'capability',
  },
  responseTriage: { mode: 'learning_path', confidence: 'high', reasons: ['阻塞类型为 capability'] },
};

/** 未完成会话：goal 服务每回合无条件写兜底分诊，understanding 里没有判定字段。 */
const NO_VERDICT_COLLECTED = {
  understanding: {
    current_baseline: '只会 Excel 透视表',
    available_resources: '每天 40 分钟',
    pain_points: ['不识谱'],
  },
  responseTriage: { mode: 'learning_path', confidence: 'low', reasons: ['缺少阻塞类型标注，默认按能力缺口处理'] },
};

function conversationRow(overrides: {
  description?: string | null;
  status?: string;
  collectedData?: string;
}) {
  return {
    description: overrides.description === undefined ? WEDDING : overrides.description,
    status: overrides.status ?? 'completed',
    collectedData: overrides.collectedData ?? JSON.stringify(BLOCKED_COLLECTED),
  };
}

describe('goal-triage-evidence（#222）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('description 归一：折叠空白后比较', () => {
    expect(normalizeGoalDescription('  三个月后\n在婚礼上  自弹自唱 ')).toBe('三个月后 在婚礼上 自弹自唱');
    expect(normalizeGoalDescription(null)).toBe('');
  });

  it('已完成 + 目标一致 + 有判定字段 → 返回该会话的结论，闸门拦硬阻断', () => {
    const evidence = parseGoalTriageEvidence(JSON.stringify(BLOCKED_COLLECTED));

    expect(evidence).toEqual({
      understanding: BLOCKED_COLLECTED.understanding,
      responseTriage: BLOCKED_COLLECTED.responseTriage,
    });
    expect(evaluateGoalTriageEvidence(evidence).status).toBe('blocked');
  });

  it('understanding 无任何判定字段、只有兜底分诊 → null（未得出结论不放行）', () => {
    expect(parseGoalTriageEvidence(JSON.stringify(NO_VERDICT_COLLECTED))).toBeNull();
  });

  it('JSON 损坏 / 非对象 → null', () => {
    expect(parseGoalTriageEvidence('{not json')).toBeNull();
    expect(parseGoalTriageEvidence(null)).toBeNull();
    expect(parseGoalTriageEvidence(undefined)).toBeNull();
  });

  it('会话不存在/不属于该用户 → null（查询按 id + userId 收敛）', async () => {
    mockGoalFindFirst.mockResolvedValue(null);

    const evidence = await resolveGoalTriageEvidenceForUser({
      conversationId: 'gc-other-user',
      userId: 'user-1',
      description: WEDDING,
    });

    expect(evidence).toBeNull();
    expect(mockGoalFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'gc-other-user', userId: 'user-1' },
    }));
  });

  it('借用自己另一场 judgeable 会话为别的目标建路径 → null（description 不匹配）', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      description: '下个月要参加公司内部的数据岗转岗机考，是上机写 SQL 的那种',
      collectedData: JSON.stringify(JUDGEABLE_COLLECTED),
    }));

    const evidence = await resolveGoalTriageEvidenceForUser({
      conversationId: 'gc_1793731239447_vo6ccdp',
      userId: 'user-1',
      description: WEDDING,
    });

    expect(evidence).toBeNull();
  });

  it('目标一致的 judgeable 会话 → 返回凭证且闸门放行（诚实链路不误伤）', async () => {
    const sqlGoal = '下个月要参加公司内部的数据岗转岗机考，是上机写 SQL 的那种';
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      description: sqlGoal,
      collectedData: JSON.stringify(JUDGEABLE_COLLECTED),
    }));

    const evidence = await resolveGoalTriageEvidenceForUser({
      conversationId: 'gc_1793731239447_vo6ccdp',
      userId: 'user-1',
      description: `  ${sqlGoal}  `,
    });

    expect(evidence).not.toBeNull();
    expect(evaluateGoalTriageEvidence(evidence).status).toBe('allowed');
  });

  it('未完成会话即使有兜底分诊 → null（stage=understanding 不得被读成可判定）', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      status: 'active',
      collectedData: JSON.stringify(NO_VERDICT_COLLECTED),
    }));

    const evidence = await resolveGoalTriageEvidenceForUser({
      conversationId: 'gc_1793731931541_qrh8c7q',
      userId: 'user-1',
      description: WEDDING,
    });

    expect(evidence).toBeNull();
  });
});
