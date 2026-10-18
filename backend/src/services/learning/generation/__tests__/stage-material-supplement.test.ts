/**
 * #119 优化项 1：零引用阶段定向补课（stage-material-supplement）。
 *
 * 验收点（issue 原文口径 + 本次修法约定）：
 * 1) **有缺口补成**：零引用阶段在闸内调一次 stage-designer，只并入「带引用且 sectionId 命中
 *    本阶段窗口」的新任务；补后覆盖口径 refs>0（zeroRefStages 下降）；
 * 2) **补不来**：调用失败 / 返回的任务都不带窗口内引用 → 保留首轮产出，如实记 reason；
 * 3) **闸耗尽**：每路径最多 1 次调用，第二次触发只记账、不再调用模型；
 * 4) **窗口无可用章节**：没有可核对的引用目标 → 不发起调用，且不消耗闸。
 * 另覆盖：无并入空位（已达 subtasksPerStageRange 上界）不消耗闸；系统不自动补写引用
 * （拒收不带引用的任务 = 「宁缺勿编」的代码化）。
 */
import {
  ZERO_REF_SUPPLEMENT_MAX_TASKS,
  claimZeroRefSupplementGate,
  collectWindowSectionIds,
  countWindowSectionRefs,
  createZeroRefSupplementGate,
  filterTasksByWindowRefs,
  supplementZeroRefStage,
} from '../stage-material-supplement';
import { readFileSync } from 'fs';
import { summarizeSectionRefPositions } from '../../../materials/material-refs';
import type { PromptMaterial } from '../../../materials/material-prompt-projection';

type TestTask = {
  title: string;
  type: string;
  estimatedMinutes: number;
  materialRefs?: Array<{ sectionId: string; quote: string }>;
};

const materialWithSections = (ids: Array<string | null>): PromptMaterial => ({
  title: '备考资料',
  sourceUrl: null,
  materialId: 'm1',
  publisher: null,
  sourceTier: null,
  tldr: '资料概要',
  sections: ids.map((id, index) => ({ id, title: `第 ${index + 1} 节` })),
  keyPoints: [],
});

const withRef = (title: string, sectionId: string): TestTask => ({
  title,
  type: 'execute',
  estimatedMinutes: 30,
  materialRefs: [{ sectionId, quote: '资料原文逐字引文' }],
});

const plainTask = (title: string): TestTask => ({ title, type: 'acquire', estimatedMinutes: 30 });

const designerPayloadOf = (mock: jest.Mock, callIndex = 0): Record<string, unknown> =>
  mock.mock.calls[callIndex][0] as Record<string, unknown>;

const supplementRequestOf = (mock: jest.Mock, callIndex = 0): Record<string, unknown> =>
  designerPayloadOf(mock, callIndex).supplementRequest as Record<string, unknown>;

describe('零引用补课 · 场景 1：有缺口补成', () => {
  it('只并入带「窗口内 sectionId」的新任务，补后 refs>0 且闸被消耗', async () => {
    const gate = createZeroRefSupplementGate();
    const callDesigner = jest.fn(async () => ({
      subtasks: [
        withRef('精读第 2 节并把对照表复述一遍', 's-2'),   // 窗口内 → 收
        withRef('按第 9 节内容做迁移练习', 's-9'),         // 窗口外 → 拒收
        plainTask('凭记忆复述框架'),                        // 无引用 → 拒收
      ],
    }));

    const outcome = await supplementZeroRefStage({
      stageNumber: 3,
      materials: [materialWithSections(['s-1', 's-2', 's-3'])],
      stageTasks: [plainTask('建立概念地图')],
      designerInput: { milestone: { stageNumber: 3 }, materials: [materialWithSections(['s-1', 's-2', 's-3'])] },
      hints: { subtasksPerStageRange: [2, 6], subtaskMinutesRange: [20, 40] },
      gate,
      callDesigner,
    });

    expect(callDesigner).toHaveBeenCalledTimes(1);
    expect(outcome.attempted).toBe(true);
    expect(outcome.applied).toBe(true);
    expect(outcome.reason).toBeNull();
    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(2);
    expect(outcome.tasks.map((task) => task.title)).toEqual(['建立概念地图', '精读第 2 节并把对照表复述一遍']);
    expect(gate.used).toBe(true);
    // 覆盖口径复核（materialCoverage 同源函数）：补后 refs>0 → zeroRefStages 下降
    const summary = summarizeSectionRefPositions(outcome.tasks.flatMap((task) => task.materialRefs || []));
    expect(summary).toEqual({ count: 1, minSection: 2, maxSection: 2 });
    // 补课请求：needed/既有任务/分钟区间，外加「只补带引用任务」标记；窗口资料由 designerInput 带（首轮同一份）
    const request = supplementRequestOf(callDesigner);
    expect(request).toMatchObject({
      // 空位充足时请求上限条数（2 条：1 条即闭合缺口，多要 1 条防单条被拒）
      needed: 2,
      stageNumber: 3,
      reason: 'zero-material-ref',
      materialRefsRequired: true,
      minutesRange: [20, 40],
    });
    expect(request.existing).toEqual([{ title: '建立概念地图', type: 'acquire' }]);
    expect(designerPayloadOf(callDesigner).milestone).toEqual({ stageNumber: 3 });
  });
});

describe('零引用补课 · 场景 2：补不来', () => {
  it('返回的任务都不带窗口内引用 → 保留首轮产出，记 no-ref-tasks', async () => {
    const gate = createZeroRefSupplementGate();
    const callDesigner = jest.fn(async () => ({
      subtasks: [withRef('引用窗口外章节', 's-9'), plainTask('无引用任务')],
    }));
    const stageTasks = [plainTask('建立概念地图')];

    const outcome = await supplementZeroRefStage({
      stageNumber: 4,
      materials: [materialWithSections(['s-1', 's-2'])],
      stageTasks,
      designerInput: {},
      gate,
      callDesigner,
    });

    expect(callDesigner).toHaveBeenCalledTimes(1);
    expect(outcome.attempted).toBe(true);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('no-ref-tasks');
    expect(outcome.incoming).toBe(2);
    expect(outcome.rejected).toBe(2);
    expect(outcome.tasks).toEqual(stageTasks); // 首轮产出原样保留
    expect(gate.used).toBe(true); // 调用发生过 → 额度已消耗
  });

  it('补课调用抛错 → 记 call-failed，不打断生成链', async () => {
    const gate = createZeroRefSupplementGate();
    const callDesigner = jest.fn(async () => {
      throw new Error('upstream down');
    });
    const stageTasks = [plainTask('建立概念地图')];

    const outcome = await supplementZeroRefStage({
      stageNumber: 4,
      materials: [materialWithSections(['s-1'])],
      stageTasks,
      designerInput: {},
      gate,
      callDesigner,
    });

    expect(outcome.attempted).toBe(true);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('call-failed');
    expect(outcome.tasks).toEqual(stageTasks);
    expect(gate.used).toBe(true);
  });

  it('带引用但标题与首轮近似（换皮） → 记 no-added-tasks，不并回清单', async () => {
    const gate = createZeroRefSupplementGate();
    const callDesigner = jest.fn(async () => ({
      subtasks: [withRef('串联并联电功率计算的综合自测与查漏巩固', 's-2')],
    }));
    const stageTasks = [withRef('串联并联电功率计算的综合自测与查漏', 's-1')];

    const outcome = await supplementZeroRefStage({
      stageNumber: 2,
      materials: [materialWithSections(['s-1', 's-2'])],
      stageTasks,
      designerInput: {},
      gate,
      callDesigner,
    });

    expect(outcome.attempted).toBe(true);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('no-added-tasks');
    expect(outcome.tasks).toEqual(stageTasks);
  });
});

describe('零引用补课 · 场景 3：闸耗尽（每路径最多 1 次）', () => {
  it('第二次触发不再调用模型，只记 gate-exhausted', async () => {
    const gate = createZeroRefSupplementGate();
    const callDesigner = jest.fn(async () => ({ subtasks: [withRef('精读第 2 节并复述', 's-2')] }));
    const material = materialWithSections(['s-1', 's-2']);
    const params = (stageNumber: number) => ({
      stageNumber,
      materials: [material],
      stageTasks: [plainTask('建立概念地图')],
      designerInput: {},
      gate,
      callDesigner,
    });

    const first = await supplementZeroRefStage(params(3));
    expect(first.applied).toBe(true);
    expect(gate.used).toBe(true);

    const second = await supplementZeroRefStage(params(4));
    expect(callDesigner).toHaveBeenCalledTimes(1); // 闸外不再调用
    expect(second.attempted).toBe(false);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('gate-exhausted');
    expect(second.tasks.map((task) => task.title)).toEqual(['建立概念地图']);
  });

  it('闸是「先查后置」：第一次取到、第二次取不到', () => {
    const gate = createZeroRefSupplementGate();
    expect(claimZeroRefSupplementGate(gate)).toBe(true);
    expect(claimZeroRefSupplementGate(gate)).toBe(false);
    expect(gate.used).toBe(true);
  });
});

describe('零引用补课 · 场景 4：窗口无可用章节', () => {
  it('窗口内章节都没有 id → 不发起调用，也不消耗闸', async () => {
    const gate = createZeroRefSupplementGate();
    const callDesigner = jest.fn(async () => ({ subtasks: [withRef('精读第 1 节', 's-1')] }));
    const stageTasks = [plainTask('建立概念地图')];

    const outcome = await supplementZeroRefStage({
      stageNumber: 4,
      materials: [materialWithSections([null, null])],
      stageTasks,
      designerInput: {},
      gate,
      callDesigner,
    });

    expect(callDesigner).not.toHaveBeenCalled();
    expect(outcome.attempted).toBe(false);
    expect(outcome.reason).toBe('no-window-sections');
    expect(outcome.tasks).toEqual(stageTasks);
    expect(gate.used).toBe(false); // 额度留给其它零引用阶段
  });

  it('空资料窗（无 sections）同样跳过', async () => {
    const gate = createZeroRefSupplementGate();
    const callDesigner = jest.fn(async () => ({ subtasks: [] }));

    const outcome = await supplementZeroRefStage({
      stageNumber: 1,
      materials: [materialWithSections([])],
      stageTasks: [plainTask('建立概念地图')],
      designerInput: {},
      gate,
      callDesigner,
    });

    expect(outcome.reason).toBe('no-window-sections');
    expect(callDesigner).not.toHaveBeenCalled();
    expect(gate.used).toBe(false);
  });

  it('阶段任务已达上界（无并入空位）→ 不发起调用，也不消耗闸', async () => {
    const gate = createZeroRefSupplementGate();
    const callDesigner = jest.fn(async () => ({ subtasks: [withRef('精读第 2 节', 's-2')] }));

    const outcome = await supplementZeroRefStage({
      stageNumber: 2,
      materials: [materialWithSections(['s-1', 's-2'])],
      stageTasks: [plainTask('课一'), plainTask('课二')],
      designerInput: {},
      hints: { subtasksPerStageRange: [2, 2] },
      gate,
      callDesigner,
    });

    expect(outcome.reason).toBe('no-headroom');
    expect(callDesigner).not.toHaveBeenCalled();
    expect(gate.used).toBe(false);
  });
});

describe('零引用补课 · 判据纯函数', () => {
  it('collectWindowSectionIds：多资料合并、去空白、跳过空 id', () => {
    expect(collectWindowSectionIds([
      materialWithSections(['s-1', ' s-2 ', null]),
      materialWithSections(['s-3']),
    ])).toEqual(['s-1', 's-2', 's-3']);
    expect(collectWindowSectionIds(null)).toEqual([]);
  });

  it('countWindowSectionRefs：只认 sectionId 命中窗口的引用', () => {
    const windowIds = new Set(['s-1', 's-2']);
    expect(countWindowSectionRefs({ materialRefs: [{ sectionId: 's-1' }, { sectionId: 's-9' }] }, windowIds)).toBe(1);
    expect(countWindowSectionRefs({ materialRefs: [{ sectionId: null }, { quote: '只有引文' }] }, windowIds)).toBe(0);
    expect(countWindowSectionRefs({ materialRefs: 'not-an-array' }, windowIds)).toBe(0);
    expect(countWindowSectionRefs(null, windowIds)).toBe(0);
  });

  it('filterTasksByWindowRefs：无引用任务一律拒收（系统不自动补引用）', () => {
    const windowIds = new Set(['s-1']);
    const { accepted, rejected } = filterTasksByWindowRefs<TestTask>(
      [withRef('带窗口引用', 's-1'), plainTask('无引用')],
      windowIds,
    );
    expect(accepted.map((task) => task.title)).toEqual(['带窗口引用']);
    expect(rejected).toBe(1);
    expect(ZERO_REF_SUPPLEMENT_MAX_TASKS).toBe(2);
  });
});

describe('#119 优化项 1 接线（源码守卫）', () => {
  const source = readFileSync('src/services/learning/generation/stage-enrichment.ts', 'utf8');
  const moduleSource = readFileSync('src/services/learning/generation/stage-material-supplement.ts', 'utf8');

  it('零引用阶段接线补课调用：路径级闸共享 + 与首轮同一条 skill 调用链', () => {
    expect(source).toContain('const zeroRefSupplementGate = createZeroRefSupplementGate();');
    expect(source).toContain('supplementZeroRefStage({');
    expect(source).toContain('gate: zeroRefSupplementGate,');
    expect(source).toContain('callDesigner: (input) => executeSkill(stageDesignerDefinition, input),');
  });

  it('补成后按补后清单替换阶段任务并重算覆盖（zeroRefStages 才可能下降）', () => {
    expect(source).toContain('stageTasks = outcome.tasks;');
    expect(source).toContain('refsAfter: stageMaterialSummary.count,');
  });

  it('补课审计写进 materialCoverage（逐阶段结果 + 路径级闸状态）', () => {
    expect(source).toContain('materialSupplement?: ZeroRefSupplementAudit;');
    expect(source).toContain('...(materialSupplement ? { materialSupplement } : {})');
    expect(source).toContain('zeroRefSupplement: {');
    expect(source).toContain('gateUsed: zeroRefSupplementGate.used,');
  });

  it('纪律：模块只读判据 + 拒收无引用任务，不自动补写/绑定 materialRefs', () => {
    // 模块内不得出现「造一条引用」的写法（quote/sectionId 只出现在读取与判据里）
    expect(moduleSource).not.toMatch(/quote:\s*['"`]/);
    expect(moduleSource).not.toMatch(/sectionId:\s*['"`]/);
    expect(moduleSource).toContain('filterTasksByWindowRefs');
  });
});
