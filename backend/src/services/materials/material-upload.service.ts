/**
 * 上传资料：解析 + 落盘（写路径）。
 *
 * 只读能力（列表/读取/删除）在 `material-store.ts`；本文件负责「把上传文件变成资料」：
 * 解析（officeparser + 文本层闸门）→ 命中闸门才落盘。**被拒收的文件不落盘**，
 * 避免磁盘里堆一堆读不了的扫描件。
 *
 * 说明：`listMaterials` / `readMaterial` / `deleteMaterial` 从这里 re-export，
 * 保持既有调用点（routes）的导入路径稳定。
 */
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { MAX_UPLOAD_BYTES, parseDocument, rejectMessageFor, type DocumentRejectReason } from './document-parser';
import {
  listMaterials,
  readMaterial,
  deleteMaterial,
  writeMaterial,
  type MaterialRecord,
} from './material-store';

export { listMaterials, readMaterial, deleteMaterial, type MaterialRecord };

/**
 * 保存结果。`ok=false` 时带 `reason`（机器可判）与 `message`（面向用户，可直接展示）。
 * 用可选字段而非判别联合：本仓 `strictNullChecks=false`，联合收窄在调用点不可靠。
 */
export interface SaveMaterialResult {
  ok: boolean;
  record?: MaterialRecord;
  reason?: DocumentRejectReason;
  message?: string;
}

/** 保存并解析一份上传文件；被拒收时不落盘。 */
export async function saveUploadedMaterial(input: {
  userId: string;
  originalName: string;
  buffer: Buffer;
}): Promise<SaveMaterialResult> {
  const { userId, buffer } = input;
  const originalName = String(input.originalName || '未命名文件');

  const parsed = await parseDocument(buffer, originalName);
  if (parsed.status === 'rejected') {
    const reason = parsed.rejectReason || 'parse_failed';
    return { ok: false, reason, message: parsed.message || rejectMessageFor(reason) };
  }

  const record: MaterialRecord = {
    id: crypto.randomUUID(),
    userId,
    name: originalName,
    ext: parsed.ext,
    format: parsed.format,
    size: Math.min(buffer.byteLength, MAX_UPLOAD_BYTES),
    charCount: parsed.charCount,
    structure: parsed.structure,
    anchors: parsed.anchors,
    warnings: parsed.warnings,
    createdAt: new Date().toISOString(),
  };

  // 同名同大小重复上传 ⇒ 覆盖旧记录（否则列表与「资料包」里会堆同一份资料的多个副本）
  try {
    for (const existing of listMaterials(userId)) {
      if (existing.name === record.name && existing.size === record.size) {
        deleteMaterial(userId, existing.id);
      }
    }
  } catch {
    // 去重失败不影响本次保存
  }

  writeMaterial(record, parsed.markdown);
  logger.info(`[materials] 已保存资料 ${record.id}（${record.name}，${record.charCount} 字，${record.structure.chunkCount} 锚点）`);
  return { ok: true, record };
}
