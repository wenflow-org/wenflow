/**
 * conceptKey 键空间 join（P1-16 修复，2026-10-06 审计 §2.1）
 *
 * 背景：确定性台账的键是**中文 label**（task.linkedConceptName / 会话知识点名），
 * 而 lesson-knowledge-enricher 的模型行自拟 `conceptKey`（实测 67/120 为英文 slug）。
 * 两套键空间按精确 conceptKey 永不 join → 同一概念「确定性一行 + 模型一行」并存，
 * 经 toTeachingProjection 注入课堂 prompt 后模型看到互相矛盾的状态。
 *
 * 本测试锁定：英文 slug 行与中文 label 行在**同一概念**上收敛为一行（label 优先归一化），
 * 且不同概念不会被误并。
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

import { learnerKnowledgeMemoryService, conceptIdentityKey } from '../LearnerKnowledgeMemoryService';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
};

const LABEL = '交出选择权降低开场抵触';
const SLUG = 'hand-over-choice';

const path = {
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
          completedAt: new Date('2026-09-05T00:00:00.000Z'),
          linkedConceptName: LABEL,
          coreConcept: null,
          displayLabel: null,
          learningObjectives: null,
          knowledgeType: null,
          cognitiveLevel: null,
        },
      ],
    },
  ],
};

describe('conceptIdentityKey（label 优先归一化）', () => {
  it('中文 label 优先于英文 slug；label 缺失时回落 conceptKey', () => {
    expect(conceptIdentityKey({ conceptKey: SLUG, label: LABEL })).toBe(LABEL);
    expect(conceptIdentityKey({ conceptKey: SLUG, label: null })).toBe(SLUG);
    expect(conceptIdentityKey({ conceptKey: SLUG, label: '' })).toBe(SLUG);
    expect(conceptIdentityKey({ conceptKey: '', label: '' })).toBeNull();
  });

  it('机械归一化：引号/冒号从句/尾标点不影响身份键', () => {
    expect(conceptIdentityKey({ label: '靠「动作先发生」取胜' })).toBe('靠动作先发生取胜');
    expect(conceptIdentityKey({ label: '离开前翻页立好：动作先于评价' })).toBe('离开前翻页立好');
  });
});

describe('conceptLedger join（英文 slug 与中文 label 同概念合并 · P1-16）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.learning_paths.findUnique.mockResolvedValue(path);
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.memory_traces.findMany.mockResolvedValue([]);
    prisma.concept_aliases.findUnique.mockResolvedValue(null);
  });

  it('同一概念（中文 label + 英文 slug conceptKey）合并为一行，不再双行矛盾', async () => {
    // 模型行：conceptKey 为英文 slug，label 为中文（DB 实存形态）
    prisma.learner_evidence.findMany.mockResolvedValue([
      {
        evidenceType: 'session-knowledge-distilled',
        payload: JSON.stringify({
          conceptLedger: [
            {
              conceptKey: SLUG,
              label: LABEL,
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
    const rows = ledger.filter((item) => item.label === LABEL || item.conceptKey === SLUG || item.conceptKey === LABEL);
    expect(rows).toHaveLength(1);
    // 合并后仍只此一条，且不是「确定性行 + 模型行」并存
    expect(ledger.filter((item) => item.conceptKey === SLUG)).toHaveLength(1);
    expect(ledger.filter((item) => item.conceptKey === LABEL)).toHaveLength(0);
  });

  it('不同概念不会被误并', async () => {
    prisma.learner_evidence.findMany.mockResolvedValue([
      {
        evidenceType: 'session-knowledge-distilled',
        payload: JSON.stringify({
          conceptLedger: [
            { conceptKey: SLUG, label: LABEL, familiarity: 'practiced', transferReadiness: 'medium', misconceptionRisk: 'high', sourcePaths: [], sourceTasks: [], evidenceCount: 1 },
            { conceptKey: 'other-slug', label: '识别父母抵触信号', familiarity: 'understood', transferReadiness: 'high', misconceptionRisk: 'low', sourcePaths: [], sourceTasks: [], evidenceCount: 1 },
          ],
        }),
      },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const ledger = memory.globalBackground.conceptLedger;
    expect(ledger.some((item) => item.label === LABEL)).toBe(true);
    expect(ledger.some((item) => item.label === '识别父母抵触信号')).toBe(true);
  });

  it('transferSignals 同样按 label 归一化 join（同概念只留一条）', async () => {
    prisma.learner_evidence.findMany.mockResolvedValue([
      {
        evidenceType: 'session-knowledge-distilled',
        payload: JSON.stringify({
          conceptLedger: [
            { conceptKey: SLUG, label: LABEL, familiarity: 'practiced', transferReadiness: 'medium', misconceptionRisk: 'high', sourcePaths: [], sourceTasks: [], evidenceCount: 1 },
          ],
          transferSignals: [
            { conceptKey: SLUG, label: LABEL, readiness: 'medium', confidence: 0.7 },
          ],
        }),
      },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const signals = memory.globalBackground.transferSignals;
    expect(signals.filter((item) => item.label === LABEL)).toHaveLength(1);
    expect(signals.filter((item) => item.conceptKey === SLUG)).toHaveLength(1);
  });
});