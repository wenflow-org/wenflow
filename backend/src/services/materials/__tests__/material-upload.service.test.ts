import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  deleteMaterial,
  listMaterials,
  readMaterial,
  saveUploadedMaterial,
} from '../material-upload.service';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-materials-'));
  process.env.MATERIAL_UPLOAD_DIR = root;
});

afterEach(() => {
  delete process.env.MATERIAL_UPLOAD_DIR;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // 清理失败不影响断言
  }
});

const LONG_ENOUGH_TEXT = '把发展要求翻译成可观察的行为证据，是判断实际情况的关键一步。'.repeat(4);

describe('material-upload.service', () => {
  it('保存成功 → 列表可见 → 可读正文 → 可删除', async () => {
    const saved = await saveUploadedMaterial({
      userId: 'user-1',
      originalName: '我的笔记.txt',
      buffer: Buffer.from(LONG_ENOUGH_TEXT, 'utf-8'),
    });
    expect(saved.ok).toBe(true);
    const record = saved.record!;
    expect(record.name).toBe('我的笔记.txt');
    expect(record.charCount).toBe(LONG_ENOUGH_TEXT.length);

    const items = listMaterials('user-1');
    expect(items.map((item) => item.id)).toEqual([record.id]);

    const found = readMaterial('user-1', record.id);
    expect(found?.markdown).toBe(LONG_ENOUGH_TEXT);

    expect(deleteMaterial('user-1', record.id)).toBe(true);
    expect(listMaterials('user-1')).toEqual([]);
    expect(readMaterial('user-1', record.id)).toBeNull();
  });

  it('被拒收的文件不落盘（磁盘上不堆读不了的文件）', async () => {
    const rejected = await saveUploadedMaterial({
      userId: 'user-1',
      originalName: '扫描件.pdf-doc.doc',
      buffer: Buffer.from('dummy', 'utf-8'),
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('legacy_format');
    expect(rejected.message).toContain('另存为');
    expect(listMaterials('user-1')).toEqual([]);
  });

  it('用户之间互相隔离（别人的资料读不到、删不掉）', async () => {
    const saved = await saveUploadedMaterial({
      userId: 'user-1',
      originalName: 'a.txt',
      buffer: Buffer.from(LONG_ENOUGH_TEXT, 'utf-8'),
    });
    const id = saved.record!.id;

    expect(listMaterials('user-2')).toEqual([]);
    expect(readMaterial('user-2', id)).toBeNull();
    expect(deleteMaterial('user-2', id)).toBe(false);
    // 原用户的数据仍在
    expect(readMaterial('user-1', id)).not.toBeNull();
  });

  it('非法 id 不会造成目录穿越', () => {
    expect(readMaterial('user-1', '../../etc/passwd')).toBeNull();
    expect(deleteMaterial('user-1', '..\\..\\secret')).toBe(false);
    expect(readMaterial('user-1', 'not-a-uuid')).toBeNull();
  });
});
