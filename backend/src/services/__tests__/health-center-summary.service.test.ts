/**
 * 巡检聚合服务测试（GET /health-center/summary 数据源）
 *
 * 1. 正常返回：五分组结构齐备、健康 13 项带 base/semantics、漂移/对账/完成度/全局计数合法。
 * 2. 与现有端点一致（抽查）：health.items 与 buildHealthCenterReport 逐项 count 一致；
 *    reconciliation 各字段与 runSkillReadinessChecks（/skills/readiness 同源）数组长度一致；
 *    drift 与 health 对应项 count 一致。
 * 3. 无 skill 空态：注入空户口簿 → 各分组计数归零、健康清单结构不塌。
 * 4. 缓存：60s 内复用，skipCache 强制重算。
 */

import {
  buildHealthCenterSummaryReport,
  getHealthCenterSummaryReport,
  resetHealthCenterSummaryCache,
} from '../health-center-summary.service';
import {
  buildHealthCenterReport,
  collectHealthCenterScan,
  type HealthCenterDbAdapter,
} from '../health-center.service';
import { runSkillReadinessChecks } from '../skills-readiness.service';
import { getSkillCompletion } from '../skill-registry/skill-completion.service';
import { loadSkillsBookRaw } from '../skill-registry/skills-file';
import { listRawManifestEntries } from '../agent-manifest.service';

const EMPTY_DB: HealthCenterDbAdapter = {
  agent_prompts: { findMany: jest.fn().mockResolvedValue([]) },
  skill_registrations: { findMany: jest.fn().mockResolvedValue([]) },
  agent_contracts: { findMany: jest.fn().mockResolvedValue([]) },
  field_definitions: { findMany: jest.fn().mockResolvedValue([]) },
  agent_field_routings: { findMany: jest.fn().mockResolvedValue([]) },
  node_config_changes: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  prompt_call_logs: { findMany: jest.fn().mockResolvedValue([]) },
};

beforeEach(() => {
  resetHealthCenterSummaryCache();
});

describe('巡检聚合（health-center/summary）', () => {
  it('正常返回：五分组结构齐备，健康 13 项带 base/semantics 语义', async () => {
    const report = await buildHealthCenterSummaryReport(EMPTY_DB);

    expect(report.generatedAt).toBeTruthy();

    // health：13 项全量 + 汇总
    expect(report.health.items.length).toBeGreaterThanOrEqual(13);
    expect(report.health.summary.total).toBe(report.health.items.length);
    expect(report.health.abnormal).toBe(
      report.health.items.filter((i) => i.severity === 'error' || i.severity === 'warn').length,
    );
    for (const item of report.health.items) {
      expect(typeof item.base).toBe('string');
      expect(typeof item.semantics).toBe('string');
      expect(typeof item.count).toBe('number');
      expect(typeof item.severity).toBe('string');
    }

    // drift：三维度计数
    expect(typeof report.drift.contract).toBe('number');
    expect(typeof report.drift.hash).toBe('number');
    expect(typeof report.drift.runtime).toBe('number');

    // reconciliation：W1-W5 简版计数
    for (const key of ['total', 'missingRegistration', 'zombieRegistration', 'missingActive', 'zombieActive', 'zombieSkillActive', 'unwired'] as const) {
      expect(typeof report.reconciliation[key]).toBe('number');
    }

    // completion：五档分布
    const buckets = Object.keys(report.completion.distribution);
    expect(buckets.sort()).toEqual(['core-ready', 'draft', 'fields-synced', 'handler-ready', 'live']);
    expect(report.completion.live).toBe(report.completion.distribution.live);

    // global
    expect(report.global.total).toBe(report.reconciliation.total);
    expect(typeof report.global.aux).toBe('number');
    expect(typeof report.global.mainline).toBe('number');
    expect(typeof report.global.handlerOnly).toBe('number');
    expect(typeof report.global.abnormalSkills).toBe('number');
  });

  it('与现有端点一致：health.items 与 /health-center 逐项 count 一致', async () => {
    const [summary, healthCenter] = await Promise.all([
      buildHealthCenterSummaryReport(EMPTY_DB),
      buildHealthCenterReport(EMPTY_DB),
    ]);

    expect(summary.health.items.length).toBe(healthCenter.items.length);
    const summaryById = new Map(summary.health.items.map((i) => [i.id, i]));
    for (const item of healthCenter.items) {
      const mine = summaryById.get(item.id);
      expect(mine).toBeTruthy();
      expect(mine!.count).toBe(item.count);
      expect(mine!.status).toBe(item.status);
      expect(mine!.severity).toBe(item.severity);
    }
    expect(summary.health.summary).toEqual(healthCenter.summary);
  });

  it('与现有端点一致：reconciliation 与 /skills/readiness 同源计数一致', async () => {
    const [summary, readiness] = await Promise.all([
      buildHealthCenterSummaryReport(EMPTY_DB),
      runSkillReadinessChecks(EMPTY_DB as any),
    ]);

    expect(summary.reconciliation.missingRegistration).toBe(readiness.checks.W2.missingRegistration.length);
    expect(summary.reconciliation.zombieRegistration).toBe(readiness.checks.W2.zombieRegistration.length);
    expect(summary.reconciliation.missingActive).toBe(readiness.checks.W1.missingActive.length);
    expect(summary.reconciliation.zombieActive).toBe(readiness.checks.W1.zombieActive.length);
    expect(summary.reconciliation.zombieSkillActive).toBe(readiness.checks.W1.zombieSkillActive.length);
    expect(summary.reconciliation.unwired).toBe(
      readiness.checks.W3.stepWithoutBook.length + readiness.checks.W3.bookWithoutStep.length,
    );
  });

  it('漂移摘要与健康清单对应项 count 一致（同一检测口径）', async () => {
    const report = await buildHealthCenterSummaryReport(EMPTY_DB);
    const byId = new Map(report.health.items.map((i) => [i.id, i]));

    expect(report.drift.contract).toBe(byId.get('field-routing-contract')!.count);
    expect(report.drift.hash).toBe(byId.get('w4-corehash')!.count);
    expect(report.drift.runtime).toBe(byId.get('runtime-prompt')!.count);
  });

  it('完成度分布与全局统计：五档求和 = 户口簿总数，kind 计数与户口簿一致', async () => {
    const report = await buildHealthCenterSummaryReport(EMPTY_DB);
    const book = loadSkillsBookRaw();

    const sum = Object.values(report.completion.distribution).reduce((a, b) => a + b, 0);
    expect(sum).toBe(book.skills.length);
    expect(report.global.total).toBe(book.skills.length);
    expect(report.global.aux).toBe(book.skills.filter((s) => s.kind === 'aux').length);
    expect(report.global.mainline).toBe(book.skills.filter((s) => s.kind === 'mainline').length);
    expect(report.global.handlerOnly).toBe(book.skills.filter((s) => s.kind === 'handler-only').length);
    expect(report.global.abnormalSkills).toBeGreaterThanOrEqual(0);
    expect(report.global.abnormalSkills).toBeLessThanOrEqual(book.skills.length);
  });

  it('完成度抽查：抽样 skill 用同一完成度状态机复算，档位落入对应桶', async () => {
    const data = await collectHealthCenterScan(EMPTY_DB);
    const activePromptIds = new Set(data.activeRows.map((r) => r.agentId));
    const manifestSkillIds = new Set(
      listRawManifestEntries()
        .filter((item) => item.kind === 'skill' && item.id.startsWith('skill:'))
        .map((item) => item.id.slice('skill:'.length)),
    );

    const report = await buildHealthCenterSummaryReport(EMPTY_DB);
    const sampled = data.book.skills.slice(0, 3);
    for (const entry of sampled) {
      const completion = await getSkillCompletion(entry.skillId, {
        book: data.book,
        orchestrationStages: data.orchestrationStages,
        activePromptIds,
        inManifest: (id) => manifestSkillIds.has(id),
      });
      // 桶内计数至少包含该 skill 一席（口径一致：同一状态机 + 同一扫描中间产物）
      expect(report.completion.distribution[completion.status]).toBeGreaterThanOrEqual(1);
    }
  });

  it('异常 skill 判定：仅展示项失败（wired）不计入，handler-only 全通过项 → 不判异常', async () => {
    // 合成户口簿：handler-only + noPromptFile=true 条目，全部已评估检查通过
    // （manifest 展示项需命中真实 agent-manifest → skillId 借用真实存在的 goal-conversation；
    //   registered 经 registrationPoint=none 豁免 → true；handler 指向仓库真实文件；
    //   wired 仅展示恒 false —— 不应计入 abnormalSkills）
    const book = {
      version: 1,
      skills: [
        {
          skillId: 'goal-conversation',
          kind: 'handler-only' as const,
          handlerRef: 'README.md',
          registrationPoint: 'none' as const,
          noPromptFile: true,
          displayName: 'synthetic ok',
        },
      ],
    };
    const report = await buildHealthCenterSummaryReport(EMPTY_DB, { book });

    expect(report.completion.distribution.live).toBe(1);
    expect(report.global.total).toBe(1);
    expect(report.global.handlerOnly).toBe(1);
    expect(report.global.abnormalSkills).toBe(0);
  });

  it('无 skill 空态：注入空户口簿 → skill 相关分组归零，健康清单结构不塌（仓库级检查项保留）', async () => {
    const report = await buildHealthCenterSummaryReport(EMPTY_DB, {
      book: { version: 1, skills: [] },
    });

    // 健康清单本身不塌（13 项结构与语义保留；仓库级检查项如 contract-parity/snapshots/params
    // 与户口簿无关，空户口簿下仍按仓库真实状态报，不强制归零）
    expect(report.health.items.length).toBeGreaterThanOrEqual(13);
    expect(report.health.summary.total).toBe(report.health.items.length);
    expect(report.health.abnormal).toBe(
      report.health.items.filter((i) => i.severity === 'error' || i.severity === 'warn').length,
    );

    expect(report.drift).toEqual({ contract: 0, hash: 0, runtime: 0 });
    // W3 unwired 含"steps 引用不在户口簿"方向：空户口簿下所有 definition steps 都算未接线（≥0 合法，不为 0）
    expect(report.reconciliation).toMatchObject({
      total: 0,
      missingRegistration: 0,
      zombieRegistration: 0,
      missingActive: 0,
      zombieActive: 0,
      zombieSkillActive: 0,
    });
    expect(report.reconciliation.unwired).toBeGreaterThanOrEqual(0);
    expect(Object.values(report.completion.distribution).every((n) => n === 0)).toBe(true);
    expect(report.completion.live).toBe(0);
    expect(report.global).toEqual({ total: 0, aux: 0, mainline: 0, handlerOnly: 0, abnormalSkills: 0 });
  });

  it('缓存：60s 内复用同一对象，skipCache 强制重算', async () => {
    const first = await getHealthCenterSummaryReport(EMPTY_DB);
    const second = await getHealthCenterSummaryReport(EMPTY_DB);
    expect(second).toBe(first);

    const third = await getHealthCenterSummaryReport(EMPTY_DB, { skipCache: true });
    expect(third).not.toBe(first);
    expect(third.generatedAt).toBeTruthy();
  });
});
