/**
 * 上传资料的**存储层（只读 + 落盘）**：只依赖 fs，不依赖解析器。
 *
 * 拆出来的原因：path.coordinator 需要读用户上传的资料，但**不能**因此把
 * officeparser（pdf/pptx 解析）拖进它的静态依赖图；解析在
 * `material-upload.service.ts`（写路径）里，本文件只在读/写文件。
 *
 * 存储形态：
 *   <root>/<userId>/<id>.md    抽取后的 Markdown 正文
 *   <root>/<userId>/<id>.json  记录元数据（含结构、章节锚点、警告）
 */
import fs from 'fs';
import path from 'path';
import type { DocumentAnchor, DocumentStructure } from './document-parser.types';
import type { MaterialBrief } from '../../skills/material-brief/types';

export interface MaterialRecord {
  id: string;
  userId: string;
  /** 用户原始文件名。 */
  name: string;
  ext: string;
  format: string;
  /** 原始文件字节数。 */
  size: number;
  /** 抽取后的正文字符数。 */
  charCount: number;
  structure: DocumentStructure;
  anchors: DocumentAnchor[];
  warnings: string[];
  createdAt: string;
  /**
   * 资料理解摘要（Document Summary Index 摘要节点，2026-09-24）。
   * 惰性生成一次后持久化，goal 对话与 path 生成复用；缺省=尚未生成（fail-open 降级元信息）。
   */
  brief?: MaterialBrief | null;
  /** brief 生成时间（ISO）；缺省=未生成。 */
  briefGeneratedAt?: string | null;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 上传资料根目录（可用 MATERIAL_UPLOAD_DIR 覆盖；默认落在进程工作目录的 data/ 下，已被 .gitignore 覆盖）。 */
export function resolveMaterialsRoot(): string {
  const configured = process.env.MATERIAL_UPLOAD_DIR;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.join(process.cwd(), 'data', 'uploads', 'materials');
}

/** userId 来自认证层，仍需清洗后拼路径（防目录穿越）。 */
export function userDirectory(userId: string): string {
  const safe = String(userId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return path.join(resolveMaterialsRoot(), safe || 'anonymous');
}

/**
 * 历史无前缀目录（读路径兼容，2026-09-24 发现）：加 `user_` 前缀的目录约定上线之前，
 * 旧上传直接落在 `<root>/<sanitized-userId>/`。这些资料对当前管线（清单/brief/附件打包）
 * 全部不可见——读路径对旧目录做回退兼容，写路径仍只写新前缀目录。
 */
function legacyUserDirectory(userId: string): string {
  const safe = String(userId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return path.join(resolveMaterialsRoot(), safe || 'anonymous');
}

/** 该用户的所有候选目录：新前缀目录优先，旧无前缀目录兜底（去重）。 */
function userDirectories(userId: string): string[] {
  const current = userDirectory(userId);
  const legacy = legacyUserDirectory(userId);
  return current === legacy ? [current] : [current, legacy];
}

export function recordPath(userId: string, id: string): string {
  return path.join(userDirectory(userId), `${id}.json`);
}

export function markdownPath(userId: string, id: string): string {
  return path.join(userDirectory(userId), `${id}.md`);
}

function recordPathIn(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

function markdownPathIn(dir: string, id: string): string {
  return path.join(dir, `${id}.md`);
}

/** 按新→旧目录顺序找记录所在目录；都找不到返回 null。 */
function findRecordDir(userId: string, id: string): string | null {
  if (!ID_PATTERN.test(String(id || ''))) return null;
  for (const dir of userDirectories(userId)) {
    if (fs.existsSync(recordPathIn(dir, id))) return dir;
  }
  return null;
}

export function readRecord(userId: string, id: string): MaterialRecord | null {
  if (!ID_PATTERN.test(String(id || ''))) return null;
  for (const dir of userDirectories(userId)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(recordPathIn(dir, id), 'utf-8')) as MaterialRecord;
      if (parsed && parsed.id === id) return parsed;
    } catch {
      // 该目录无此记录或损坏，尝试下一候选目录
    }
  }
  return null;
}

/** 写入一份资料（正文 + 记录）。 */
export function writeMaterial(record: MaterialRecord, markdown: string): void {
  const directory = userDirectory(record.userId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(markdownPath(record.userId, record.id), markdown, 'utf-8');
  fs.writeFileSync(recordPath(record.userId, record.id), JSON.stringify(record, null, 2), 'utf-8');
}

/** 局部更新资料记录（读-改-写；如 brief 惰性生成后的持久化）。记录不存在返回 null。 */
export function updateRecord(userId: string, id: string, patch: Partial<MaterialRecord>): MaterialRecord | null {
  const record = readRecord(userId, id);
  if (!record) return null;
  // 写回记录所在目录（兼容旧无前缀目录中的历史资料，不搬家）
  const dir = findRecordDir(userId, id) ?? userDirectory(userId);
  const updated: MaterialRecord = { ...record, ...patch };
  fs.writeFileSync(recordPathIn(dir, id), JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

/** 列出该用户的资料（新→旧；合并新前缀目录与历史无前缀目录，按 id 去重）。损坏的单条记录跳过。 */
export function listMaterials(userId: string): MaterialRecord[] {
  const byId = new Map<string, MaterialRecord>();
  // 新目录优先：后读旧目录，重复 id 不覆盖
  const dirs = [...userDirectories(userId)].reverse();
  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const record = readRecord(userId, entry.slice(0, -'.json'.length));
      if (record) byId.set(record.id, record);
    }
  }
  return Array.from(byId.values()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** 读取单份资料的正文（供前端预览与「资料→路径」消费）。 */
export function readMaterial(userId: string, id: string): { record: MaterialRecord; markdown: string } | null {
  const record = readRecord(userId, id);
  if (!record) return null;
  const dir = findRecordDir(userId, id) ?? userDirectory(userId);
  let markdown = '';
  try {
    markdown = fs.readFileSync(markdownPathIn(dir, id), 'utf-8');
  } catch {
    markdown = '';
  }
  return { record, markdown };
}

/** 删除单份资料（只删自己的；返回是否删掉了东西；兼容旧目录）。 */
export function deleteMaterial(userId: string, id: string): boolean {
  if (!readRecord(userId, id)) return false;
  let removed = false;
  for (const dir of userDirectories(userId)) {
    for (const target of [recordPathIn(dir, id), markdownPathIn(dir, id)]) {
      try {
        fs.unlinkSync(target);
        removed = true;
      } catch {
        // 文件可能已被清理，忽略
      }
    }
  }
  return removed;
}
