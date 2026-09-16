/**
 * 只编译**一个**核心文件 → `prompts/skill.<skillId>.md`。
 *
 * 为什么需要它：`prompts:compile-all` 会无条件重写全部 `skill.*.md`，
 * 在并行开发期间会把别人正在改的 skill 文件一起盖掉（不可接受的副作用）。
 * 改某个 `prompts/core/*.yaml` 时，用本脚本只重编译它对应的那一个产物，再跑 `prompts:sync`。
 *
 * 安全性：
 * - 保留产物里既有的 `coreVersion`（与 compile-all 同口径），避免把已发布版本重置为 1；
 * - **默认 dry-run**：只报告"会不会有变化"，不加 `--write` 不落盘；
 * - 找不到对应 skillId 时报错，不改任何文件。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/compile-core-file.ts --skill=teaching-turn            # 预演（不写）
 *   npx ts-node --transpile-only src/scripts/compile-core-file.ts --skill=teaching-turn --write    # 落盘
 */
import fs from 'fs/promises';
import path from 'path';
import { scanCoreFiles, CORE_FILES_DIR } from '../services/prompt-lab/core-file-loader';
import { compileCoreFile } from '../services/prompt-lab/core-compiler';

const PROMPTS_DIR = path.resolve(CORE_FILES_DIR, '..');
const CORE_VERSION_RE = /^coreVersion:\s*(\d+)\s*$/m;

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function readExistingCoreVersion(filePath: string): Promise<number> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    const match = existing.match(CORE_VERSION_RE);
    return match ? Number(match[1]) : 1;
  } catch {
    return 1;
  }
}

async function main(): Promise<void> {
  const skillId = arg('skill');
  const write = process.argv.includes('--write');
  if (!skillId) throw new Error('缺少 --skill=<skillId>（例如 --skill=teaching-turn）');

  const scan = scanCoreFiles();
  if (scan.diagnostics.length > 0) {
    throw new Error(
      `核心文件存在 schema 错误：${scan.diagnostics.map((d) => `${d.filePath}: ${d.message}`).join('; ')}`,
    );
  }
  const core = scan.files.find((file) => file.skillId === skillId);
  if (!core) {
    throw new Error(`找不到 skillId=${skillId} 的核心文件（可用：${scan.files.map((f) => f.skillId).join(', ')}）`);
  }

  const filePath = path.join(PROMPTS_DIR, `skill.${core.skillId}.md`);
  const coreVersion = await readExistingCoreVersion(filePath);
  const compiled = compileCoreFile(core, { coreVersion });

  const previous = await fs.readFile(filePath, 'utf-8').catch(() => null);
  const changed = previous !== compiled.prompt;

  if (!changed) {
    console.log(JSON.stringify({ success: true, skillId, filePath, changed: false, note: '产物已是最新（零改动）' }, null, 2));
    return;
  }
  if (!write) {
    console.log(JSON.stringify({ success: true, skillId, filePath, changed: true, wrote: false, coreVersion, note: '预演：加 --write 才落盘' }, null, 2));
    return;
  }
  await fs.writeFile(filePath, compiled.prompt, 'utf-8');
  console.log(JSON.stringify({ success: true, skillId, filePath, changed: true, wrote: true, coreVersion }, null, 2));
}

main().catch((error) => {
  console.error('[compile-core-file] 失败', error);
  process.exitCode = 1;
});
