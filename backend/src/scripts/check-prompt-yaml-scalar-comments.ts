/**
 * 只读门禁：core 提示词里的「裸列表标量含 ` #`」——YAML 会把 ` #` 当注释起点，
 * 整条规则的实质条款从此消失，而 prompts:lint / prompts:core:check 仍然全绿。
 *
 * 2026-11-07 实证（本案 lp_1793957582347_jm6v754）：
 *   `- 相邻轮不得复述已教内容（语义卡环，2026-10-19 #103）：上一条教师回复已经讲过的…`
 *   → 运行时 system prompt 里只剩 29 字「相邻轮不得复述已教内容（语义卡环，2026-10-19」，
 *      「每轮必须带来至少一项真实增量」「连续两轮同义立即改为让学生产出」全部丢失。
 *   编译产物 prompts/skill.teaching-turn.md 里 grep「改为让学生产出」= 0，而 core.yaml = 1。
 *
 * 判定：core/*.yaml 里**列表项**（`- …`，且未加引号、不是块标量）的标量内部出现 ` #`。
 *   - 块标量（`|` / `>`）内部的 ` #` 不受影响，不判。
 *   - `key: value # 注释` 是合法的行尾注释，不判。
 *   - 若你确实想在规则行留行尾注释：把注释移到**上一行**，或给标量两端加半角双引号。
 *
 * 用法：npx ts-node src/scripts/check-prompt-yaml-scalar-comments.ts
 */
import * as fs from 'fs';
import * as path from 'path';

interface Hit {
  file: string;
  line: number;
  kept: string;
  eaten: string;
}

function scanFile(filePath: string, label: string): Hit[] {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const hits: Hit[] = [];
  raw.split('\n').forEach((line, index) => {
    const match = /^\s*-\s+(\S.*)$/.exec(line);
    if (!match) return;
    const item = match[1];
    // 已加引号 = 安全；块标量头（| / >）不适用
    if (item.startsWith('"') || item.startsWith("'") || item.startsWith('|') || item.startsWith('>')) return;
    const at = item.indexOf(' #');
    if (at === -1) return;
    hits.push({
      file: label,
      line: index + 1,
      kept: item.slice(0, at),
      eaten: item.slice(at),
    });
  });
  return hits;
}

function main(): void {
  const dir = path.resolve(__dirname, '../../../prompts/core');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.yaml'));
  const hits: Hit[] = [];
  for (const name of files) {
    hits.push(...scanFile(path.join(dir, name), `prompts/core/${name}`));
  }

  if (!hits.length) {
    console.log(`[yaml-scalar] OK：扫描 ${files.length} 个 core 文件，未发现裸列表标量含「 #」`);
    return;
  }

  console.error('[yaml-scalar] FAIL：以下列表标量里的「 #」会被 YAML 当注释起点，正文被截断——');
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}`);
    console.error(`    运行时只保留: ${hit.kept}`);
    console.error(`    被吃掉: ${hit.eaten}`);
  }
  console.error('修法：给标量两端加半角双引号；若那是行尾注释，请把注释移到上一行。');
  process.exitCode = 1;
}

main();
