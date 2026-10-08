/**
 * 引导页演示卡护栏（2026-10-08 用户侧走查 #6 / #7）
 *
 * #6：生成路径那一步的三张阶段卡里，非当前阶段的整卡 opacity:.72 会把卡内 12px 的
 *     「已完成 / 待开始」一起压淡（1440×900 浅色实测 2.93:1，当前阶段同名文字 5.07:1）。
 *     弱化改落在边框上，文字不再参与整卡透明度。
 * #7：第 4 步的「学习台」演示卡是写给所有新用户的静态样例（真实学习台此时是空态），
 *     卡上必须有「示例」标识，且不能把 14 / 33 这类具体数值写成「你的」数据。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Onboarding.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
const template = source.slice(0, source.indexOf('<style'));

function blockAt(start: number): string {
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

/** 取「声明块里含该属性」的那一条规则（同名选择器可能有多条） */
function ruleHaving(selector: string, prop: string): string {
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:`);
  for (let from = 0; from >= 0; ) {
    const start = css.indexOf(selector, from);
    if (start < 0) break;
    const block = blockAt(start);
    if (re.test(block)) return block;
    from = start + 1;
  }
  throw new Error(`没有找到带 ${prop} 的 ${selector}`);
}

const decl = (rule: string, prop: string): string | null =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;

const ruleFor = (selector: string): string => {
  const start = css.indexOf(selector);
  expect(start, `找不到 ${selector}`).toBeGreaterThan(-1);
  return blockAt(start);
};

describe('引导页演示卡（走查 2026-10-08 #6 / #7）', () => {
  it('#6 非当前阶段不再整卡降透明度，文字对比度不再被压', () => {
    const stage = ruleFor('.ob__stage {');
    expect(decl(stage, 'opacity'), '.ob__stage 整卡 opacity 会让卡内 12px 状态字一起变淡').toBeNull();
    expect(decl(stage, 'border'), '弱化应落在边框上（按原 72% 合成值）').toContain('72%');
  });

  it('#6 只有装饰图标保留 0.72，当前阶段图标恢复满色', () => {
    expect(decl(ruleHaving('.ob__stage i', 'opacity'), 'opacity')).toBe('0.72');
    expect(decl(ruleHaving('.ob__stage.is-on i', 'opacity'), 'opacity')).toBe('1');
  });

  it('#6 状态小字仍用语义 token，≥12px', () => {
    const small = ruleHaving('.ob__stage small', 'font-size');
    expect(decl(small, 'font-size')).toBe('12px');
    expect(decl(small, 'color')).toBe('var(--faint)');
    // ≤640 档隐藏状态小字（手机档不受 #6 影响），桌面档不得隐藏
    const firstMobile = css.indexOf('@media (max-width: 640px)');
    expect(firstMobile, '找不到 ≤640 媒体块').toBeGreaterThan(-1);
    const hideStart = css.indexOf('.ob__stage small', firstMobile);
    expect(hideStart, '状态小字的隐藏规则必须落在 ≤640 档').toBeGreaterThan(firstMobile);
    expect(decl(blockAt(hideStart), 'display')).toBe('none');
  });

  it('#7 学习台演示卡标注「示例」，且不再编具体指标值', () => {
    const step4 = template.slice(template.indexOf('key="s4"'));
    expect(step4).toContain('<span class="ob__sample">示例</span>');
    // 14 / 33 是整块写给所有新用户的静态值，会被读成「你的」数据
    expect(step4).not.toMatch(/<b>\s*14\s*<\/b>/);
    expect(step4).not.toMatch(/<b>\s*33\s*<\/b>/);
    expect(step4).toContain('<small>健康度</small>');
    expect(step4).toContain('<small>疲劳度</small>');
  });

  it('#7 「示例」角标用现有语义 token，字号不低于 12px', () => {
    const sample = ruleFor('.ob__sample {');
    expect(decl(sample, 'font-size')).toBe('12px');
    expect(decl(sample, 'color')).toBe('var(--faint)');
    expect(decl(sample, 'border')).toContain('var(--line)');
  });
});
