/**
 * 路径详情页走查回归（2026-10-08 用户侧验收，发现 #64 / #65 / #77）
 *
 * #64 面包屑「‹ 路径列表」：电脑档实测 61×30，低于仓库 36px 触控硬线；同批页脚链接
 *     （V2Footer.vue）已单独修过，这条只锁本页 .crumbs__back 的电脑档基础规则。
 * #65 锁定任务行：原 `.task--locked { opacity: .62 }` 把整行连文字一起压暗，
 *     --faint(#5f6f8c 亮 / #90949b 暗) 对卡面只剩 2.45:1 / 2.91:1，任务名与「待解锁」读不清。
 *     现在弱化只做在图标上，正文保持 token 原色（亮 5.07:1 / 暗 5.29:1）。
 * #77 侧栏「设计意图」折叠箭头展开时原 rotate(90deg) 指向左侧，看不出是展开态；
 *     同页阶段卡 / 问题背景都用 rotate(180deg) 朝上，这里锁住统一后的方向。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPathDetail.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取选择器后的完整声明块（花括号配平），与仓库既有「源码锁」写法一致。 */
function ruleAfter(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `样式里没有 ${selector}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`${selector} 声明块不配平`);
}

function decl(rule: string, prop: string): string | null {
  return new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;
}

function px(rule: string, prop: string): number {
  return Number((decl(rule, prop) ?? '0px').replace('px', ''));
}

describe('路径详情 · 触控热区（#64）', () => {
  it('面包屑「‹ 路径列表」电脑档基础规则 ≥36px 高', () => {
    const rule = ruleAfter('.crumbs__back {');
    expect(decl(rule, 'display'), '得是 inline-flex 才能把 min-height 撑成热区').toContain('inline-flex');
    expect(decl(rule, 'align-items')).toContain('center');
    expect(px(rule, 'min-height'), '电脑档又只剩 padding 撑出的 30px').toBeGreaterThanOrEqual(36);
  });

  it('窄屏档仍更宽松（44px），没被基础规则反压', () => {
    expect(css, '窄屏的 44px 档被删了').toMatch(/\.crumbs__back\s*\{[^}]*min-height:\s*44px/);
  });
});

describe('路径详情 · 锁定任务可读性（#65）', () => {
  it('锁定行不再整行 opacity：正文要保住 4.5:1', () => {
    expect(css, '锁定行又整行压暗了（--faint 会掉到 2.45:1）').not.toContain('.task--locked {');
    expect(css, '锁定行不该再出现整行 opacity').not.toMatch(/\.task--locked\s*\{[^}]*opacity/);
  });

  it('弱化改做在图标上，且不碰正文/「待解锁」标签', () => {
    const icon = ruleAfter('.task--locked .task__icon');
    const op = Number(decl(icon, 'opacity') ?? '1');
    expect(op, '锁定图标又没有弱化了').toBeLessThan(1);
    expect(op, '图标弱化过头').toBeGreaterThanOrEqual(0.5);
    expect(decl(ruleAfter('.task__lock-label, .task__todo-label'), 'opacity'), '「待解锁」标签被单独压暗了').toBeNull();
  });
});

describe('路径详情 · 折叠箭头方向（#77）', () => {
  it('「设计意图」展开时箭头朝上（rotate 180deg），与阶段卡一致', () => {
    expect(decl(ruleAfter('.sidecard__chev--open {'), 'transform'), '箭头又转成朝左了').toBe('rotate(180deg)');
    expect(decl(ruleAfter('.stage__chev--open {'), 'transform'), '阶段卡方向变了？').toBe('rotate(180deg)');
  });
});
