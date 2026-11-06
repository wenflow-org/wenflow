/**
 * 资料库卡片「章节」行的护栏（2026-11-06 走查：那一行还是一条长文 + 裸露 markdown）
 *
 * 实测样本《党政机关公文处理工作条例》：anchors 只有 2 条——
 *  [0] 抓取页英文 H1（Regulations Regarding…）
 *  [1] 「第一章　总　　则 *第一条*　为了适应…」整行（5752 字，第一到第八章全在一行）
 * 之前只滤了英文，于是卡片上剩下第 [1] 条：一条两行长文，还带着 `*第一条*`。
 *
 * 本护栏锁：章节名必须过 materialHeadingOf（切到章节名/首句 + 去标记 + 截断），
 * 弹窗目录同一套清洗，且章节计数与清洗后的列表同源（不再出现「2 章」但只列一章）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Library.vue'), 'utf8');

describe('资料库章节名：脏锚点必须被收成可读标题', () => {
  it('章节列表走 materialHeadingOf（不是直接取 anchor.heading）', () => {
    expect(source).toContain("import { looksLikeEnglishTitle, materialHeadingOf, normalizeMaterialMarkdown } from '@/utils/materialText'");
    const list = source.slice(source.indexOf('function headingListOf'), source.indexOf('function headingsOf'));
    expect(list, '章节名没走清洗器').toContain('materialHeadingOf(raw)');
    expect(list, '直接铺 raw 会出现长行与 * 标记').not.toContain('headings.push(raw)');
  });

  it('卡片只展示前 4 条，计数与展示同源', () => {
    const headings = source.slice(source.indexOf('function headingsOf'), source.indexOf('function usageHint'));
    expect(headings).toContain('headingListOf(item).slice(0, 4)');
    const meta = source.slice(source.indexOf('function metaOf'), source.indexOf('function headingListOf'));
    expect(meta, '章节数还取 structure.headingCount（把英文 H1 也算进去了）').toContain('headingListOf(item).length');
  });

  it('弹窗目录同样清洗', () => {
    const toc = source.slice(source.indexOf('const previewTocTitles'), source.indexOf('const preview = reactive'));
    expect(toc).toContain('materialHeadingOf(');
  });
});
