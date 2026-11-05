/**
 * #222：直生成 API 的判定凭证改为读服务端已落库结论，且必须与本次目标绑定。
 *
 * 这里驱动真实解析函数（最小 prisma 桩），锁三条复核实测出过的绕过：
 *  1. 借用自己另一场 judgeable 会话为别的目标建路径 → description 不匹配 ⇒ null；
 *  2. 未完成会话的兜底 responseTriage（learning_path/low）被当凭证 → null；
 *  3. understanding 无任何判定字段、只有默认分诊 → null。
 * 另按 id + userId 收敛他人会话。
 *
 * #227 追加：既有路径（重建/重试）的凭证解析——空壳路径（POST /paths 任意文本）不带
 * 任何 goal 产物，必须解析不出凭证；路径自身带判定产物或关联目标会话时才放行。
 */
const mockGoalFindFirst = jest.fn();
const mockPathFindFirst = jest.fn();
const mockRunCount = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    goal_conversations: { findFirst: (...args: unknown[]) => mockGoalFindFirst(...args) },
    learning_paths: { findFirst: (...args: unknown[]) => mockPathFindFirst(...args) },
    path_generation_runs: { count: (...args: unknown[]) => mockRunCount(...args) },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  normalizeGoalDescription,
  parseGoalTriageEvidence,
  resolveGoalTriageEvidenceForExistingPath,
  resolveGoalTriageEvidenceForPathId,
  resolveGoalTriageEvidenceForUser,
} from '../goal-triage-evidence';
import { MANUAL_PATH_PROMPT_TEMPLATE, evaluateGoalTriageEvidence } from '../path-generation-gate';

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

// 空壳路径：POST /learning/paths 用任意文本建出来的行——status=active、0 里程碑、
// 除显式「无 goal 判定」标记外没有任何 goal 产物（#227 的攻击面第一步）。
function manualShellPath(aiPromptTemplate: string | null = MANUAL_PATH_PROMPT_TEMPLATE) {
  return {
    id: 'lp_shell',
    userId: 'user-1',
    aiPromptTemplate,
    description: WEDDING,
    title: '婚礼弹唱计划',
    name: '婚礼弹唱计划',
  };
}

describe('既有路径的判定凭证（#227）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGoalFindFirst.mockResolvedValue(null);
    mockRunCount.mockResolvedValue(0);
  });

  it('空壳路径（显式「无 goal 判定」标记）→ null，且不再去猜关联会话', async () => {
    const evidence = await resolveGoalTriageEvidenceForExistingPath({ path: manualShellPath() });

    expect(evidence).toBeNull();
    expect(mockGoalFindFirst).not.toHaveBeenCalled();
  });

  it('旧数据空壳路径（aiPromptTemplate=null、无关联会话、无凭证）→ null', async () => {
    const evidence = await resolveGoalTriageEvidenceForExistingPath({ path: manualShellPath(null) });

    expect(evidence).toBeNull();
  });

  it('路径模板自带服务端判定投影（visibleSummary）→ 放行；判定为不可判定时仍拦', async () => {
    const judgeable = await resolveGoalTriageEvidenceForExistingPath({
      path: {
        ...manualShellPath(JSON.stringify({
          goalFinalPayload: {
            rawGoal: '学会 TypeScript',
            visibleSummary: { platformJudgment: 'judgeable_output', skillNature: 'tool_operation' },
          },
        })),
      },
    });
    expect(evaluateGoalTriageEvidence(judgeable).status).toBe('allowed');

    const blocked = await resolveGoalTriageEvidenceForExistingPath({
      path: manualShellPath(JSON.stringify({
        goalFinalPayload: {
          rawGoal: WEDDING,
          visibleSummary: { platformJudgment: 'not_judgeable', skillNature: 'physical_internalized' },
        },
      })),
    });
    expect(evaluateGoalTriageEvidence(blocked).status).toBe('blocked');
  });

  it('路径无判定产物但关联目标会话有判定字段 → 取会话结论（旧数据不误伤）', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      status: 'completed',
      collectedData: JSON.stringify(BLOCKED_COLLECTED),
    }));

    const evidence = await resolveGoalTriageEvidenceForExistingPath({ path: manualShellPath(null) });

    expect(evidence).not.toBeNull();
    expect(evaluateGoalTriageEvidence(evidence).status).toBe('blocked');
  });

  it('关联会话未完成 → 不采信其兜底分诊（只有空壳路径才会走到这一步）', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      status: 'active',
      collectedData: JSON.stringify(NO_VERDICT_COLLECTED),
    }));

    const evidence = await resolveGoalTriageEvidenceForExistingPath({ path: manualShellPath(null) });

    expect(evidence).toBeNull();
  });

  it('本次调用补的服务端凭证：与路径目标一致则放行，借用别的目标 → null', async () => {
    // 路径没有关联目标会话（learningPathId 查询落空），只有本次请求带的凭证可用。
    mockGoalFindFirst.mockImplementation(async (args: { where?: { id?: string } }) => (
      args?.where?.id === 'gc-mine' || args?.where?.id === 'gc-sql'
        ? conversationRow({
          description: args.where.id === 'gc-mine'
            ? WEDDING
            : '下个月要参加公司内部的数据岗转岗机考，是上机写 SQL 的那种',
          collectedData: JSON.stringify(JUDGEABLE_COLLECTED),
        })
        : null
    ));

    const matching = await resolveGoalTriageEvidenceForExistingPath({
      path: manualShellPath(null),
      sourceConversationId: 'gc-mine',
    });
    expect(evaluateGoalTriageEvidence(matching).status).toBe('allowed');

    const borrowed = await resolveGoalTriageEvidenceForExistingPath({
      path: manualShellPath(null),
      sourceConversationId: 'gc-sql',
    });
    expect(borrowed).toBeNull();
  });


  // #227 复核补：模板只有 visibleSummary 壳（无判定字段）、会话 completed 但 understanding
  // 无判定字段、只有 goal 服务每回合写的兜底分诊 → 不得放行（#222 已否决的口子）。
  it('已完成会话 + 无判定字段 + 只有兜底 responseTriage → null（不重开 #222 否决的兜底）', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      status: 'completed',
      collectedData: JSON.stringify(NO_VERDICT_COLLECTED),
    }));

    const evidence = await resolveGoalTriageEvidenceForExistingPath({ path: manualShellPath(null) });

    expect(evidence).toBeNull();
  });

  // #227 复核补：模板里有 visibleSummary 壳（23 键、判定字段全 null）+ 关联会话 completed
  // 但同样无判定字段 → 采信那层服务端投影（旧版本 goal 产物的原结论），不是「没判定」。
  it('旧版本 goal 产物（visibleSummary 无判定字段 + 已完成会话）→ 采信投影，不判无凭证', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      status: 'completed',
      collectedData: JSON.stringify(NO_VERDICT_COLLECTED),
    }));
    const evidence = await resolveGoalTriageEvidenceForExistingPath({
      path: manualShellPath(JSON.stringify({
        goalFinalPayload: {
          rawGoal: '学会写一份能推动决策的产品需求文档',
          visibleSummary: { surfaceGoal: '学会写一份能推动决策的产品需求文档', platformJudgment: null, skillNature: null },
        },
      })),
    });

    expect(evidence).toEqual({ visibleSummary: expect.objectContaining({ surfaceGoal: expect.any(String) }) });
    expect(evaluateGoalTriageEvidence(evidence).status).toBe('allowed');
  });

  it('模板有 visibleSummary 壳但关联会话未完成 → null（投影不单独构成凭证）', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      status: 'active',
      collectedData: JSON.stringify(NO_VERDICT_COLLECTED),
    }));

    const evidence = await resolveGoalTriageEvidenceForExistingPath({
      path: manualShellPath(JSON.stringify({
        goalFinalPayload: {
          rawGoal: '学会写一份能推动决策的产品需求文档',
          visibleSummary: { surfaceGoal: '学会写一份能推动决策的产品需求文档' },
        },
      })),
    });

    expect(evidence).toBeNull();
  });

  // #227 复核补（回归）：存量「服务端生成占位」失败路径（模板只剩 _generation、无 goal 产物、
  // 目标已被改写成学习者口径）必须仍可救援；用户建的空壳（aiGenerated=false / 无 run）不行。
  it('服务端生成的存量占位（aiGenerated + 有 run + 无 goalFinalPayload）→ 救援档放行', async () => {
    mockRunCount.mockResolvedValue(1);
    const evidence = await resolveGoalTriageEvidenceForExistingPath({
      path: {
        ...manualShellPath(JSON.stringify({
          _generation: { core: 'failed', sourceConversationId: 'gc_old' },
        })),
        aiGenerated: true,
      },
    });

    expect(evidence).toEqual({ serverGeneratedPlaceholder: true });
    expect(evaluateGoalTriageEvidence(evidence).status).toBe('allowed');
  });

  it('同形状但 aiGenerated=false（手工空壳）→ 不进救援档，仍 null', async () => {
    mockRunCount.mockResolvedValue(1);
    const evidence = await resolveGoalTriageEvidenceForExistingPath({
      path: {
        ...manualShellPath(JSON.stringify({ _generation: { core: 'failed', sourceConversationId: 'gc_old' } })),
        aiGenerated: false,
      },
    });

    expect(evidence).toBeNull();
  });

  it('aiGenerated=true 但没有任何 run → 不进救援档（用户无法伪造 run，但也不放宽）', async () => {
    mockRunCount.mockResolvedValue(0);
    const evidence = await resolveGoalTriageEvidenceForExistingPath({
      path: {
        ...manualShellPath(JSON.stringify({ _generation: { core: 'failed' } })),
        aiGenerated: true,
      },
    });

    expect(evidence).toBeNull();
  });

  it('_generation.sourceConversationId 也作为来源会话线索（失败占位只有它）', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      status: 'completed',
      collectedData: JSON.stringify(JUDGEABLE_COLLECTED),
    }));

    const evidence = await resolveGoalTriageEvidenceForExistingPath({
      path: manualShellPath(JSON.stringify({ _generation: { core: 'failed', sourceConversationId: 'gc_from_gen' } })),
    });

    expect(evaluateGoalTriageEvidence(evidence).status).toBe('allowed');
    expect(mockGoalFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'gc_from_gen', userId: 'user-1' },
    }));
  });

  it('pathId 入口按 id + userId 收敛：路径不属于该用户 → null（不泄露存在性）', async () => {
    mockPathFindFirst.mockResolvedValue(null);

    const evidence = await resolveGoalTriageEvidenceForPathId({
      pathId: 'lp-someone-else',
      userId: 'user-1',
    });

    expect(evidence).toBeNull();
    expect(mockPathFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lp-someone-else', userId: 'user-1' },
    }));
  });

  it('pathId 入口：路径自带判定产物时走同一套解析（coordinator 闸门用）', async () => {
    mockPathFindFirst.mockResolvedValue({
      id: 'lp_goal',
      userId: 'user-1',
      aiPromptTemplate: JSON.stringify({
        goalFinalPayload: {
          rawGoal: '学会 TypeScript',
          visibleSummary: { platformJudgment: 'judgeable_output' },
        },
      }),
      description: 'TypeScript 学习',
      title: 'TypeScript 学习',
      name: 'TypeScript 学习',
    });

    const evidence = await resolveGoalTriageEvidenceForPathId({
      pathId: 'lp_goal',
      userId: 'user-1',
    });

    expect(evaluateGoalTriageEvidence(evidence).status).toBe('allowed');
  });
});
