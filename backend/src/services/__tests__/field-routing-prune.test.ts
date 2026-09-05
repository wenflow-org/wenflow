/**
 * pruneStageFieldRoutings 单测（P2 补全，变更路径审计 C 缺口：文件删除 → DB 孤儿清理）
 *
 * 覆盖：
 *   - 默认 dry-run：只报告候选清单，不删不写审计
 *   - dryRun=false：逐行先写审计（before=被删行全量，changeType='orchestration-prune'）再删除
 *   - 全局声明保护：仍在任意编排文件声明中的行不视为孤儿（含其他 stage）
 *   - 覆盖行保护：managedByCode=false 任何情况下不删，仅记入 protectedRows
 *   - routing 归属判定：agentId ∈ 本 stage 声明契约 / fieldId ∈ 本 stage 声明字段 /
 *     agentId ∈ 本 stage 待删契约（整契约+其路由一起删的场景）
 *   - actorId 透传进审计
 */
import * as service from '../field-routing-bootstrap.service';
import { loadOrchestrationFiles, type OrchestrationStage } from '../field-routing/orchestration-file';

// 真实 simulation 编排文件的第一个契约/字段/路由（用于"声明中存在 → 不删"用例）
const realSimulation = loadOrchestrationFiles().find((s) => s.stage === 'simulation')!;
const realContract = realSimulation.contracts[0].agentId;
const realField = realSimulation.fields[0].fieldId;
const realRouting = realSimulation.routings[0];

const stubStage: OrchestrationStage = {
  stage: 'simulation',
  contracts: realSimulation.contracts.slice(0, 1),
  fields: realSimulation.fields.slice(0, 1),
  routings: realSimulation.routings.slice(0, 1),
};

function makeDatabase() {
  const contracts = [
    // 声明中存在 → 不删
    { id: 'c1', agentId: realContract, stage: 'simulation', managedByCode: true, displayName: 'real' },
    // 孤儿（未在任何文件声明）→ 删
    { id: 'c2', agentId: 'ghost-contract', stage: 'simulation', managedByCode: true, displayName: 'ghost' },
    // 覆盖行 → 只报告不删
    { id: 'c3', agentId: 'ghost-contract-protected', stage: 'simulation', managedByCode: false, displayName: 'admin' },
  ];
  const fields = [
    // 声明中存在 → 不删
    { id: 'f1', stage: 'simulation', fieldId: realField, managedByCode: true },
    // 孤儿 → 删
    { id: 'f2', stage: 'simulation', fieldId: 'ghost-field', managedByCode: true },
    // 覆盖行 → 只报告不删
    { id: 'f3', stage: 'simulation', fieldId: 'ghost-field-protected', managedByCode: false },
  ];
  const routings = [
    // 声明中存在 → 不删
    { id: 'r1', agentId: realRouting.agentId, fieldId: realRouting.fieldId, managedByCode: true },
    // 孤儿（agentId ∈ 待删契约）→ 删
    { id: 'r2', agentId: 'ghost-contract', fieldId: 'ghost-field', managedByCode: true },
    // 孤儿（agentId ∈ 本 stage 声明契约，字段已从文件删）→ 删
    { id: 'r3', agentId: realContract, fieldId: 'ghost-field', managedByCode: true },
    // 覆盖行 → 只报告不删
    { id: 'r4', agentId: realContract, fieldId: 'ghost-field-protected', managedByCode: false },
  ];
  const db: any = {
    agent_contracts: {
      findMany: jest.fn(async () => contracts),
      delete: jest.fn(async () => ({})),
    },
    field_definitions: {
      findMany: jest.fn(async () => fields),
      delete: jest.fn(async () => ({})),
    },
    agent_field_routings: {
      findMany: jest.fn(async () => routings),
      delete: jest.fn(async () => ({})),
    },
    node_config_changes: {
      create: jest.fn(async (args: any) => ({ id: `audit-${args.data.targetId}-${Math.random().toString(36).slice(2, 6)}`, ...args.data })),
    },
  };
  return db;
}

function candidateKeys(report: service.StagePruneReport) {
  return report.candidates.map((c) => `${c.table}:${c.key}`).sort();
}

describe('pruneStageFieldRoutings：孤儿行清理', () => {
  it('默认 dry-run：只报告候选清单与受保护覆盖行，不删不写审计', async () => {
    const db = makeDatabase();
    const report = await service.pruneStageFieldRoutings(db, stubStage, {});

    expect(report.dryRun).toBe(true);
    expect(report.deletedCount).toBe(0);
    expect(report.auditIds).toEqual([]);
    expect(candidateKeys(report)).toEqual([
      'agent_contracts:ghost-contract',
      'agent_field_routings:ghost-contract\u0000ghost-field',
      'agent_field_routings:' + realContract + '\u0000ghost-field',
      'field_definitions:simulation\u0000ghost-field',
    ]);
    // 覆盖行只报告不删
    expect(report.protectedRows).toEqual([
      { table: 'agent_contracts', key: 'ghost-contract-protected' },
      { table: 'field_definitions', key: 'simulation/ghost-field-protected' },
      { table: 'agent_field_routings', key: `${realContract}/ghost-field-protected` },
    ]);
    // 零删除 / 零审计写入
    expect(db.agent_contracts.delete).not.toHaveBeenCalled();
    expect(db.field_definitions.delete).not.toHaveBeenCalled();
    expect(db.agent_field_routings.delete).not.toHaveBeenCalled();
    expect(db.node_config_changes.create).not.toHaveBeenCalled();
  });

  it('声明中仍存在的行（含其他 stage 文件声明）不视为孤儿', async () => {
    const db = makeDatabase();
    const report = await service.pruneStageFieldRoutings(db, stubStage, {});
    const keys = candidateKeys(report);
    // c1 / f1 / r1（真实 simulation 文件声明）不在候选
    expect(keys).not.toContain(`agent_contracts:${realContract}`);
    expect(keys).not.toContain(`field_definitions:simulation\u0000${realField}`);
    expect(keys).not.toContain(`agent_field_routings:${realRouting.agentId}\u0000${realRouting.fieldId}`);
  });

  it('dryRun=false：逐行先写审计（before=被删行全量）再删除，覆盖行不删', async () => {
    const db = makeDatabase();
    const report = await service.pruneStageFieldRoutings(db, stubStage, { dryRun: false, actorId: 'u1' });

    expect(report.dryRun).toBe(false);
    expect(report.deletedCount).toBe(4);
    expect(report.auditIds).toHaveLength(4);

    // 删除调用：4 个候选各一次（覆盖行不删）
    expect(db.agent_contracts.delete).toHaveBeenCalledTimes(1);
    expect(db.agent_contracts.delete).toHaveBeenCalledWith({ where: { agentId: 'ghost-contract' } });
    expect(db.field_definitions.delete).toHaveBeenCalledTimes(1);
    expect(db.field_definitions.delete).toHaveBeenCalledWith({
      where: { stage_fieldId: { stage: 'simulation', fieldId: 'ghost-field' } },
    });
    expect(db.agent_field_routings.delete).toHaveBeenCalledTimes(2);

    // 审计：4 条，changeType='orchestration-prune'，before=被删行全量，actorId 透传
    const createMock = db.node_config_changes.create as jest.Mock;
    const calls = createMock.mock.calls.map((call: any[]) => call[0].data);
    expect(calls).toHaveLength(4);
    for (const data of calls) {
      expect(data.changeType).toBe('orchestration-prune');
      expect(data.targetTable).toBe('orchestration');
      expect(data.targetId).toBe('simulation');
      expect(data.actorId).toBe('u1');
      expect(data.actorRole).toBe('admin');
      expect(data.after).toBeNull();
      expect(JSON.parse(data.before)).toBeDefined();
    }
    // 被删行全量进 before（含 id/managedByCode 等业务外列）
    const contractAudit = calls.find((data: any) => data.agentId === 'ghost-contract');
    const before = JSON.parse(contractAudit.before);
    expect(before).toEqual(expect.objectContaining({ id: 'c2', agentId: 'ghost-contract', managedByCode: true, displayName: 'ghost' }));
    // routing 行同时带 agentId + fieldId（/changes 端点可按任一维度检索）
    const routingAudit = calls.find((data: any) => data.agentId === 'ghost-contract' && data.fieldId === 'ghost-field');
    expect(routingAudit).toBeDefined();
  });

  it('dryRun=false 时显式指定 dryRun=true → 仍只报告', async () => {
    const db = makeDatabase();
    const report = await service.pruneStageFieldRoutings(db, stubStage, { dryRun: true });
    expect(report.deletedCount).toBe(0);
    expect(db.agent_contracts.delete).not.toHaveBeenCalled();
    expect(db.node_config_changes.create).not.toHaveBeenCalled();
  });
});
