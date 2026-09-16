/**
 * 前端术语单源守卫（阶段 1D + 治理强化）
 *
 * 职责（doc/ADMIN_TERMINOLOGY_AUDIT.md §4）：
 * 1. terms.ts 常量表存在且包含统一后的关键术语（漂移三义 / 同步族 / 状态族 / 健康族）；
 * 2. 漂移三义常量值互不相同（契约漂移 / 哈希漂移 / 遥测漂移不得合并文案）；
 * 3. 漂移/同步族关键页面必须 import terms.ts（文案单源引用）；
 * 4. 禁用叫法/黑话不出现——扫描 admin-redesign 下**全部 .vue**（不再硬编码文件清单）；
 * 5. 枚举直出守卫：模板文本不得直出英文枚举值（degraded/visible/hidden/draft/…）；
 * 6. 表头守卫：<th> 不得为 camelCase 字段名（工程明细 tab 放行）；
 * 7. 文档引用守卫：源码中 doc/*.md 必须真实存在。
 *
 * 纯文本守卫：不执行前端代码，仅 fs 读取源码断言。
 */
import * as fs from 'fs';
import * as path from 'path';

const ADMIN_REDESIGN_DIR = path.resolve(__dirname, '../../../../frontend/src/views/admin-redesign');
const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** 读取 admin-redesign 下相对路径文件（正斜杠） */
function read(rel: string): string {
  return fs.readFileSync(path.join(ADMIN_REDESIGN_DIR, rel), 'utf-8');
}

/** 递归列出源码文件（.vue / .ts），跳过 __tests__ */
function listSourceFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listSourceFiles(path.join(dir, entry.name), rel));
    } else if (/\.(vue|ts)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** 仅 .vue（模板守卫用；含 terms.ts 由调用方显式补充） */
const listVueFiles = (dir: string, prefix = ''): string[] =>
  listSourceFiles(dir, prefix).filter((f) => f.endsWith('.vue'));

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

  it('禁用叫法/黑话不出现在页面源码（全目录 .vue 扫描）', () => {
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
    const files = [...listVueFiles(ADMIN_REDESIGN_DIR), 'terms.ts'];
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const src = read(file);
      for (const b of banned) {
        expect(src).not.toContain(b);
      }
    }
  });

  it('状态词单源：私有字典/格式化函数不得把 running 译成「运行中」（单源 statusText → 进行中）', () => {
    // 不断言「运行中」这个子串本身：自由文本里的「运行中的 Prompt」「已在系统运行中注册」
    // 是运行时/线上语义，不是 running 状态；「运行中…」是动词进行态。
    // 只禁止把它当成 running 的**译名**（私有字典 / 格式化 return / 计数模板）。
    const patterns = [
      /running['"]?\s*:\s*['"]运行中/, // 私有字典 { running: '运行中' }
      /'running'\)\s*return\s*['"]运行中/, // 私有格式化 if (r === 'running') return '运行中'
      /运行中\s*\{\{/, // 计数模板「运行中 {{ n }}」
      /运行中\s*\$\{/, // 模板串里的「… 运行中 ${n}」
    ];
    const files = listSourceFiles(ADMIN_REDESIGN_DIR);
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const src = read(file);
      for (const re of patterns) {
        const hit = src.match(re);
        // jest 的 expect 无消息参数：把「文件 + 命中片段」放进实际值，失败时可直接定位
        expect(hit ? `${file} 命中「${hit[0]}」` : null).toBeNull();
      }
    }
    // 单源本身：running 的权威译名
    expect(read('statusText.ts')).toContain("running: '进行中'");
  });

  it('枚举直出守卫：模板文本不得直出英文枚举值', () => {
    const bareEnums = ['degraded', 'visible', 'hidden', 'draft', 'archived', 'published', 'pending', 'offline'];
    for (const file of listVueFiles(ADMIN_REDESIGN_DIR)) {
      const src = read(file);
      for (const e of bareEnums) {
        expect(src).not.toContain(`>${e}<`);
      }
    }
  });

  it('表头守卫：<th> 不得为 camelCase 字段名（字段名降级到 title / 括号）', () => {
    const allow = new Set(['IP', 'XP', 'ID', 'ACTIVE']);
    for (const file of listVueFiles(ADMIN_REDESIGN_DIR)) {
      const src = read(file);
      // 可排序表头会在 <th> 内嵌套 <button>/<span>：先剥离内层标签，再校验文本标签
      const re = /<th\b[^>]*>([\s\S]*?)<\/th>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const text = m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text || allow.has(text)) continue;
        expect(/[a-z][A-Z]/.test(text)).toBe(false);
      }
    }
  });

  it('文档引用守卫：源码中 doc/*.md 必须真实存在', () => {
    const refs = new Set<string>();
    for (const file of listSourceFiles(ADMIN_REDESIGN_DIR)) {
      const src = read(file);
      const re = /doc\/[A-Za-z0-9_./-]+\.md/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) refs.add(m[0]);
    }
    // 守卫自身/术语表引用的真源
    refs.add('doc/ADMIN_TERMINOLOGY_AUDIT.md');
    expect(refs.size).toBeGreaterThan(0);
    for (const r of refs) {
      expect(fs.existsSync(path.join(REPO_ROOT, r))).toBe(true);
    }
  });
});
