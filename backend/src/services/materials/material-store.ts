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
  /** 抽取后正文的 SHA-256；用于内容级去重（旧记录可能缺省）。 */
  contentHash?: string;
  /**
   * 资料理解摘要（Document Summary Index 摘要节点，2026-09-24）。
   * 惰性生成一次后持久化，goal 对话与 path 生成复用；缺省=尚未生成（fail-open 降级元信息）。
   */
  brief?: MaterialBrief | null;
  /** brief 生成时间（ISO）；缺省=未生成。 */
  briefGeneratedAt?: string | null;
  /**
   * 来源（2026-09-24 活的 path 批次 A）：'upload'=用户上传附件；'web'=联网采集入库。
   * 缺省=历史记录（一律按 upload 对待——旧记录全是上传）。
   */
  origin?: 'upload' | 'web';
  /** 联网资料的原始 URL（origin='web' 时有值）；上传附件为空。去重与溯源用。 */
  sourceUrl?: string | null;
  /** 联网抓取时间（ISO）；上传附件为空。 */
  fetchedAt?: string | null;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 上传资料根目录（可用 MATERIAL_UPLOAD_DIR 覆盖；默认落在进程工作目录的 data/ 下，已被 .gitignore 覆盖）。
 * 收尾批 C8 登记：此处的 cwd 依赖是**部署约定**（数据目录跟运行目录），与 prompt-lab 系
 * 「cwd 相对路径读仓库文件」的脆弱形态不同类，有意保留不改 __dirname。 */
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

/**
 * 侧车文件目录候选（新→旧），供 material-vector-store 等伴生文件复用同一套目录约定。
 * 不暴露目录内的具体文件布局，只暴露"该用户的资料可能落在哪些目录"。
 */
export function materialDirCandidates(userId: string): string[] {
  return userDirectories(userId);
}

/** 资料在当前目录约定下的**首选**目录（写侧用；读侧用 materialDirCandidates 兜底旧目录）。 */
export function materialPrimaryDir(userId: string): string {
  return userDirectory(userId);
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

/**
 * 清空某归属（账号 userId 或卡归属键 `card-<profileId>`）的全部资料目录：
 * 正文 / 记录 / 向量侧车 / 历史无前缀目录一并删除。供虚拟学习者与卡的级联删除使用。
 * 返回删除的文件数；目录被占用或已不存在时静默保留（不阻断删除主流程）。
 */
export function purgeOwnerMaterials(ownerKey: string): number {
  let removed = 0;
  for (const dir of userDirectories(ownerKey)) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        removed++;
      } catch {
        // 单个文件删不掉（占用/权限）不阻断其余清理
      }
    }
    try {
      fs.rmdirSync(dir);
    } catch {
      // 目录非空 / 已被删除 / 被占用：留空目录无害
    }
  }
  return removed;
}

/** 向量侧车文件名后缀（单点定义：material-vector-store 与本文件的删除路径共用，防两处漂移）。 */
export const VECTOR_SIDECAR_SUFFIX = '.vectors.json';

/**
 * 删除单份资料（只删自己的；返回是否删掉了东西；兼容旧目录）。
 *
 * 侧车（`<id>.vectors.json`）也在**这里**一并删除 —— 收口成一处，任何调用方（HTTP 路由、
 * 上传同名覆盖、将来的 TTL 回收）都不会再留下孤儿索引。
 * （真机实测过孤儿：早前只在路由层补删侧车，其它删除路径仍会残留，而残留的侧车会被
 * `readVectorIndex` 命中，让一份已删资料继续占用磁盘。）
 */
export function deleteMaterial(userId: string, id: string): boolean {
  if (!readRecord(userId, id)) return false;
  let removed = false;
  for (const dir of userDirectories(userId)) {
    for (const target of [recordPathIn(dir, id), markdownPathIn(dir, id), path.join(dir, `${id}${VECTOR_SIDECAR_SUFFIX}`)]) {
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
