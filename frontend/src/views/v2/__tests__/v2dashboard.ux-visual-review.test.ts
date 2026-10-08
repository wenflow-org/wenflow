/**
 * 学习台视觉走查回归（2026-10-08 用户侧走查 #53 / #54 / #56 / #73 / #74 / #75）
 *
 * #53 页脚上方「内容由 AI 生成…」12px 灰字原来又叠了 opacity:.75，--faint(#5f6f8c)
 *     被抬成有效色 rgb(133,145,168)，对页面底 #f7f8fa 只有 2.99:1（深色档 3.93:1），
 *     低于 AA 4.5:1。去掉透明度即回到 --faint 原色（浅色档 ≈4.77:1）。
 * #54 次入口 .link-muted 桌面档可点热区约 117×30，低于 36px；手机档靠 ≤1100 的
 *     min-height:40 兜底，两档标准不一。把 min-height:36 + inline-flex 提进基础样式。
 * #56 问候行右侧「点亮连续记录」药丸是动词短语 + 实底药丸外形，读作可点操作，
 *     实际是不可点的状态徽章；0 态改成陈述句「连续 0 天」。
 * #73 .dash__grid-main 等高双列把路径卡拉到与左卡同高，中部留出 130–158px 空白；
 *     给 .path 加 align-self:start 按内容定高。
 * #74 卡头「到期 9」与正文「先复习 1 个」两个数字量不同且无交代，且裸数字缺量词；
 *     卡头补「个知识点」，正文补一句交代其余去向。
 * #75 成就提示直出内部缩写 KTL，与成就页「知识掌握度（KTL）」口径不一致；同步展开。
 *
 * 沿用仓库既有的「源码锁」写法：读 SFC 源码、花括号配平取规则、断言声明/文案。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Dashboard.vue'), 'utf8');
// CSS/JS 注释里会引用旧值（如「原来叠了 opacity」），去掉后再断言，避免误命中
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
// 模板注释同理（#56 的说明里写了旧文案「点亮连续记录」）
const html = source.slice(0, source.indexOf('<script')).replace(/<!--[\s\S]*?-->/g, '');

/** 从 start 处起取花括号配平的声明块 */
function ruleAt(start: number): string {
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('声明块不配平');
}

/** 取选择器后的声明块（花括号配平），不依赖换行符（工作区是 CRLF） */
function ruleAfter(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `样式里没有 ${selector}`).toBeGreaterThan(-1);
  return ruleAt(start);
}

const decl = (rule: string, prop: string): string | null =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;

const px = (v: string | null): number => Number((v ?? '').replace('px', ''));

describe('学习台页脚 AI 免责声明对比度（走查 2026-10-08 #53）', () => {
  const aiNote = () => ruleAfter('.dash__ai-note :deep(.ai-note)');

  it('不再叠 opacity（否则 --faint 有效色对比度掉到 2.99:1，低于 AA 4.5:1）', () => {
    expect(decl(aiNote(), 'opacity'), 'AI 提示又叠了透明度，对比度会重新掉到 AA 以下').toBeNull();
    expect(decl(aiNote(), 'filter'), '不要用 filter 换个方式压淡同一行字').toBeNull();
  });

  it('字号维持 12px 门禁下限（不靠缩小字号换对比度）', () => {
    expect(px(decl(aiNote(), 'font-size'))).toBeGreaterThanOrEqual(12);
  });
});

describe('学习台次入口 .link-muted 触控热区（走查 2026-10-08 #54）', () => {
  it('基础样式就有 36px 下限，桌面档不再靠手机档兜底', () => {
    const base = ruleAfter('.link-muted {');
    expect(px(decl(base, 'min-height')), '桌面档又矮回 30px，触控打不中').toBeGreaterThanOrEqual(36);
    expect(decl(base, 'display')).toBe('inline-flex');
    expect(decl(base, 'align-items')).toBe('center');
  });

  it('手机档的 40px 覆盖仍存在（不因基础样式补齐而放宽）', () => {
    // 手机档的 .link-muted 覆盖写在最后一个 <style> 块的 ≤1100 媒体查询里
    const idx = css.lastIndexOf('.link-muted {');
    expect(idx).toBeGreaterThan(css.indexOf('.link-muted {'));
    expect(px(decl(ruleAt(idx), 'min-height')), '手机档 40px 被基础样式顶掉').toBeGreaterThanOrEqual(40);
  });
});

describe('学习台连续记录药丸（走查 2026-10-08 #56）', () => {
  it('0 态用陈述句，不再用「点亮连续记录」这类动词短语冒充按钮', () => {
    expect(html).toContain('连续 0 天');
    expect(html, '0 态又写成动宾短语，看起来像能点').not.toContain('点亮连续记录');
  });

  it('0 态文字改用更深的次级令牌（原 --faint 叠药丸底仅 4.22:1，低于 AA）', () => {
    expect(decl(ruleAfter('.streak--off {'), 'color')).toBe('var(--muted)');
  });
});

describe('学习台路径卡空白（走查 2026-10-08 #73）', () => {
  it('.path 不再被等高网格拉高（align-self:start）', () => {
    expect(decl(ruleAfter('.path {'), 'align-self')).toBe('start');
  });
});

describe('学习台到期/复习口径（走查 2026-10-08 #74）', () => {
  it('卡头数字带量词（「N 个知识点到期」）', () => {
    expect(source).toContain('${reviewDue.value.length} 个知识点到期');
  });

  it('正文交代计划外复习的去向（其余 N 个按今日额度排队）', () => {
    expect(source).toContain('个旧知识点，其余');
    expect(source).toContain('按今日额度排队');
  });
});

describe('学习台成就提示 KTL 释义（走查 2026-10-08 #75）', () => {
  it('直出前补全中文释义，与成就页口径一致', () => {
    expect(source).toContain("replace(/KTL/g, '知识掌握度（KTL）')");
  });
});
