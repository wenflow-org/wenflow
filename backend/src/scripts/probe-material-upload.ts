/**
 * 上传资料解析验收探针：拿真件（含「无文本层」坏例）跑 `parseDocument`，打印闸门判定。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/probe-material-upload.ts [目录]
 *
 * 验收口径（2026-09-22）：
 *   - 文本型真件 → ok，且结构（小标题/表格/页数）与章节锚点被抽出；
 *   - 无文本层样本（MIT 讲义 PDF）→ **rejected / no_text_layer**（不硬着头皮排课）；
 *   - legacy .doc → rejected / legacy_format（提示另存）。
 */
import fs from 'fs';
import path from 'path';
import { parseDocument } from '../services/materials/document-parser';

const DIRECTORY = process.argv[2] || path.join(process.cwd(), '..', 'text');

async function main() {
  const entries = fs.readdirSync(DIRECTORY).filter((name) => !name.startsWith('_'));
  console.log(`目录：${DIRECTORY}｜${entries.length} 个文件\n`);
  console.log(['文件', '结果', '格式', '字数', '页/节', '小标题', '表格', '锚点', '耗时ms'].join(' | '));

  let ok = 0;
  let rejected = 0;
  for (const name of entries) {
    const full = path.join(DIRECTORY, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const started = Date.now();
    let line: string;
    try {
      const buffer = fs.readFileSync(full);
      const result = await parseDocument(buffer, name);
      const elapsed = Date.now() - started;
      if (result.status === 'ok') {
        ok += 1;
        const pages = result.structure.pageCount ?? result.structure.slideCount ?? result.structure.sheetCount ?? 0;
        line = [
          name.slice(0, 34),
          'ok',
          result.format,
          String(result.charCount),
          String(pages),
          String(result.structure.headingCount),
          String(result.structure.tableCount),
          String(result.anchors.length),
          String(elapsed),
        ].join(' | ');
      } else {
        rejected += 1;
        line = [
          name.slice(0, 34),
          `rejected:${result.rejectReason}`,
          '-',
          '-',
          '-',
          '-',
          '-',
          '-',
          String(elapsed),
        ].join(' | ');
      }
    } catch (error) {
      rejected += 1;
      line = `${name.slice(0, 34)} | 异常 | ${String((error as Error)?.message || error).slice(0, 60)}`;
    }
    console.log(line);
  }

  console.log(`\n合计：成功 ${ok} ｜ 拒收 ${rejected}`);
}

main().catch((error) => {
  console.error('探针失败:', error);
  process.exit(1);
});
