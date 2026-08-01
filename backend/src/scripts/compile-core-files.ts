/**
 * 生成所有核心文件的确定性 Runtime Prompt 文件。
 * 仅写 prompts/skill.<skillId>.md；DB ACTIVE 仍由 publish-core 或启动 seed 处理。
 */
import fs from 'fs/promises';
import path from 'path';
import { scanCoreFiles, CORE_FILES_DIR } from '../services/prompt-lab/core-file-loader';
import { compileCoreFile } from '../services/prompt-lab/core-compiler';

const PROMPTS_DIR = path.resolve(CORE_FILES_DIR, '..');

export async function compileAllCorePromptFiles(): Promise<string[]> {
  const scan = scanCoreFiles();
  if (scan.diagnostics.length > 0) {
    throw new Error(`核心文件存在 schema 错误：${scan.diagnostics.map((d) => `${d.filePath}: ${d.message}`).join('; ')}`);
  }

  const written: string[] = [];
  for (const core of scan.files) {
    const compiled = compileCoreFile(core, { coreVersion: 1 });
    const filePath = path.join(PROMPTS_DIR, `skill.${core.skillId}.md`);
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
