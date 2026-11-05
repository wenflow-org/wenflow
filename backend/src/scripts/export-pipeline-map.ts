/**
 * 全管线地图导出 CLI：`npm run pipeline:map` / `pipeline:map:check`。
 * 实现见 services/prompt-manifest/pipeline-map.ts（scripts 只留纯运维入口）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildPipelineMap, renderPipelineMarkdown, renderPromptsMarkdown } from '../services/prompt-manifest/pipeline-map';

function main(): void {
  const check = process.argv.includes('--check');
  const root = path.resolve(__dirname, '..', '..', '..');
  const markdownPath = path.join(root, 'doc', 'PIPELINE_MAP.md');
  const jsonPath = path.join(root, 'doc', 'pipeline-map.json');
  const promptsPath = path.join(root, 'doc', 'PIPELINE_PROMPTS.md');

  const map = buildPipelineMap();
  const markdown = renderPipelineMarkdown(map);
  const json = JSON.stringify(map, null, 2) + '\n';
  const prompts = renderPromptsMarkdown(map);

  const artifacts: Array<[string, string]> = [
    ['doc/PIPELINE_MAP.md', markdown],
    ['doc/pipeline-map.json', json],
    ['doc/PIPELINE_PROMPTS.md', prompts],
  ];

  if (check) {
    const drift: string[] = [];
    for (const [rel, content] of artifacts) {
      const file = path.join(root, rel);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (current !== content) drift.push(rel);
    }
    if (drift.length) {
      console.error(`[pipeline-map] 生成物已过期：${drift.join('、')}`);
      console.error('[pipeline-map] 运行 npm --prefix backend run pipeline:map 重新生成。');
      process.exit(1);
    }
    console.log('[pipeline-map] 生成物与源一致。');
    return;
  }

  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(promptsPath, prompts);
  console.log(`[pipeline-map] 已生成：doc/PIPELINE_MAP.md / doc/pipeline-map.json / doc/PIPELINE_PROMPTS.md`);
  console.log(`[pipeline-map] 共 ${map.stages.length} 阶段 / ${map.prompts.length} 个 Skill 条目，其中 ${map.counts.prompts} 篇提示词正文。`);
}

main();
