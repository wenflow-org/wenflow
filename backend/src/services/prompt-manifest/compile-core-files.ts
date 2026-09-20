/**
 * 生成所有核心文件的确定性 Runtime Prompt 文件。
 * 仅写 prompts/skill.<skillId>.md；DB ACTIVE 仍由 publish-core 或启动 seed 处理。
 */
import fs from 'fs/promises';
import path from 'path';
import { scanCoreFiles, CORE_FILES_DIR } from '../../services/prompt-lab/core-file-loader';
import { compileCoreFile } from '../../services/prompt-lab/core-compiler';

const PROMPTS_DIR = path.resolve(CORE_FILES_DIR, '..');

const CORE_VERSION_RE = /^coreVersion:\s*(\d+)\s*$/m;

/**
 * 编译产物（skill.<id>.md）的 coreVersion 由发布流程（publish-core）递增；
 * 本脚本只做确定性重编译，必须保留既有版本号，否则会把已发布版本重置为 1。
 */
async function readExistingCoreVersion(filePath: string): Promise<number> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    const match = existing.match(CORE_VERSION_RE);
    return match ? Number(match[1]) : 1;
  } catch {
    return 1;
  }
}

export async function compileAllCorePromptFiles(): Promise<string[]> {
  const scan = scanCoreFiles();
  if (scan.diagnostics.length > 0) {
    throw new Error(`核心文件存在 schema 错误：${scan.diagnostics.map((d) => `${d.filePath}: ${d.message}`).join('; ')}`);
  }

  const written: string[] = [];
  for (const core of scan.files) {
    const filePath = path.join(PROMPTS_DIR, `skill.${core.skillId}.md`);
    const coreVersion = await readExistingCoreVersion(filePath);
    const compiled = compileCoreFile(core, { coreVersion });
    await fs.writeFile(filePath, compiled.prompt, 'utf-8');
    written.push(filePath);
  }
  return written;
}

if (require.main === module) {
  void compileAllCorePromptFiles()
    .then((files) => {
      console.log(JSON.stringify({ success: true, count: files.length }, null, 2));
    })
    .catch((error) => {
      console.error('[compile-core-files] 失败', error);
      process.exitCode = 1;
    });
}
