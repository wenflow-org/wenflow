/**
 * 预制学习者「附件夹具」注入（覆盖 附件→路径→任务→课堂 这条链的前提）。
 *
 * 验收点：
 *   1) 夹具文件按仓库相对路径读入并落成该用户的已上传资料；
 *   2) **幂等**：同名同大小已存在 → 跳过，不堆副本；
 *   3) 坏路径/不存在的文件 → 记 error，**不抛**（fail-open，不阻断跑批）；
 *   4) 未声明夹具 / 空列表 → 什么都不做。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureFixtureMaterialsUploaded } from '../fixture-materials';
import { listMaterials } from '../../services/materials/material-store';

let root = '';
let fixtureDir = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-fixtures-'));
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-fixture-files-'));
  process.env.MATERIAL_UPLOAD_DIR = root;
});

afterEach(() => {
  delete process.env.MATERIAL_UPLOAD_DIR;
  for (const dir of [root, fixtureDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

function writeFixture(name: string, content: string): string {
  const file = path.join(fixtureDir, name);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

// 必须超过文本层闸门下限（MIN_TOTAL_CHARS=100），否则会被当空文档拒收
const LONG_TEXT = '把发展要求翻译成可观察的行为证据，是判断实际情况的关键一步。'.repeat(6);

describe('ensureFixtureMaterialsUploaded', () => {
  it('把夹具落成该用户的已上传资料（绝对路径同样可用）', async () => {
    const file = writeFixture('指南.txt', LONG_TEXT);
    const result = await ensureFixtureMaterialsUploaded({ userId: 'u1', fixtures: [{ file }] });

    expect(result.uploaded).toEqual(['指南.txt']);
    expect(result.errors).toEqual([]);
    const stored = listMaterials('u1');
    expect(stored.map((record) => record.name)).toEqual(['指南.txt']);
  });

  it('幂等：重复注入同一夹具 → 跳过，不堆副本', async () => {
    const file = writeFixture('指南.txt', LONG_TEXT);
    await ensureFixtureMaterialsUploaded({ userId: 'u1', fixtures: [{ file }] });
    const second = await ensureFixtureMaterialsUploaded({ userId: 'u1', fixtures: [{ file }] });

    expect(second.uploaded).toEqual([]);
    expect(second.skipped).toEqual(['指南.txt']);
    expect(listMaterials('u1')).toHaveLength(1);
  });

  it('文件不存在 → 记 error 且不抛（fail-open）', async () => {
    const result = await ensureFixtureMaterialsUploaded({
      userId: 'u1',
      fixtures: [{ file: path.join(fixtureDir, '不存在.pptx') }],
    });
    expect(result.uploaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toContain('不存在.pptx');
    expect(listMaterials('u1')).toEqual([]);
  });

  it('被闸门拒收的夹具（如 .doc）→ 记 error，不落盘', async () => {
    const file = writeFixture('旧文档.doc', 'dummy');
    const result = await ensureFixtureMaterialsUploaded({ userId: 'u1', fixtures: [{ file }] });
    expect(result.uploaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('另存为');
    expect(listMaterials('u1')).toEqual([]);
  });

  it('未声明夹具 / 空列表 → 零副作用', async () => {
    expect(await ensureFixtureMaterialsUploaded({ userId: 'u1', fixtures: null })).toEqual({ uploaded: [], skipped: [], errors: [] });
    expect(await ensureFixtureMaterialsUploaded({ userId: 'u1', fixtures: [] })).toEqual({ uploaded: [], skipped: [], errors: [] });
    expect(listMaterials('u1')).toEqual([]);
  });

  it('用户隔离：注入到 u1，不影响 u2', async () => {
    const file = writeFixture('指南.txt', LONG_TEXT);
    await ensureFixtureMaterialsUploaded({ userId: 'u1', fixtures: [{ file }] });
    expect(listMaterials('u1')).toHaveLength(1);
    expect(listMaterials('u2')).toEqual([]);
  });
});
