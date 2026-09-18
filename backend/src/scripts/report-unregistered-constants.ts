/**
 * 未登记常量只读报告（不阻塞 CI）：`npm run constants:report`
 *
 * 与 `check-constants-provenance` 的关系：
 * - 检查脚本守的是**已登记项**（value==resolve、mirrors 不分叉、文献必带 ref），失败即拦 CI；
 * - 本脚本是**普查**：扫描 learner / learning / memory 三个状态回路目录里
 *   「模块级数字常量」（`const NAME = <数字>;`，含 `export const`），把**未出现在登记表**
 *   的列出来。它**只报告、不失败**（退出码恒 0），避免把历史存量噪音变成 CI 红灯。
 *
 * 判定「已登记」的口径：常量名在 `constants-provenance.ts` 源码中出现过。
 * 因为登记项都通过 `resolve: () => SOME_CONST` / `mirrors` 引用真实符号，符号名必现于源码。
 * 这是**名字面量**判定而非语义判定——报告只用于人工挑选下一批要登记的常量，不做强约束。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface NumericConstantFinding {
  name: string;
  value: number;
  /** 相对仓库 backend 根的路径（正斜杠） */
  file: string;
  /** 1-based 行号 */
  line: number;
}

export interface UnregisteredReport {
  /** 按文件分组；只含存在未登记常量的文件 */
  byFile: Array<{ file: string; items: NumericConstantFinding[] }>;
  /** 发现的模块级数字常量总数 */
  scanned: number;
  /** 其中已登记数 */
  registered: number;
  /** 其中未登记数（= 各分组条目之和） */
  unregistered: number;
}

/**
 * 只匹配**顶格**（无前导空白）的数字常量声明，从而排除函数体内的局部常量：
 *   `const X = 1;` / `export const X = 1;` / `export const X = 1 as const;`
 * 支持小数、科学计数、数字分隔符与负号。
 */
const NUMERIC_MODULE_CONST_RE =
  /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(?:as\s+const)?\s*;/;

export function findNumericModuleConstants(source: string, file: string): NumericConstantFinding[] {
  const findings: NumericConstantFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = NUMERIC_MODULE_CONST_RE.exec(lines[index]);
    if (!match) continue;
    const value = Number(match[2].replace(/_/g, ''));
    if (!Number.isFinite(value)) continue;
    findings.push({ name: match[1], value, file, line: index + 1 });
  }
  return findings;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 常量名是否在登记表源码中被引用（即已登记） */
export function isRegisteredConstantName(name: string, registrySource: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(registrySource);
}

export function buildUnregisteredReport(input: {
  files: Array<{ file: string; source: string }>;
  registrySource: string;
}): UnregisteredReport {
  const byFile: Array<{ file: string; items: NumericConstantFinding[] }> = [];
  let scanned = 0;
  let registered = 0;

  for (const { file, source } of input.files) {
    const findings = findNumericModuleConstants(source, file);
    const unregistered = findings.filter(
      (finding) => !isRegisteredConstantName(finding.name, input.registrySource),
    );
    scanned += findings.length;
    registered += findings.length - unregistered.length;
    if (unregistered.length > 0) byFile.push({ file, items: unregistered });
  }

  const unregistered = byFile.reduce((sum, group) => sum + group.items.length, 0);
  return { byFile, scanned, registered, unregistered };
}

const SCAN_DIRS = ['learner', 'learning', 'memory'] as const;

function collectSourceFiles(rootDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(full);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(rootDir, 'services', dir));
  return files.sort();
}

function main() {
  // __dirname 在 ts-node 下 = backend/src/scripts
  const srcRoot = path.resolve(__dirname, '..');
  const backendRoot = path.resolve(srcRoot, '..');
  const files = collectSourceFiles(srcRoot).map((absolute) => ({
    file: path.relative(backendRoot, absolute).split(path.sep).join('/'),
    source: fs.readFileSync(absolute, 'utf8'),
  }));
  const registrySource = fs.readFileSync(
    path.join(srcRoot, 'config', 'constants-provenance.ts'),
    'utf8',
  );

  const report = buildUnregisteredReport({ files, registrySource });

  if (report.byFile.length === 0) {
    console.log('[constants:report] 扫描范围内所有模块级数字常量都已登记。');
  } else {
    console.log('[constants:report] 未登记常量（只读报告，不阻塞 CI）：');
    for (const group of report.byFile) {
      console.log(`\n  ${group.file}`);
      for (const item of group.items) {
        console.log(`    - ${item.name} = ${item.value}  (${item.file}:${item.line})`);
      }
    }
  }

  console.log(
    `\n[constants:report] 汇总：扫描 ${report.scanned} 个模块级数字常量，`
    + `已登记 ${report.registered}，未登记 ${report.unregistered}（分布在 ${report.byFile.length} 个文件）。`,
  );
  // 只报告、不失败
  process.exit(0);
}

if (require.main === module) {
  main();
}
