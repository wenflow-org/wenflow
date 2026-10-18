/**
 * 联网资料入库单测（活的 path 批次 A）：
 * 正常入库（锚点/origin/sourceUrl）/ URL 去重（复用既有记录）/ 过短拒收 / 160K 截断 / 扁平正文补结构。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  findWebRecordByTitle,
  ingestWebMaterial,
  normalizeSourceUrl,
} from '../material-web-ingest.service';
import { listMaterials, readMaterial } from '../material-store';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-web-ingest-'));
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

const WEB_TEXT = [
  '# 中华人民共和国未成年人保护法',
  '',
  '## 第一章 总则',
  '',
  '第一条 为了保护未成年人身心健康，保障未成年人合法权益，根据宪法，制定本法。',
  '',
  '## 第二章 学校保护',
  '',
  '第二十五条 学校应当建立学生保护工作制度，保障学生在校期间的人身安全。',
].join('\n');

describe('ingestWebMaterial 联网入库', () => {
  it('正常入库：记录带 origin/sourceUrl/fetchedAt，锚点来自标题扫描，正文可读回', async () => {
    const result = await ingestWebMaterial({
      userId: 'user_web1',
      url: 'http://www.moe.gov.cn/example/law.html',
      title: '中华人民共和国未成年人保护法',
      text: WEB_TEXT,
    });
    expect(result).not.toBeNull();
    expect(result!.deduped).toBe(false);
    const record = result!.record;
    expect(record.origin).toBe('web');
    expect(record.sourceUrl).toBe('http://www.moe.gov.cn/example/law.html');
    expect(record.fetchedAt).toBeTruthy();
    expect(record.format).toBe('web');
    expect(record.charCount).toBeGreaterThan(50);
    // 锚点来自 markdown 标题（与上传同一套解析）
    const headings = record.anchors.map((anchor) => anchor.heading);
    expect(headings.some((heading) => heading.includes('第一章'))).toBe(true);

    const stored = readMaterial('user_web1', record.id);
    expect(stored?.markdown).toContain('第二十五条');
    // 库清单可见（brief 惰性管线因此自动覆盖）
    expect(listMaterials('user_web1').some((item) => item.id === record.id)).toBe(true);
  });

  it('URL 去重：同 URL 二次入库返回既有记录（deduped=true），不产生新文件', async () => {
    const first = await ingestWebMaterial({ userId: 'user_web2', url: 'https://a.example.com/x', title: '第一次', text: WEB_TEXT });
    const countBefore = listMaterials('user_web2').length;
    const second = await ingestWebMaterial({ userId: 'user_web2', url: 'https://A.example.com/x/#frag', title: '第二次', text: WEB_TEXT });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.deduped).toBe(true);
    expect(second!.record.id).toBe(first!.record.id);
    expect(listMaterials('user_web2')).toHaveLength(countBefore);
  });

  it('不同用户互不去重（资料挂用户）', async () => {
    const a = await ingestWebMaterial({ userId: 'user_web3', url: 'https://b.example.com/y', title: 'T', text: WEB_TEXT });
    const b = await ingestWebMaterial({ userId: 'user_web4', url: 'https://b.example.com/y', title: 'T', text: WEB_TEXT });
    expect(a!.record.id).not.toBe(b!.record.id);
  });

  it('正文过短被文本闸门拒收 → 返回 null 不落盘', async () => {
    const result = await ingestWebMaterial({ userId: 'user_web5', url: 'https://c.example.com/z', title: '太短', text: '只有一句话' });
    expect(result).toBeNull();
    expect(listMaterials('user_web5')).toHaveLength(0);
  });

  // 真机发现（2026-10-16）：采集偶尔抓到下载落地页/纯导航页——正文全是面包屑与元信息，
  // 被样板规则过滤后切不出任何可召回块；这种记录入库只会占位并让语义层静默不可用。
  it('正文无可召回内容（纯面包屑/元信息）→ 拒收不落盘', async () => {
    const breadcrumb =
      '当前位置： 首页 > 法律法规 > 法律法规数据库 > 法律法规详情 2026法律职业资格考试大纲目录.pdf 下载 239 KB 下载数 311 更新时间 2026-09-28 适用范围：法考考生';
    const result = await ingestWebMaterial({ userId: 'user_web8', url: 'https://e.example.com/dl', title: '下载页', text: breadcrumb });
    expect(result).toBeNull();
    expect(listMaterials('user_web8')).toHaveLength(0);
  });

  it('缺参数（空 userId/url/text）→ null', async () => {
    expect(await ingestWebMaterial({ userId: '', url: 'https://x.com', title: 't', text: WEB_TEXT })).toBeNull();
    expect(await ingestWebMaterial({ userId: 'u', url: '', title: 't', text: WEB_TEXT })).toBeNull();
    expect(await ingestWebMaterial({ userId: 'u', url: 'https://x.com', title: 't', text: '   ' })).toBeNull();
  });

  it('超长正文 160K 截断', async () => {
    const long = '一'.repeat(220_000);
    const result = await ingestWebMaterial({ userId: 'user_web6', url: 'https://d.example.com/long', title: '长文', text: long });
    expect(result).not.toBeNull();
    expect(result!.record.charCount).toBeLessThanOrEqual(160_100);
    expect(result!.record.warnings.join(' ')).toContain('截断');
  });

  it('扁平正文（无 ATX 标题）→ 入库时恢复章节结构，anchors 非空', async () => {
    const body = '这一条讲的是管理对象与适用范围，需要逐字回看原文才能确认。';
    const text = [
      '安全生产管理',
      '第一篇 总则',
      '第一章 基本规定',
      body,
      '第二章 监督管理',
      body,
      '第三章 法律责任',
      body,
    ].join('\n');
    const result = await ingestWebMaterial({
      userId: 'user_web7',
      url: 'https://e.example.com/structured',
      title: '安全生产管理',
      text,
    });
    expect(result).not.toBeNull();
    expect(result!.record.anchors.length).toBeGreaterThanOrEqual(3);
    expect(result!.record.anchors.map((a) => a.heading).join('|')).toContain('第一章 基本规定');
    expect(result!.record.structure.headingCount).toBeGreaterThanOrEqual(3);
  });
});

describe('normalizeSourceUrl', () => {
  it('去 hash、去尾斜杠、host 小写', () => {
    expect(normalizeSourceUrl('https://WWW.Example.com/a/b/')).toBe('https://www.example.com/a/b');
    expect(normalizeSourceUrl('https://www.example.com/a#section')).toBe('https://www.example.com/a');
    expect(normalizeSourceUrl('https://www.example.com/a?x=1')).toBe('https://www.example.com/a?x=1');
    expect(normalizeSourceUrl('not a url')).toBe('not a url');
  });
});

describe('findWebRecordByTitle 库优先查找', () => {
  it('标题归一互相包含即命中（need 带书名号、库记录是页面标题）', async () => {
    await ingestWebMaterial({
      userId: 'user_web7',
      url: 'https://e.example.com/guide',
      title: '《3—6岁儿童学习与发展指南》全文 - 教育部',
      text: WEB_TEXT,
    });
    const hit = findWebRecordByTitle('user_web7', '《3-6岁儿童学习与发展指南》');
    expect(hit).not.toBeNull();
    expect(hit!.origin).toBe('web');
    // 未入库用户 → null
    expect(findWebRecordByTitle('user_web8', '《3-6岁儿童学习与发展指南》')).toBeNull();
    // 上传资料（origin≠web）不参与匹配
    expect(findWebRecordByTitle('user_web7', '太短')).toBeNull();
  });
});
