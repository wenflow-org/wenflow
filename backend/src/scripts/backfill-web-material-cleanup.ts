/* eslint-disable no-console -- 一次性回填 CLI：联网采集资料的抓取痕迹清洗 */
/**
 * 存量「联网采集」资料的抓取痕迹回填（2026-11-06）
 *
 * 背景：`ingestWebMaterial` 在本次修复之前把抓回来的页面 markdown **原样**入库，
 * 于是：
 *   - 开头十几行英文元数据（Issued / Issuer / Body (Chinese)）成了锚点与展示内容；
 *   - 英文 H1 被资料库当成「第一章」；
 *   - 整章正文挤在一个几千字的长行里，切片按 1022 字硬切、块标题是行内碎片。
 * 入库侧已改为「先 sanitizeWebMaterialText 再 normalizeWebTextStructure」，
 * 但**已被污染的存量 .md 不会自动变干净**——本脚本负责回填。
 *
 * 纪律：
 *   - 默认 `--dry-run` 语义（不带 `--write` 只统计与打样，不写任何文件）；
 *   - 只处理 `origin === 'web'` 的记录，上传附件一律不碰；
 *   - 幂等：清洗后与原文一致的文件直接跳过；
 *   - 重算 structure / anchors / charCount / size 后重写 `.md` 与记录，并重建向量侧车。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/backfill-web-material-cleanup.ts                 # 预演（只读）
 *   npx ts-node --transpile-only src/scripts/backfill-web-material-cleanup.ts --write         # 真写
 *   npx ts-node --transpile-only src/scripts/backfill-web-material-cleanup.ts --user=user_xxx --write
 *   npx ts-node --transpile-only src/scripts/backfill-web-material-cleanup.ts --id=<materialId> --write
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from '../services/materials/document-parser';
import {
  readMaterial,
  recordPath,
  resolveMaterialsRoot,
  updateRecord,
  writeMaterial,
} from '../services/materials/material-store';
import { sanitizeWebMaterialText } from '../services/materials/material-web-clean';
import { warmMaterialVectorIndex } from '../services/materials/material-semantic.service';

interface Args {
  write: boolean;
  userId: string | null;
  materialId: string | null;
}

function parseArgs(): Args {
  const out: Args = { write: false, userId: null, materialId: null };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'write') out.write = true;
    if (k === 'user' && v) out.userId = v.trim();
    if (k === 'id' && v) out.materialId = v.trim();
  }
  return out;
}

/** 资料按用户分目录：`<root>/<userId>/<id>.json` —— 直接从目录结构反推所有者 */
function listUserDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const root = resolveMaterialsRoot();
  const userDirs = args.userId ? [args.userId] : listUserDirs(root);
  const report = { scanned: 0, webRecords: 0, dirty: 0, rewritten: 0, skipped: 0 };

  for (const userId of userDirs) {
    const dir = path.join(root, userId);
    let ids: string[] = [];
    try {
      ids = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, ''));
    } catch {
      continue;
    }
    for (const id of ids) {
      if (args.materialId && id !== args.materialId) continue;
      report.scanned += 1;
      const loaded = readMaterial(userId, id);
      if (!loaded) continue;
      const { record, markdown } = loaded;
      if (record.origin !== 'web') continue;
      report.webRecords += 1;

      const cleaned = sanitizeWebMaterialText(markdown);
      if (cleaned.strippedHeaderLines === 0 && cleaned.clauseBreaks === 0) {
        report.skipped += 1;
        continue;
      }
      report.dirty += 1;

      const before = markdown.length;
      const after = cleaned.text.length;
      console.log(
        `[${args.write ? 'write' : 'dry-run'}] ${record.name || id} (${id})`
          + ` 头行=${cleaned.strippedHeaderLines} 断条=${cleaned.clauseBreaks} 字数 ${before}→${after}`
      );
      if (!args.write) continue;

      const parsed = await parseDocument(Buffer.from(cleaned.text, 'utf-8'), 'web-source.md');
      if (parsed.status === 'rejected') {
        console.warn(`  跳过：清洗后正文未通过解析闸门（${record.name || id}）`);
        continue;
      }
      const next = {
        ...record,
        size: Buffer.byteLength(parsed.markdown, 'utf-8'),
        charCount: parsed.charCount,
        structure: parsed.structure,
        anchors: parsed.anchors,
      };
      writeMaterial(next, parsed.markdown);
      updateRecord(userId, id, {
        size: next.size,
        charCount: next.charCount,
        structure: next.structure,
        anchors: next.anchors,
      });
      // 向量侧车按新正文重建（失败静默：语义层可随后续预热补齐）
      warmMaterialVectorIndex(next, parsed.markdown);
      report.rewritten += 1;
      console.log(`  已重写：${recordPath(userId, id)}`);
    }
  }

  console.log(
    `\n扫描 ${report.scanned} 份 / 联网资料 ${report.webRecords} 份 / 需要清洗 ${report.dirty} 份`
      + ` / 已重写 ${report.rewritten} 份 / 无需处理 ${report.skipped} 份`
  );
  if (!args.write && report.dirty > 0) {
    console.log('预演结束：加 --write 才会真正重写文件与记录。');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
