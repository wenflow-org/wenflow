/**
 * 前端术语单源守卫（阶段 1D：漂移族 / 同步族）
 *
 * 职责（doc/ADMIN_TERMINOLOGY_AUDIT.md §4.3）：
 * 1. 前端 terms.ts 常量表存在且包含统一后的关键术语（漂移三义 / 同步族 / 状态族 / 健康族）；
 * 2. 漂移三义常量值互不相同（契约漂移 / 哈希漂移 / 遥测漂移不得合并文案）；
 * 3. 页面与后端运营文案不再出现禁用叫法/黑话（强制同步 DB、版本不一致、dry-run：、
 *    managedByCode=false、deriveContract(、F3 铁律、check-core-fields-sync、base=file: 等）；
 * 4. 漂移/同步族关键页面必须 import terms.ts（文案单源引用）。
 *
 * 纯文本守卫：不执行前端代码，仅 fs 读取源码断言。
 */
import * as fs from 'fs';
import * as path from 'path';

const ADMIN_REDESIGN_DIR = path.resolve(__dirname, '../../../../frontend/src/views/admin-redesign');

function read(rel: string): string {
  return fs.readFileSync(path.join(ADMIN_REDESIGN_DIR, rel), 'utf-8');
}

describe('前端术语单源守卫（阶段 1D）', () => {
  it('terms.ts 包含统一后的关键术语常量（漂移族 / 同步族 / 状态族 / 健康族）', () => {
    const src = read('terms.ts');
    const expected: Array<[string, string]> = [
      ["driftContract: '漂移'", '漂移主叫法（文件↔DB）'],
      ["driftContractQualified: '契约漂移'", '契约漂移限定词'],
      ["driftHash: 'W4 漂移'", 'W4 漂移（哈希）'],
      ["driftHashQualified: '哈希漂移'", '哈希漂移限定词'],
      ["driftRuntime: '运行时漂移'", '运行时漂移（遥测）'],
      ["driftTab: '漂移与审计'", '漂移与审计 tab'],
      ["syncToDb: '同步到 DB'", '同步按钮（文件→DB 生效动作）'],
      ["syncDone: '同步完成'", '同步完成提示'],
      ["saveToFile: '保存到编排文件'", '保存到编排文件'],
      ["publish: '发布'", '发布'],
      ["reconcile: '对账'", '对账'],
      ["statusMissing: '缺项'", '缺项'],
      ["statusOrphan: '孤儿'", '孤儿'],
      ["fieldsSynced: '字段已同步'", '字段已同步'],
      ["healthScore: '今日成功率'", '今日成功率（原健康分）'],
    ];
    for (const [frag, name] of expected) {
      expect(src).toContain(frag);
    }
  });

  it('漂移三义常量互不相同（契约/哈希/遥测不得合并文案）', () => {
    const src = read('terms.ts');
    const keys = ['driftContract', 'driftContractQualified', 'driftHash', 'driftHashQualified', 'driftRuntime'];
    const vals = keys.map((k) => src.match(new RegExp(`\\b${k}: '([^']+)'`))?.[1]);
    expect(vals.every((v) => typeof v === 'string')).toBe(true);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('漂移/同步族关键页面必须引用 terms.ts（文案单源）', () => {
    const mustImport = [
      'FieldRoutingTable.vue',
      'SkillFieldRouting.vue',
      'SkillDesignPage.vue',
      'ExecLogs.vue',
      'TraceWaterfall.vue',
      'HealthCenter.vue',
      'DriftAuditPanel.vue',
      'Overview.vue',
      'Orchestrator.vue',
      'FieldAddWizard.vue',
    ];
    for (const file of mustImport) {
      expect(read(file)).toContain("from './terms'");
    }
  });

  it('禁用叫法/黑话不出现在页面源码（漂移/同步/状态/健康族）', () => {
    const banned = [
      '强制同步 DB',
      '版本不一致',
      'fields-synced ✓',
      'dry-run：',
      'managedByCode=false',
      'deriveContract(',
      'F3 铁律',
      'check-core-fields-sync',
      'base=file:',
      'node_config_changes / orchestration-prune',
      '落库对账',
      '合同维度',
      '健康分 = 今日',
      'P4：declared',
    ];
    const frontendFiles = [
      'FieldRoutingTable.vue',
      'SkillFieldRouting.vue',
      'SkillDesignPage.vue',
      'ExecLogs.vue',
      'TraceWaterfall.vue',
      'HealthCenter.vue',
      'DriftAuditPanel.vue',
      'Overview.vue',
      'Orchestrator.vue',
      'FieldAddWizard.vue',
      'terms.ts',
    ];
    for (const file of frontendFiles) {
      const src = read(file);
      for (const b of banned) {
        expect(src).not.toContain(b);
      }
    }
  });
});
