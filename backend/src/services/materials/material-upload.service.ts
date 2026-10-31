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
import { warmMaterialVectorIndex } from './material-semantic.service';

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
  /** 内容哈希命中已有资料：未重复落盘。 */
  deduped?: boolean;
}

/** 每用户资料库默认容量上限（字节）；0=不限制。 */
export const DEFAULT_USER_QUOTA_BYTES = 200 * 1024 * 1024;

export function resolveUserQuotaBytes(): number {
  const raw = process.env.MATERIAL_USER_QUOTA_BYTES;
  if (raw === undefined || raw === '') return DEFAULT_USER_QUOTA_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_USER_QUOTA_BYTES;
}

export interface MaterialLibraryStats {
  total: number;
  uploadCount: number;
  webCount: number;
  totalBytes: number;
  quotaBytes: number;
}

/** 资源库容量统计（列表接口/前端展示用）。 */
export function getMaterialLibraryStats(userId: string): MaterialLibraryStats {
  const items = listMaterials(userId);
  const uploadCount = items.filter((record) => record.origin !== 'web').length;
  return {
    total: items.length,
    uploadCount,
    webCount: items.length - uploadCount,
    totalBytes: items.reduce((sum, record) => sum + (Number(record.size) || 0), 0),
    quotaBytes: resolveUserQuotaBytes(),
  };
}

function formatMb(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
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

  const contentHash = crypto.createHash('sha256').update(parsed.markdown).digest('hex');
  let existingRecords: MaterialRecord[] = [];
  try {
    existingRecords = listMaterials(userId);
  } catch {
    // 读列表失败不阻塞本次保存；只是本次不做内容去重/配额扣减
  }

  // 内容级去重：同一份正文重复上传（换文件名也算）直接复用已有记录，不重复落盘/建索引。
  const duplicate = existingRecords.find(
    (existing) => existing.origin !== 'web' && existing.contentHash === contentHash
  );
  if (duplicate) {
    logger.info(`[materials] 内容重复，复用已有资料 ${duplicate.id}（${duplicate.name}）`);
    return { ok: true, record: duplicate, deduped: true };
  }

  const size = Math.min(buffer.byteLength, MAX_UPLOAD_BYTES);
  // 同名同大小视为覆盖：先扣掉旧版本占用的容量，避免“替换自己”被配额误拦。
  const replaced = existingRecords.filter(
    (existing) => existing.name === originalName && existing.size === size
  );
  const usedBytes =
    existingRecords.reduce((sum, existing) => sum + (Number(existing.size) || 0), 0) -
    replaced.reduce((sum, existing) => sum + (Number(existing.size) || 0), 0);
  const quotaBytes = resolveUserQuotaBytes();
  if (quotaBytes > 0 && usedBytes + size > quotaBytes) {
    return {
      ok: false,
      reason: 'quota_exceeded',
      message: `资料库空间不足（已用 ${formatMb(usedBytes)}，上限 ${formatMb(quotaBytes)}），请先删除一些旧资料再上传`,
    };
  }

  const record: MaterialRecord = {
    id: crypto.randomUUID(),
    userId,
    name: originalName,
    ext: parsed.ext,
    format: parsed.format,
    size,
    charCount: parsed.charCount,
    structure: parsed.structure,
    anchors: parsed.anchors,
    warnings: parsed.warnings,
    createdAt: new Date().toISOString(),
    contentHash,
  };

  // 同名同大小重复上传 ⇒ 覆盖旧记录（否则列表与「资料包」里会堆同一份资料的多个副本）
  // deleteMaterial 已连同向量侧车一并清理，这里不必单独删索引
  try {
    for (const existing of replaced) {
      deleteMaterial(userId, existing.id);
    }
  } catch {
    // 去重失败不影响本次保存
  }

  writeMaterial(record, parsed.markdown);
  // 后台预热向量索引（失败静默；首次检索/采样无需等嵌入）
  warmMaterialVectorIndex(record, parsed.markdown);
  logger.info(`[materials] 已保存资料 ${record.id}（${record.name}，${record.charCount} 字，${record.structure.chunkCount} 锚点）`);
  return { ok: true, record };
}
