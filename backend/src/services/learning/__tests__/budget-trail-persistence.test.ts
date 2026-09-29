/**
 * 预算留痕落库链契约（2026-09-29 I6-2 / I6-3）。
 *
 * 背景：实审结论是「异常能定位到 hop，定位不到函数」——守恒执行层改了学时、结构容量又改了锚，
 * 但两处的决策都不落库（守恒 report 只进日志，且仅在有 gapNote 时打；hints 的每阶段锚无来源）。
 * 修复不是「多打日志」，而是让决策随生成记录落库，供事后复核。
 *
 * 本测试锁的是**落库链**（不是算法）：算法有单测（budget-conservation / budget-derivation），
 * 这里防的是「字段算了但没人接」——删掉任何一跳的接线都会静默回到不可观测状态，
 * 而那种回归不会让任何其它测试变红。故按跨层契约做静态锁。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// 本文件位于 backend/src/services/learning/__tests__/ → 仓库根上溯 5 层
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const HINTS = read('backend/src/services/learning/path-planning-hints.ts');
const SKILL = read('backend/src/skills/path-planning/index.ts');
const CORE = read('backend/src/services/learning/generation/path-generation.core.ts');

describe('I6-3 预算派生链：hints 产出且随 hints 落库', () => {
  it('derivePlanningHints 返回 budgetDerivation', () => {
    expect(HINTS).toContain('budgetDerivation');
    expect(HINTS).toMatch(/^\s*budgetDerivation,$/m);
  });

  it('BudgetDerivation 记录了「哪一级 fallback 给的总锚」与「容量夹的判据」', () => {
    // 没有来源字段，评审只能记「hints 内部不自洽」（实测 22.4 vs 69.3，差 68%）
    for (const key of ['source', 'structuredHours', 'inferredCapHours', 'perMilestoneRequested',
      'structureStageCapacityHours', 'perMilestoneAnchored', 'anchorClamped']) {
      expect(HINTS).toContain(key);
    }
  });

  it('hints 是纯函数层：不在其中打日志（留痕靠落库，不靠 logger）', () => {
    expect(HINTS).not.toMatch(/\blogger\./);
  });
});

describe('I6-2 守恒决策留痕：skill 产出 → analysis → 生成记录', () => {
  it('skill 输出带 budgetConservation（挂在顶层，不是会被覆写的 _debug）', () => {
    expect(SKILL).toContain('budgetConservation: conservation.report');
  });

  it('守恒报告含夹的来源与逐阶段留痕（可判「是谁夹的」）', () => {
    for (const key of ['clampReason', 'perStageCapHours', 'perStage']) {
      expect(SKILL).toContain(key);
    }
    // 四类来源齐全：容量 / 1.8× 上限 / 0.6× 下限 / 未动
    expect(SKILL).toMatch(/'capacity' \| 'ceiling' \| 'floor' \| 'none'/);
  });

  it('analysis 透传该字段（否则落库断在第二跳）', () => {
    expect(CORE).toContain('budgetConservation: (path as any)?.budgetConservation');
  });

  it('生成记录 _generation 落库该字段（否则断在第三跳）', () => {
    expect(CORE).toContain('budgetConservation: (analysis as any)?.budgetConservation');
  });
});
