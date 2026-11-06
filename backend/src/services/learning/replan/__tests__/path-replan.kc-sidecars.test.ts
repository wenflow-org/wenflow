/**
 * #168 回归：重排（replan）重建任务时必须与生成链同口径补齐任务级数据：
 *   ① subtasks.conceptId（canonical 概念身份，图谱/掌握度 join 的键）；
 *   ② aiPromptTemplate.materialRefs.byTask / misconceptionHints.byTask（按新 subtaskId，
 *      并清掉被删任务的旧键）；
 *   ③ aiPromptTemplate.kcAnnotation（taskKcLinks 绑新 subtaskId、conceptKcs/kcGraph 同包）
 *      + 概念图重物化。
 *
 * 病灶：重建只写 linkedConceptId/Name，teaching 侧 `resolveTaskKcsFromPath` 对新任务恒为空，
 * 资料引用/迷思预判丢失，模板里堆积无主 sidecar 键（旧 subtaskId）。
 */
const mockTx: any = {
  learning_paths: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
  subtasks: { deleteMany: jest.fn(async () => ({})), create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
  milestones: { update: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
  path_generation_runs: { update: jest.fn(async () => ({})) },
};
const mockPrisma = { learning_paths: { findUnique: jest.fn() } };
const mockExecuteSkill = jest.fn();
const mockExecuteSkillWithResult = jest.fn();
const mockResolveMany = jest.fn();
const mockMaterializePathGraph = jest.fn(async () => ({}));

jest.mock('../../../../config/database', () => ({ __esModule: true, default: mockPrisma, prisma: mockPrisma }));
jest.mock('../../../../utils/with-transaction', () => ({
  __esModule: true,
  withTransaction: (cb: (tx: any) => Promise<unknown>) => cb(mockTx),
}));
jest.mock('../../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../../skills', () => ({
  __esModule: true,
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
  executeSkillWithResult: (...args: unknown[]) => mockExecuteSkillWithResult(...args),
}));
jest.mock('../../../../skills/stage-designer', () => ({
  __esModule: true, stageDesignerDefinition: { name: 'stage-designer' },
}));
jest.mock('../../../../skills/kc-mapper', () => ({
  __esModule: true, kcMapperDefinition: { name: 'kc-mapper' },
}));
jest.mock('../../../learner/LearnerSnapshotRefreshService', () => ({
  __esModule: true,
  learnerSnapshotRefreshService: { refresh: jest.fn(async () => ({})) },
}));
jest.mock('../../../learner/LearnerProjectionService', () => ({
  __esModule: true,
  learnerProjectionService: {
    toReplanProjection: jest.fn(() => ({
      path: { currentPosition: { milestoneTitle: '阶段一' } },
      mastery: { stableConcepts: [], fragileConcepts: [], strugglingConcepts: [] },
      risk: { prerequisiteGaps: [] },
    })),
  },
}));
jest.mock('../../../learner/concept-registry.service', () => ({
  __esModule: true,
  conceptRegistryService: { resolveMany: (...args: unknown[]) => mockResolveMany(...args) },
}));
jest.mock('../../../learner/concept-graph.service', () => ({
  __esModule: true,
  conceptGraphService: {
    materializePathGraph: (...args: unknown[]) => (mockMaterializePathGraph as any)(...args),
    RELATION_PREREQUISITE: 'prerequisite',
    RELATION_PART_OF: 'part_of',
  },
}));
jest.mock('../../../learning/generation/run-lifecycle', () => ({
  __esModule: true,
  createAndClaimGenerationRun: jest.fn(async () => ({ id: 'run-1' })),
  startGenerationHeartbeat: jest.fn(() => () => {}),
  updatePathGenerationStatus: jest.fn(async () => {}),
  failGenerationRun: jest.fn(async () => {}),
  assertGenerationRunFence: jest.fn(async () => {}),
  restorePathStatusAfterRunSettled: jest.fn(async () => {}),
  restorePathAfterMutationConflict: jest.fn(async () => {}),
  heartbeatGenerationRun: jest.fn(async () => {}),
}));
jest.mock('../../../../events/outbox.repository', () => ({
  __esModule: true,
  enqueueDomainEvent: jest.fn(async () => {}),
}));
jest.mock('../../path-mutation-safety', () => {
  const actual = jest.requireActual('../../path-mutation-safety');
  return {
    ...actual,
    claimPathReplanSnapshot: jest.fn(async () => {}),
    assertPathMutationSafe: jest.fn(async () => {}),
  };
});
jest.mock('../../path-generation-status', () => {
  const actual = jest.requireActual('../../path-generation-status');
  return { ...actual, assertGenerationRunFence: jest.fn(async () => {}) };
});

import { requestPathReplan } from '../path-replan.service';
import { normalizeConceptKey } from '../../../memory/concept-key';
import { resolveTaskKcsFromPath } from '../../../ai-teaching/teaching-context-knowledge';

const OLD_TEMPLATE = {
  cognitiveDesign: {
    cognitiveDomain: 'bio',
    coreConcepts: [{ id: 'c1', name: '光合作用', role: 'hub' }],
  },
  // 被删任务的旧 sidecar：重排后必须清掉，否则模板里堆积无主键
  materialRefs: { byTask: { old_task: [{ materialId: 'm-old' }] } },
  misconceptionHints: { byTask: { old_task: [{ conceptKey: 'c1', label: '旧迷思' }] } },
  taskAdjustability: { byTask: { old_task: 'core' } },
  kcAnnotation: {
    conceptKcs: [{ kcId: 'kc_old', name: '旧概念' }],
    taskKcLinks: [{ taskId: 'old_task', taskTitle: '旧任务', linkedKCs: ['kc_old'] }],
    kcGraph: { nodes: [{ kcId: 'kc_old' }], edges: [] },
  },
  // 其他阶段的 sidecar：不得被本阶段重排抹掉
  stageDesigns: { 'stage-2': { normalizedOutput: { subtasks: [] } } },
};

function makePath() {
  return {
    id: 'lp1',
    userId: 'u1',
    activeGenerationRunId: null,
    estimatedHours: 10,
    aiPromptTemplate: JSON.stringify(OLD_TEMPLATE),
    milestones: [
      {
        id: 'm1',
        stageNumber: 1,
        title: '阶段一',
        status: 'active',
        coreConceptId: 'c1',
        coreConceptName: '光合作用',
        description: null,
        goal: null,
        estimatedHours: 4,
        subtasks: [{ id: 'old_task', title: '旧任务', status: 'todo', estimatedMinutes: 60, order: 0 }],
      },
    ],
  };
}

function writtenTemplate(): Record<string, any> {
  const calls = mockTx.learning_paths.update.mock.calls as any[];
  return JSON.parse(calls[calls.length - 1][0].data.aiPromptTemplate);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.learning_paths.findUnique.mockResolvedValue(makePath());
  mockTx.learning_paths.findUnique.mockResolvedValue({ aiPromptTemplate: JSON.stringify(OLD_TEMPLATE) });
  mockTx.subtasks.create.mockResolvedValue({});
  mockTx.subtasks.findMany.mockResolvedValue([]);
  mockTx.milestones.findMany.mockResolvedValue([]);
  mockResolveMany.mockResolvedValue(new Map([[normalizeConceptKey('光合作用'), 'kc_photo']]));
  mockMaterializePathGraph.mockResolvedValue({});
  mockExecuteSkill.mockResolvedValue({
    subtasks: [
      {
        title: '新任务一',
        description: '用光合作用解释实验现象',
        type: 'execute',
        estimatedMinutes: 40,
        acceptanceHint: '能写出光合作用方程',
        linkedConcept: 'c1',
        knowledgeType: 'concept',
        cognitiveLevel: 'understand',
        adjustability: 'core',
        materialRefs: [{ materialId: 'm-1', sectionRef: '1.1' }],
        anticipatedMisconceptions: [{ conceptKey: 'c1', label: '把呼吸作用当光合作用', why: '混淆原料' }],
      },
    ],
  });
  mockExecuteSkillWithResult.mockResolvedValue({
    success: true,
    output: {
      conceptKcs: [{ kcId: 'kc_photo', name: '光合作用' }],
      taskKcLinks: [{ taskKey: 'replan-1-1', taskTitle: '新任务一', linkedKCs: ['kc_photo'] }],
      kcGraph: { nodes: [{ kcId: 'kc_photo' }], edges: [{ from: 'kc_photo', to: 'kc_photo', type: 'part_of' }] },
    },
  });
});

describe('#168 replan 重建任务同步 conceptId / sidecar / KC 标注', () => {
  it('新任务写入 conceptId、资料与迷思 sidecar、绑定 subtaskId 的 kcAnnotation，并清掉被删任务旧键', async () => {
    await requestPathReplan({
      pathId: 'lp1',
      userId: 'u1',
      mode: 'overwrite',
      requireConfirmation: false,
      reason: '学不进去',
      triggerSource: 'api',
    } as never);

    // ① canonical conceptId（事务外预解析后写入）
    const createCalls = mockTx.subtasks.create.mock.calls as any[];
    expect(createCalls).toHaveLength(1);
    const created = createCalls[0][0].data;
    expect(created.title).toBe('新任务一');
    expect(created.conceptId).toBe('kc_photo');
    const newId = created.id;

    const template = writtenTemplate();

    // ② 任务级 sidecar：按新 subtaskId 落库，旧键清掉，其他键保留
    expect(template.materialRefs.byTask[newId]).toEqual([{ materialId: 'm-1', sectionRef: '1.1' }]);
    expect(template.materialRefs.byTask.old_task).toBeUndefined();
    expect(template.misconceptionHints.byTask[newId]).toEqual([
      { conceptKey: 'c1', label: '把呼吸作用当光合作用', why: '混淆原料' },
    ]);
    expect(template.misconceptionHints.byTask.old_task).toBeUndefined();
    expect(template.taskAdjustability.byTask.old_task).toBeUndefined();
    expect(template.taskAdjustability.byTask[newId]).toBe('core');
    expect(template.stageDesigns['stage-2']).toBeDefined();

    // ③ KC 标注：taskKcLinks 绑真实 subtasks.id，旧任务死链清掉，conceptKcs/kcGraph 同包
    expect(template.kcAnnotation.taskKcLinks).toEqual([
      { taskKey: 'replan-1-1', taskTitle: '新任务一', linkedKCs: ['kc_photo'], taskId: newId },
    ]);
    expect(template.kcAnnotation.conceptKcs.some((kc: any) => kc.kcId === 'kc_photo')).toBe(true);
    expect(template.kcAnnotation.taskKcLinks.some((link: any) => link.taskId === 'old_task')).toBe(false);

    // 消费侧：教学链按新任务读 KC 不再为空
    const kcs = resolveTaskKcsFromPath({ id: newId, title: '新任务一' }, { aiPromptTemplate: JSON.stringify(template) });
    expect(kcs.map((kc) => kc.kcId)).toEqual(['kc_photo']);

    // 概念图重物化
    expect(mockMaterializePathGraph).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      pathId: 'lp1',
      kcAnnotation: expect.objectContaining({ taskKcLinks: expect.any(Array) }),
    }));
  });

  it('kc-mapper 失败时不阻断重排，但仍写 sidecar 与 conceptId', async () => {
    mockExecuteSkillWithResult.mockRejectedValue(new Error('kc-mapper down'));

    await requestPathReplan({
      pathId: 'lp1',
      userId: 'u1',
      mode: 'overwrite',
      requireConfirmation: false,
      reason: '调整',
    } as never);

    const created = (mockTx.subtasks.create.mock.calls as any[])[0][0].data;
    const template = writtenTemplate();
    expect(created.conceptId).toBe('kc_photo');
    expect(template.materialRefs.byTask[created.id]).toBeDefined();
    // 无 KC 输出 → 保留原标注（不回滚成 null），但被删任务的死链仍要清掉
    expect(template.kcAnnotation.conceptKcs.some((kc: any) => kc.kcId === 'kc_old')).toBe(true);
    expect(template.kcAnnotation.taskKcLinks.some((link: any) => link.taskId === 'old_task')).toBe(false);
    expect(mockMaterializePathGraph).not.toHaveBeenCalled();
  });
});
