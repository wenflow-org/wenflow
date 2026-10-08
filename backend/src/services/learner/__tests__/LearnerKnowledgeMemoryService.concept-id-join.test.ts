/**
 * 读取侧台账聚合：conceptId 优先归并 + 名字键兜底（kcid 域，2026-10-07）
 *
 * 设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.4 #8「按 conceptId 聚合，label 保留展示」。
 *
 * 锁定四件事：
 * 1. 同一 canonical 身份（conceptId 相等）的不同写法/键空间（痕迹键 vs 任务标签键）收敛为一行
 *    ——名字键不同的两行靠 conceptId 归并（P1-16 名字键做不到的）；
 * 2. 未挂靠行（解析不出身份）按名字键归并——P1-16 旧行为逐字兼容；
 * 3. 不同 conceptId 恒不并（宁缺勿错，不误并）；
 * 4. recurringConfusions / transferSignals 同口径。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: jest.fn(), findFirst: jest.fn() },
    teaching_sessions: { findMany: jest.fn() },
    learner_evidence: { findMany: jest.fn() },
    memory_traces: { findMany: jest.fn() },
    concept_aliases: { findUnique: jest.fn() },
    concepts: { findUnique: jest.fn(), create: jest.fn() },
  },
}));

import { learnerKnowledgeMemoryService } from '../LearnerKnowledgeMemoryService';
import { conceptRegistryService } from '../concept-registry.service';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
  concepts: { create: jest.Mock };
};

const TASK_LABEL = '识别两个元素间的对齐关系';
const TRACE_KEY = '判断两个元素间的对齐关系';

function makePath(taskProps: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    userId: 'u1',
    title: '路径',
    name: '路径',
    status: 'active',
    milestones: [
      {
        id: 'm1',
        stageNumber: 1,
        title: '阶段',
        goal: null,
        status: 'active',
        subtasks: [
          {
            id: 't1',
            order: 1,
            title: '任务',
            status: 'completed',
            completedAt: new Date('2026-10-01T00:00:00.000Z'),
            linkedConceptName: TASK_LABEL,
            coreConcept: null,
            displayLabel: null,
            learningObjectives: null,
            knowledgeType: null,
            cognitiveLevel: null,
            ...taskProps,
          },
        ],
      },
    ],
  };
}

const traceRow = (conceptKey: string, conceptId: string | null, extra: Record<string, unknown> = {}) => ({
  conceptKey,
  label: null,
  conceptId,
  masteryScore: 0.9,
  stability: 'stable',
  intervalFactor: 1,
  lastSeenAt: new Date('2026-10-02T00:00:00.000Z'),
  ...extra,
});

describe('台账聚合：conceptId 优先归并（同一 canonical 的不同写法收敛为一行）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conceptRegistryService.clearCache();
    prisma.learning_paths.findUnique.mockResolvedValue(makePath());
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.learner_evidence.findMany.mockResolvedValue([]);
    // 注册表：任务标签已解析到 cpt_1（如 consolidator 归并后登记的别名）
    prisma.concept_aliases.findUnique.mockImplementation((args: {
      where?: { userId_aliasNorm?: { aliasNorm?: string } };
    }) => {
      const norm = args?.where?.userId_aliasNorm?.aliasNorm;
      return norm === TASK_LABEL ? { conceptId: 'cpt_1' } : null;
    });
  });

  it('痕迹键 + 任务标签键名字不同但 conceptId 相等 → 台账一行（sourceTasks 求并）', async () => {
    prisma.memory_traces.findMany.mockResolvedValue([traceRow(TRACE_KEY, 'cpt_1')]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const ledger = memory.globalBackground.conceptLedger;
    const conceptRows = ledger.filter((item) => item.label === TRACE_KEY || item.label === TASK_LABEL
      || item.conceptKey === TRACE_KEY || item.conceptKey === TASK_LABEL);
    expect(conceptRows).toHaveLength(1);
    // 归并体：集合字段求并——任务侧的 sourceTasks 保留
    expect(conceptRows[0].sourceTasks).toContain('t1');
    expect(prisma.concepts.create).not.toHaveBeenCalled();
  });

  it('recurringConfusions / transferSignals 同口径归并', async () => {
    // 两条痕迹（不同键、同一 canonical）：stable 0.9 → transfer 高就绪；fragile → confusion
    prisma.memory_traces.findMany.mockResolvedValue([
      traceRow('概念丙', 'cpt_3', { masteryScore: 0.3, stability: 'fragile' }),
      traceRow('概念丁', 'cpt_3', { masteryScore: 0.3, stability: 'fragile' }),
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    expect(memory.globalBackground.recurringConfusions.filter((c) => ['概念丙', '概念丁'].includes(c.label))).toHaveLength(1);

    prisma.memory_traces.findMany.mockResolvedValue([
      traceRow('概念戊', 'cpt_4'),
      traceRow('概念己', 'cpt_4'),
    ]);
    const memory2 = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    expect(memory2.globalBackground.transferSignals.filter((s) => ['概念戊', '概念己'].includes(s.label))).toHaveLength(1);
  });
});

describe('台账聚合：未挂靠行按名字键兜底（P1-16 旧行为逐字兼容）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conceptRegistryService.clearCache();
    prisma.learning_paths.findUnique.mockResolvedValue(makePath());
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.concept_aliases.findUnique.mockResolvedValue(null);
  });

  it('全未挂靠：英文 slug 模型行与中文 label 确定性行仍按名字键合并为一行', async () => {
    prisma.memory_traces.findMany.mockResolvedValue([]);
    prisma.learner_evidence.findMany.mockResolvedValue([
      {
        evidenceType: 'session-knowledge-distilled',
        payload: JSON.stringify({
          conceptLedger: [
            {
              conceptKey: 'hand-over-choice',
              label: TASK_LABEL,
              familiarity: 'practiced',
              transferReadiness: 'medium',
              misconceptionRisk: 'high',
              sourcePaths: ['lp_x'],
              sourceTasks: ['st_x'],
              evidenceCount: 40,
            },
          ],
        }),
      },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const ledger = memory.globalBackground.conceptLedger;
    expect(ledger.filter((item) => item.conceptKey === 'hand-over-choice' || item.label === TASK_LABEL)).toHaveLength(1);
  });
});

describe('台账聚合：不误并（宁缺勿错）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conceptRegistryService.clearCache();
    prisma.learning_paths.findUnique.mockResolvedValue(makePath());
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.learner_evidence.findMany.mockResolvedValue([]);
    prisma.concept_aliases.findUnique.mockResolvedValue(null);
  });

  it('不同 conceptId（且名字不同）恒为两行，不因同路径同来源而并', async () => {
    prisma.memory_traces.findMany.mockResolvedValue([
      traceRow('概念甲', 'cpt_a'),
      traceRow('概念乙', 'cpt_b'),
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const ledger = memory.globalBackground.conceptLedger;
    expect(ledger.some((item) => item.conceptKey === '概念甲')).toBe(true);
    expect(ledger.some((item) => item.conceptKey === '概念乙')).toBe(true);
  });
});
