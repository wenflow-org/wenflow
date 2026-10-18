/**
 * material-vector-store 单测：侧车索引的读写 / 失效判定（正文哈希 + 模型 id）/ 删除。
 * 用真实临时目录（设 MATERIAL_UPLOAD_DIR），不 mock fs——这正是要验证的部分。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  hashMaterialMarkdown,
  isVectorIndexFresh,
  readVectorIndex,
  writeVectorIndex,
  deleteVectorIndex,
  type MaterialVectorIndex,
} from '../material-vector-store';
import { deleteMaterial, readRecord, writeMaterial, type MaterialRecord } from '../material-store';

const USER_ID = 'user_vectors';
const MATERIAL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CORRUPT_FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.vectors.json';
let tmpRoot = '';

function makeIndex(markdown: string, overrides: Partial<MaterialVectorIndex> = {}): MaterialVectorIndex {
  return {
    version: 1,
    model: 'BAAI/bge-m3',
    dimensions: 3,
    builtAt: new Date().toISOString(),
    sourceHash: hashMaterialMarkdown(markdown),
    chunks: [{ id: 'c-1', title: 't', text: 'hello', charCount: 5, index: 0, vector: [1, 0, 0] }],
    ...overrides,
  };
}

/** 在临时根内构造一个文件路径，并强制校验没有越出根目录（测试自带边界检查）。 */
function pathInsideRoot(...segments: string[]): string {
  const root = path.resolve(tmpRoot);
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`测试路径越出临时根：${target}`);
  }
  return target;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-vectors-'));
  process.env.MATERIAL_UPLOAD_DIR = tmpRoot;
});

afterEach(() => {
  delete process.env.MATERIAL_UPLOAD_DIR;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('material-vector-store', () => {
  it('写后读回一致（含向量）', () => {
    const index = makeIndex('正文A');
    expect(writeVectorIndex(USER_ID, MATERIAL_ID, index)).toBe(true);
    const read = readVectorIndex(USER_ID, MATERIAL_ID);
    expect(read).not.toBeNull();
    expect(read!.chunks[0].vector).toEqual([1, 0, 0]);
    expect(read!.model).toBe('BAAI/bge-m3');
  });

  it('未写过 → null', () => {
    expect(readVectorIndex(USER_ID, MATERIAL_ID)).toBeNull();
  });

  it('非法 id（非 uuid）→ 不读不写', () => {
    expect(readVectorIndex(USER_ID, 'not-a-uuid')).toBeNull();
    expect(writeVectorIndex(USER_ID, 'not-a-uuid', makeIndex('x'))).toBe(false);
  });

  it('正文哈希变化 → 索引判为过期', () => {
    const index = makeIndex('正文A');
    expect(isVectorIndexFresh(index, '正文A', 'BAAI/bge-m3')).toBe(true);
    expect(isVectorIndexFresh(index, '正文B', 'BAAI/bge-m3')).toBe(false);
  });

  it('模型变化 → 索引判为过期（防跨模型向量混算）', () => {
    const index = makeIndex('正文A');
    expect(isVectorIndexFresh(index, '正文A', 'BAAI/bge-large-zh-v1.5')).toBe(false);
  });

  it('删除后读回 null', () => {
    writeVectorIndex(USER_ID, MATERIAL_ID, makeIndex('正文A'));
    deleteVectorIndex(USER_ID, MATERIAL_ID);
    expect(readVectorIndex(USER_ID, MATERIAL_ID)).toBeNull();
  });

  it('读取损坏文件视为无索引（不抛）', () => {
    fs.mkdirSync(pathInsideRoot(USER_ID), { recursive: true });
    fs.writeFileSync(pathInsideRoot(USER_ID, CORRUPT_FILE), '{ 不是合法 json', 'utf-8');
    expect(readVectorIndex(USER_ID, MATERIAL_ID)).toBeNull();
  });

  // 真机发现（2026-10-16）：侧车只在路由层补删，其它删除路径会留下孤儿索引。
  // 收口到 deleteMaterial 后，任何调用方删资料都不会残留侧车。
  it('deleteMaterial 连同向量侧车一起删（收口，不留孤儿索引）', () => {
    const record: MaterialRecord = {
      id: MATERIAL_ID,
      userId: USER_ID,
      name: '笔记.md',
      ext: '.md',
      format: 'md',
      size: 40,
      charCount: 20,
      structure: { pageCount: null, slideCount: 0, sheetCount: 0, headingCount: 1, tableCount: 0, listCount: 0, paragraphCount: 1, chunkCount: 1 },
      anchors: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    };
    writeMaterial(record, '# 标题\n这是一段有实质内容的正文。');
    writeVectorIndex(USER_ID, MATERIAL_ID, makeIndex('正文A'));
    expect(readRecord(USER_ID, MATERIAL_ID)).not.toBeNull();
    expect(readVectorIndex(USER_ID, MATERIAL_ID)).not.toBeNull();

    expect(deleteMaterial(USER_ID, MATERIAL_ID)).toBe(true);

    expect(readRecord(USER_ID, MATERIAL_ID)).toBeNull();
    expect(readVectorIndex(USER_ID, MATERIAL_ID)).toBeNull();
  });
});
