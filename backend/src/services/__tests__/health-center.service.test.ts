/**
 * 健康中心（基准体系版）服务测试
 *
 * 1. 聚合结构：每项携带基准元数据（base/semantics/severity/action 枚举合法），
 *    逐项断言 base/semantics（基准体系速查表，DRIFT_BASELINE_SURVEY §4.2）；
 *    summary 三分语义计数；fields-sync 存量孤儿 5 → consistency warn；
 *    覆盖行 0 → info；W4 空 ACTIVE → ok。
 * 2. fix 分支：fixable（w4-corehash / field-routing / field-routing-contract / snapshots）
 *    走 备份+执行+复检+审计 闭环；manual（params-consistency 等）→ 409 + 指引；
 *    readonly（override-record）→ 409；未知 id → 404；审计写 node_config_changes(changeType='health-fix')。
 * 聚合内部复用既有纯函数（真实 fs 扫描，仓库内确定性结果）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildHealthCenterReport,
  getHealthCenterReport,
  resetHealthCenterCache,
  runHealthCenterFix,
  HEALTH_CENTER_FIXABLE_IDS,
  type HealthCenterDbAdapter,
  type HealthCenterFixDeps,
} from '../health-center.service';

const BASE_ENUM = [
  'file:core.yaml',
  'file:manifest',
  'file:orchestration',
  'file:skills.yaml',
  'bidirectional',
  'db:managed',
  'runtime',
] as const;

const SEMANTICS_ENUM = ['baseline-drift', 'consistency', 'override-record', 'runtime-info'] as const;
const SEVERITY_ENUM = ['ok', 'warn', 'error', 'info'] as const;
const ACTION_ENUM = ['fixable', 'manual', 'none'] as const;

const EMPTY_DB: HealthCenterDbAdapter = {
  agent_prompts: { findMany: jest.fn().mockResolvedValue([]) },
  skill_registrations: { findMany: jest.fn().mockResolvedValue([]) },
  agent_contracts: { findMany: jest.fn().mockResolvedValue([]) },
  field_definitions: { findMany: jest.fn().mockResolvedValue([]) },
  agent_field_routings: { findMany: jest.fn().mockResolvedValue([]) },
  node_config_changes: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  prompt_call_logs: { findMany: jest.fn().mockResolvedValue([]) },
};

const EXPECTED_BASE_BY_ID: Record<string, string> = {
  'w4-corehash': 'file:core.yaml',
  'field-routing-contract': 'file:manifest',
  'field-routing': 'file:orchestration',
  'contract-parity': 'file:manifest',
  snapshots: 'file:orchestration',
  'yaml-crosscheck': 'file:core.yaml',
  'params-consistency': 'file:core.yaml',
  'fields-sync': 'bidirectional',
  'w1-active': 'file:skills.yaml',
  'w2-registration': 'file:skills.yaml',
  'w3-wiring': 'bidirectional',
  'override-record': 'db:managed',
  'runtime-prompt': 'runtime',
};

const EXPECTED_SEMANTICS_BY_ID: Record<string, string> = {
  'w4-corehash': 'baseline-drift',
  'field-routing-contract': 'baseline-drift',
  'field-routing': 'baseline-drift',
  'contract-parity': 'baseline-drift',
  snapshots: 'baseline-drift',
  'yaml-crosscheck': 'baseline-drift',
  'params-consistency': 'baseline-drift',
  'fields-sync': 'consistency',
  'w1-active': 'consistency',
  'w2-registration': 'consistency',
  'w3-wiring': 'consistency',
  'override-record': 'override-record',
  'runtime-prompt': 'runtime-info',
};

beforeEach(() => {
  resetHealthCenterCache();
});

describe('健康中心聚合（基准体系版）', () => {
  it('报告结构：summary 三分语义计数 + items 全量带基准元数据', async () => {
    const report = await buildHealthCenterReport(EMPTY_DB);

    expect(report.generatedAt).toBeTruthy();
    expect(report.summary.total).toBe(report.items.length);
    expect(report.summary.total).toBeGreaterThanOrEqual(13);
    expect(report.summary.baselineDrift).toBe(7);
    expect(report.summary.consistency).toBe(4);
    expect(report.summary.overrideRecord).toBe(1);
    expect(typeof report.summary.fixable).toBe('number');

    const ids = new Set(report.items.map((item) => item.id));
    expect(ids.size).toBe(report.items.length); // 无重复 id
    expect(report.summary.baselineDrift + report.summary.consistency + report.summary.overrideRecord)
      .toBe(report.items.length - 1); // 其余 1 项为 runtime-info

    for (const item of report.items) {
      expect(BASE_ENUM).toContain(item.base);
      expect(SEMANTICS_ENUM).toContain(item.semantics);
      expect(SEVERITY_ENUM).toContain(item.severity);
      expect(ACTION_ENUM).toContain(item.action);
      expect(typeof item.label).toBe('string');
      expect(typeof item.status).toBe('string');
      expect(typeof item.count).toBe('number');
      expect(Array.isArray(item.detail)).toBe(true);
      expect(typeof item.cause).toBe('string');
      expect(typeof item.fixHint).toBe('string');
      expect(typeof item.source).toBe('string');
    }
  });

  it('逐项 base/semantics 断言（基准体系速查表）', async () => {
    const report = await buildHealthCenterReport(EMPTY_DB);
    const byId = new Map(report.items.map((item) => [item.id, item]));

    for (const [id, base] of Object.entries(EXPECTED_BASE_BY_ID)) {
      const item = byId.get(id);
      expect(item).toBeTruthy();
      expect(item!.base).toBe(base);
    }
    for (const [id, semantics] of Object.entries(EXPECTED_SEMANTICS_BY_ID)) {
      const item = byId.get(id);
      expect(item).toBeTruthy();
      expect(item!.semantics).toBe(semantics);
    }
  });

  it('验收口径：W4 当前 0 → ok；fields-sync 存量孤儿 5 → consistency warn；覆盖行 0 → info', async () => {
    const report = await buildHealthCenterReport(EMPTY_DB);
    const byId = new Map(report.items.map((item) => [item.id, item]));

    const w4 = byId.get('w4-corehash')!;
    expect(w4.count).toBe(0);
    expect(w4.severity).toBe('ok');
    expect(w4.semantics).toBe('baseline-drift');
    expect(w4.action).toBe('fixable');

    const fieldsSync = byId.get('fields-sync')!;
    expect(fieldsSync.semantics).toBe('consistency');
    expect(fieldsSync.base).toBe('bidirectional');
    // 存量孤儿 5 条（path-planning 3 + virtual-learner-scenario-designer 2，真实漂移保留报）
    expect(fieldsSync.count).toBe(5);
    expect(fieldsSync.severity).toBe('warn');
    expect(fieldsSync.status).toBe('orphan');
    expect(fieldsSync.action).toBe('manual');

    const overrideRecord = byId.get('override-record')!;
    expect(overrideRecord.semantics).toBe('override-record');
    expect(overrideRecord.base).toBe('db:managed');
    expect(overrideRecord.severity).toBe('info');
    expect(overrideRecord.count).toBe(0);
    expect(overrideRecord.status).toBe('none');
    expect(overrideRecord.action).toBe('none');

    const runtime = byId.get('runtime-prompt')!;
    expect(runtime.semantics).toBe('runtime-info');
    expect(runtime.base).toBe('runtime');
    expect(runtime.severity).toBe('info');

    // baseline-drift 各项 action 归属：可修 4 项，人工 3 项（contract-parity/yaml/params）
    expect(report.items.filter((i) => i.semantics === 'baseline-drift').map((i) => i.action).sort())
      .toEqual(['fixable', 'fixable', 'fixable', 'fixable', 'manual', 'manual', 'manual']);
  });

  it('文案运营语守卫：label/cause/fixHint 不再包含源码内部锚点（file:line / 表名 / 内部编号）', async () => {
    const report = await buildHealthCenterReport(EMPTY_DB);
    const sourceAnchors = ['deriveContract(', 'managedByCode', 'prompt_call_logs', 'B3', 'B5', 'P4 ', 'P5', 'zombie', 'file:line', 'diff', 'EXEMPT_PLATFORM_ROOTS', 'W3_STEPS_EMPTY_EXEMPT', 'registrationPoint', 'base='];
    // file:line 锚点（如 orchestration-file.ts:182）；纯文件路径（如 definition.ts / skills/index.ts）是"调整 xx 文件"的合法操作语，不禁
    const anchorPattern = /\.(ts|js):\d+/;
    for (const item of report.items) {
      for (const text of [item.label, item.cause, item.fixHint, item.detail.join('\n')]) {
        expect(text.match(anchorPattern)).toBeNull();
        for (const anchor of sourceAnchors) {
          expect(text).not.toContain(anchor);
        }
        // 每条 cause 都以运营可懂的中文短语开头（不是括号/编号开头）
        expect(/^[（(【\d]/.test(text)).toBe(false);
      }
    }
  });

  it('术语统一：漂移三义在健康区 label 上区分（契约漂移 / W4 漂移 / 运行时漂移）', async () => {
    const report = await buildHealthCenterReport(EMPTY_DB);
    const byId = new Map(report.items.map((item) => [item.id, item]));
    const contractItem = byId.get('field-routing-contract')!;
    expect(contractItem.base).toBe('file:manifest');
    // label 为人话「契约漂移」，不再是黑话「P4：declared 来自 deriveContract(manifest)」
    expect(contractItem.label).toContain('契约漂移');
    expect(contractItem.label).not.toContain('deriveContract');
    expect(contractItem.label).not.toContain('P4');
    expect(contractItem.label).not.toContain('合同');
    const fieldItem = byId.get('field-routing')!;
    expect(fieldItem.base).toBe('file:orchestration');
    const w4 = byId.get('w4-corehash')!;
    expect(w4.label).toContain('W4 漂移');
    const runtime = byId.get('runtime-prompt')!;
    expect(runtime.label).toContain('运行时漂移');
    // 三个漂移语义各自有独立 label，不合并
    const labels = new Set([contractItem.label, w4.label, runtime.label]);
    expect(labels.size).toBe(3);
  });

  it('缓存：60s 内复用，refresh 强制重算', async () => {
    const first = await getHealthCenterReport(EMPTY_DB);
    const second = await getHealthCenterReport(EMPTY_DB);
    expect(second).toBe(first); // 命中缓存（同一对象引用）

    resetHealthCenterCache();
    const third = await getHealthCenterReport(EMPTY_DB, { skipCache: true });
    expect(third).not.toBe(first);
    expect(third.generatedAt).toBeTruthy();
  });
});

describe('健康中心一键修复（POST /fix 分支）', () => {
  function makeDeps(overrides: Partial<HealthCenterFixDeps> = {}): HealthCenterFixDeps {
    return {
      compileAllCorePromptFiles: jest.fn().mockResolvedValue(['prompts/skill.path-planning.md']),
      ensureCoreAgentPromptsSync: jest.fn().mockResolvedValue({ mode: 'sync', created: [], updated: [] }),
      syncAllFieldRoutings: jest.fn().mockResolvedValue([
        { stage: 'goal', contractsUpdated: 0, fieldsUpdated: 0, routingsUpdated: 0, contractsCreated: 0, fieldsCreated: 0, routingsCreated: 0, createdCount: 0, skippedAdminRows: [] },
      ]),
      renderAgentSnapshots: jest.fn().mockResolvedValue('# agent-snapshots\nrendered'),
      writeAgentSnapshots: jest.fn().mockResolvedValue('prompts/agent-snapshots.md'),
      ...overrides,
    };
  }

  function tempBackupRoot(): string {
    return path.join(os.tmpdir(), `health-center-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }

  it('manual 类（params-consistency）→ 409 + 指引，不执行任何修复 deps', async () => {
    const db: HealthCenterDbAdapter = {
      ...EMPTY_DB,
      node_config_changes: { create: jest.fn() },
    };
    const deps = makeDeps();
    const result = await runHealthCenterFix({ db, id: 'params-consistency', deps, backupsRoot: tempBackupRoot() });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(409);
      expect(result.fixHint).toContain('definition.ts');
    }
    expect(deps.compileAllCorePromptFiles).not.toHaveBeenCalled();
    expect(deps.syncAllFieldRoutings).not.toHaveBeenCalled();
    expect(db.node_config_changes.create).not.toHaveBeenCalled();
  });

  it('consistency 项（fields-sync/w1/w2/w3）→ 409 + 人工指引', async () => {
    for (const id of ['fields-sync', 'w1-active', 'w2-registration', 'w3-wiring']) {
      const result = await runHealthCenterFix({ db: EMPTY_DB, id, deps: makeDeps(), backupsRoot: tempBackupRoot() });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.status).toBe(409);
        expect(result.fixHint).toBeTruthy();
      }
    }
  });

  it('readonly 项（override-record / runtime-prompt）→ 409 只读', async () => {
    for (const id of ['override-record', 'runtime-prompt']) {
      const result = await runHealthCenterFix({ db: EMPTY_DB, id, deps: makeDeps(), backupsRoot: tempBackupRoot() });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.status).toBe(409);
      }
    }
  });

  it('未知 id → 404', async () => {
    const result = await runHealthCenterFix({ db: EMPTY_DB, id: 'does-not-exist', deps: makeDeps() });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(404);
  });

  it('fixable 白名单 = w4-corehash / field-routing / field-routing-contract / snapshots', () => {
    expect([...HEALTH_CENTER_FIXABLE_IDS].sort()).toEqual(
      ['field-routing', 'field-routing-contract', 'snapshots', 'w4-corehash'],
    );
  });

  it('w4-corehash：备份 → 重编译 + DB sync → 复检 → 审计写入（changeType=health-fix, actorId）', async () => {
    const backupRoot = tempBackupRoot();
    const db: HealthCenterDbAdapter = {
      ...EMPTY_DB,
      node_config_changes: { create: jest.fn().mockResolvedValue({ id: 'audit-health-fix-1' }) },
    };
    const deps = makeDeps();
    const result = await runHealthCenterFix({ db, id: 'w4-corehash', deps, actorId: 'tester', backupsRoot: backupRoot });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe('w4-corehash');
      expect(result.fixed).toBe(true);
      expect(result.before.severity).toBe('ok');
      expect(result.after.severity).toBe('ok');
      expect(result.backupDir).toBeTruthy();
      expect(result.backupDir).toContain('health-center-fix-'); // 测试用临时 backupsRoot
      expect(result.gitCommitHint).toContain('git 提交');
      expect(result.auditId).toBe('audit-health-fix-1');
    }
    expect(deps.compileAllCorePromptFiles).toHaveBeenCalledTimes(1);
    expect(deps.ensureCoreAgentPromptsSync).toHaveBeenCalledTimes(1);

    // 备份目录存在且包含 skill.*.md（仓库内 prompts/skill.*.md 真实存在）
    const dirs = fs.readdirSync(backupRoot);
    const tsDir = dirs[0];
    const files = fs.readdirSync(path.join(backupRoot, tsDir));
    expect(files.some((f) => /^skill\..*\.md$/.test(f))).toBe(true);

    const auditArgs = (db.node_config_changes.create as jest.Mock).mock.calls[0][0];
    expect(auditArgs.data.changeType).toBe('health-fix');
    expect(auditArgs.data.targetTable).toBe('health-center');
    expect(auditArgs.data.targetId).toBe('w4-corehash');
    expect(auditArgs.data.actorId).toBe('tester');
    expect(JSON.parse(auditArgs.data.before)).toMatchObject({ severity: 'ok' });
    expect(JSON.parse(auditArgs.data.after)).toMatchObject({ severity: 'ok' });
  });

  it('field-routing / field-routing-contract：全量对账 + 审计', async () => {
    for (const id of ['field-routing', 'field-routing-contract']) {
      const db: HealthCenterDbAdapter = {
        ...EMPTY_DB,
        node_config_changes: { create: jest.fn().mockResolvedValue({ id: `audit-${id}` }) },
      };
      const deps = makeDeps();
      const result = await runHealthCenterFix({ db, id, deps, backupsRoot: tempBackupRoot() });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.fixed).toBe(true);
        expect(result.gitCommitHint).toContain('无 git 跟踪文件改动');
      }
      expect(deps.syncAllFieldRoutings).toHaveBeenCalledTimes(1);
      expect(db.node_config_changes.create).toHaveBeenCalledTimes(1);
    }
  });

  it('snapshots：备份 agent-snapshots.md → 重生成 → 审计', async () => {
    const backupRoot = tempBackupRoot();
    const db: HealthCenterDbAdapter = {
      ...EMPTY_DB,
      node_config_changes: { create: jest.fn().mockResolvedValue({ id: 'audit-snapshots' }) },
    };
    const deps = makeDeps();
    const result = await runHealthCenterFix({ db, id: 'snapshots', deps, backupsRoot: backupRoot });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixed).toBe(true);
      expect(result.backupDir).toBeTruthy();
      expect(result.backupDir).toContain('health-center-fix-'); // 测试用临时 backupsRoot
      expect(result.gitCommitHint).toContain('git 提交');
    }
    expect(deps.renderAgentSnapshots).toHaveBeenCalledTimes(1);
    expect(deps.writeAgentSnapshots).toHaveBeenCalledTimes(1);
    expect(db.node_config_changes.create).toHaveBeenCalledTimes(1);
  });

  it('修复后缓存被重置（下次 GET 强制重算）', async () => {
    await getHealthCenterReport(EMPTY_DB);
    const db: HealthCenterDbAdapter = {
      ...EMPTY_DB,
      node_config_changes: { create: jest.fn().mockResolvedValue({ id: 'audit-reset' }) },
    };
    await runHealthCenterFix({ db, id: 'snapshots', deps: makeDeps(), backupsRoot: tempBackupRoot() });
    // 缓存已清空：下一次读取不再复用旧报告对象
    const fresh = await getHealthCenterReport(EMPTY_DB);
    expect(fresh.generatedAt).toBeTruthy();
  });
});
