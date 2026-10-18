/**
 * 资料**向量索引侧车**（持久化层，只依赖 fs）。
 *
 * 形状：`<dir>/<id>.vectors.json`，与 `<id>.md` / `<id>.json` 同级。
 * 为什么不做进 MaterialRecord：向量体量大（1024 维 × N 块），而 `listMaterials` 会整包读记录，
 * 塞进去会让每次列资料都反序列化几百 KB。侧车**只在真正检索/采样时读取**。
 *
 * 失效判定：索引携带 `sourceHash`（正文 sha1）。正文变了（重传/回调）→ 哈希不符即视为过期，
 * 消费方重新建索引，不做增量修补（本量级全量重建足够便宜）。
 *
 * fail-open：任何 IO 异常都吞掉按"无索引"处理，绝不阻塞资料读路径。
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { VECTOR_SIDECAR_SUFFIX, materialDirCandidates, materialPrimaryDir } from './material-store';
import type { MaterialChunk } from './material-chunker';

export interface IndexedChunk extends MaterialChunk {
  /** 归一化向量（provider 原样返回，不假定已是单位向量——cosineSimilarity 自算范数）。 */
  vector: number[];
}

export interface MaterialVectorIndex {
  /** 结构版本，便于将来迁移。 */
  version: 1;
  /** 产生向量的模型 id（换模型即失效，避免跨模型向量混算）。 */
  model: string;
  dimensions: number;
  builtAt: string;
  /** 建索引时的正文哈希；与当前正文不符即过期。 */
  sourceHash: string;
  chunks: IndexedChunk[];
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function hashMaterialMarkdown(markdown: string): string {
  return crypto.createHash('sha1').update(String(markdown || ''), 'utf-8').digest('hex');
}

function sidecarName(id: string): string {
  return `${id}${VECTOR_SIDECAR_SUFFIX}`;
}

/** 读侧路径候选（新→旧）。 */
function readCandidates(userId: string, id: string): string[] {
  return materialDirCandidates(userId).map((dir) => path.join(dir, sidecarName(id)));
}

/** 从记录所在目录读索引（与资料本体目录一致，兼容旧无前缀目录）。找不到/损坏返回 null。 */
export function readVectorIndex(userId: string, id: string): MaterialVectorIndex | null {
  if (!ID_PATTERN.test(String(id || ''))) return null;
  for (const candidate of readCandidates(userId, id)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as MaterialVectorIndex;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.chunks)) return parsed;
    } catch {
      // 该候选不存在或损坏，试下一个
    }
  }
  return null;
}

/** 索引是否与当前正文 + 指定模型一致（可用性判定）。 */
export function isVectorIndexFresh(
  index: MaterialVectorIndex | null,
  markdown: string,
  model: string
): boolean {
  if (!index) return false;
  return index.sourceHash === hashMaterialMarkdown(markdown) && (!model || index.model === model);
}

/** 写入索引（落在首选目录）。IO 失败返回 false，不抛。 */
export function writeVectorIndex(userId: string, id: string, index: MaterialVectorIndex): boolean {
  if (!ID_PATTERN.test(String(id || ''))) return false;
  try {
    const dir = materialPrimaryDir(userId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, sidecarName(id)), JSON.stringify(index), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** 删除索引（资料删除时一并清理；两候选目录都清）。 */
export function deleteVectorIndex(userId: string, id: string): void {
  if (!ID_PATTERN.test(String(id || ''))) return;
  for (const candidate of readCandidates(userId, id)) {
    try {
      fs.unlinkSync(candidate);
    } catch {
      // 不存在即忽略
    }
  }
}
