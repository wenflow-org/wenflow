/**
 * #200：routing 可达性声明静态门禁的规则测试。
 *
 * 最后一条用例直接跑真实 prompts/orchestration/*.yaml（纯静态、零 DB），
 * 所以「新加一条没声明可达性的 routing」在当前仓库里会红——包括 17 条靠缺省值的 live routing
 * 未登记 notes 时的状态。
 */
import fs from 'fs';
import path from 'path';
import { ORCHESTRATION_DIR, loadOrchestrationFiles } from '../orchestration-file';
import {
  UNGOVERNED_STAGE_REGISTRY,
  buildRoutingInventory,
  collectRoutingReachabilityGaps,
  diffRoutingInventory,
  formatRoutingReachabilityReport,
} from '../routing-reachability';

describe('collectRoutingReachabilityGaps（静态门禁规则）', () => {
  it('受管辖阶段里没声明 reachability 也没在 notes 登记的 routing → 违规并列出 stage/agentId/fieldId', () => {
    const report = collectRoutingReachabilityGaps([
      {
        stage: 'simulation',
        routings: [
          { agentId: 'skill:a', fieldId: 'ok', reachability: 'external', notes: 'external — 手动入口' },
          { agentId: 'skill:b', fieldId: 'declared', notes: 'auto — 仿真核主链回合内自动调用' },
          { agentId: 'skill:c', fieldId: 'ghost' },
        ],
      },
    ]);

    expect(report.governedStages).toEqual(['simulation']);
    expect(report.violations).toEqual([{ stage: 'simulation', agentId: 'skill:c', fieldId: 'ghost' }]);
    expect(formatRoutingReachabilityReport(report)).toContain('skill:c · ghost');
  });

  it('notes 里的 auto 登记：允许与既有备注以「；」并列，但必须有说明文字', () => {
    const report = collectRoutingReachabilityGaps([
      {
        stage: 'simulation',
        routings: [
          { agentId: 'skill:a', fieldId: 'f1', reachability: 'manual' },
          { agentId: 'skill:a', fieldId: 'f2', notes: 'internal — 仅调试；auto — 仿真核主链自动调用' },
          { agentId: 'skill:a', fieldId: 'f3', notes: 'auto — 教学回合内编排层自动调用' },
          { agentId: 'skill:a', fieldId: 'f4', notes: 'auto' },        // 无说明 → 不算登记
          { agentId: 'skill:a', fieldId: 'f5', notes: 'auto（默认）' }, // 无分隔符 → 不算登记
        ],
      },
    ]);

    expect(report.violations.map((v) => v.fieldId)).toEqual(['f4', 'f5']);
  });

  it('未启用词表的阶段（全库无显式 reachability）不算违规，只单列公示', () => {
    const report = collectRoutingReachabilityGaps([
      { stage: 'goal', routings: [{ agentId: 'skill:goal-conversation', fieldId: 'understanding.x' }] },
      { stage: 'simulation', routings: [{ agentId: 'skill:a', fieldId: 'f', reachability: 'external' }] },
    ]);

    expect(report.violations).toEqual([]);
    expect(report.governedStages).toEqual(['simulation']);
    expect(report.ungovernedStages).toEqual([{ stage: 'goal', routings: 1, declared: 0 }]);
    expect(report.unregisteredStages).toEqual([]);
  });

  it('#200-2 复核：既没接入词表、又没登记理由的阶段 → 违规（不再静默放行）', () => {
    const report = collectRoutingReachabilityGaps([
      { stage: 'brand-new-stage', routings: [{ agentId: 'skill:x', fieldId: 'f1' }, { agentId: 'skill:x', fieldId: 'f2' }] },
      { stage: 'goal', routings: [{ agentId: 'skill:goal-conversation', fieldId: 'understanding.x' }] },
    ]);

    expect(report.ungovernedStages).toEqual([{ stage: 'goal', routings: 1, declared: 0 }]);
    expect(report.unregisteredStages).toEqual([{ stage: 'brand-new-stage', routings: 2, declared: 0 }]);
    const text = formatRoutingReachabilityReport(report);
    expect(text).toContain('阶段未登记可达性口径');
    expect(text).toContain('brand-new-stage');
    expect(text).toContain('UNGOVERNED_STAGE_REGISTRY');
  });

  it('真实编排文件全量通过：受管辖阶段每条 routing 都已声明（含 notes 的 auto 登记）', () => {
    const stages = loadOrchestrationFiles();
    const report = collectRoutingReachabilityGaps(stages);

    // 失败时把违规逐条打出来，便于直接定位要补的 YAML 行
    expect(formatRoutingReachabilityReport(report)).toBeDefined();
    expect(report.violations).toEqual([]);
    // simulation（#184 词表的来源阶段）必须仍在受管辖范围内，否则本门禁等于空转
    expect(report.governedStages).toContain('simulation');
    // #200-2 复核：未接入词表的阶段集合必须与登记表逐字相同——
    // 谁新加一个 stage 文件（或改了 stage 名），这里立刻红，不再静默落进公示计数。
    expect(report.unregisteredStages).toEqual([]);
    expect(report.duplicateStages).toEqual([]);
    expect(report.ungovernedStages.map((s) => s.stage).sort()).toEqual(
      Object.keys(UNGOVERNED_STAGE_REGISTRY).sort(),
    );
  });

  it('#200-2 复核绕过 2：同一个 stage 名出现在多个编排文件里 → 违规（登记表以 stage 为键，重名即失效）', () => {
    const report = collectRoutingReachabilityGaps([
      { stage: 'goal', routings: [{ agentId: 'skill:a', fieldId: 'f1' }] },
      { stage: 'goal', routings: [{ agentId: 'skill:b', fieldId: 'f2' }] },
      { stage: 'simulation', routings: [{ agentId: 'skill:c', fieldId: 'f3', reachability: 'external' }] },
    ]);

    expect(report.duplicateStages).toEqual(['goal']);
    expect(formatRoutingReachabilityReport(report)).toContain('stage 名重复');
  });
});

describe('#200-2 复核绕过 1：清单棘轮（往已登记阶段里加边也要显式认领）', () => {
  it('buildRoutingInventory 逐阶段收集 agentId|fieldId 并排序', () => {
    const inventory = buildRoutingInventory([
      { stage: 'goal', routings: [{ agentId: 'skill:b', fieldId: 'z' }, { agentId: 'skill:a', fieldId: 'a' }] },
      { stage: 'path', routings: [] },
    ]);

    expect(inventory).toEqual({ goal: ['skill:a|a', 'skill:b|z'], path: [] });
  });

  it('diffRoutingInventory 报出新增与删除，两边都没有变化的阶段不出现', () => {
    const baseline = { goal: ['a|x', 'b|y'], teaching: ['c|z'] };
    const current = { goal: ['a|x', 'b|y', 'd|new'], path: ['e|p'] };

    expect(diffRoutingInventory(baseline, current)).toEqual([
      { stage: 'goal', added: ['d|new'], removed: [] },
      { stage: 'path', added: ['e|p'], removed: [] },
      { stage: 'teaching', added: [], removed: ['c|z'] },
    ]);
  });

  it('真实清单必须与 prompts/orchestration/_reachability-baseline.json 一致（加边即在 CI 红）', () => {
    const baselinePath = path.join(ORCHESTRATION_DIR, '_reachability-baseline.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Record<string, string[]>;
    const current = buildRoutingInventory(loadOrchestrationFiles());

    // 失败时逐条列出新增/删除的边；确认无误后用 npm run prompts:reachability:baseline:update 更新
    expect(diffRoutingInventory(baseline, current)).toEqual([]);
  });
});
