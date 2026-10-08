/**
 * 课堂页知识点浮窗护栏（2026-10-08 用户侧走查：「不要抽屉页面，改成悬浮窗，像 goal 阶段那样」）
 *
 * 原实现是 `position: fixed` 的左侧全高抽屉 + `inset: 0` 遮罩：一打开遮住整页、
 * 对话区不可点，移动端看起来像换了一个页面。改后是头部入口下方的非模态浮窗：
 * 定位框为 .learn__head-right（position: relative），绝对定位不占对话布局高度、
 * 宽度按视口收敛（移动端不会从左侧溢出）、内容超出时浮窗内部滚动，且不再有遮罩。
 *
 * 这里锁住的是「几何与语义」这类回归时最容易悄悄改回去的点，不看像素值。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPage.vue'), 'utf8');

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleAfter(selector: string): string {
  const css = stripComments(source);
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
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule);
  return m ? m[1].trim() : null;
}

describe('课堂页知识点浮窗（原全高抽屉退役）', () => {
  it('遮罩层整体退役：既无 .kp-scrim 规则，也无它的淡入关键帧', () => {
    expect(stripComments(source), '又出现了 .kp-scrim 遮罩').not.toContain('.kp-scrim');
    expect(source, '遮罩的淡入关键帧应一并删掉').not.toContain('kp-fade-in');
    // 模板里也不该再有 scrim 节点
    expect(source).not.toContain('class="kp-scrim"');
  });

  it('浮窗是锚定在头部入口下方的绝对定位盒子，不再压满全高、不再横滑入', () => {
    const kp = ruleAfter('.kp {');
    expect(decl(kp, 'position'), '抽屉又回来了（fixed 全高）').toBe('absolute');
    // 全高抽屉的三件套：inset 铺满 / bottom 贴底 / translateX(-102%) 横滑入场
    expect(decl(kp, 'bottom'), '又出现了贴底（全高抽屉特征）').toBeNull();
    expect(decl(kp, 'inset')).toBeNull();
    expect(decl(kp, 'transform') ?? '', '又出现了横滑入场').not.toContain('translateX');
    // 宽度按视口收敛：移动端从右侧定位时左侧不会溢出屏幕
    expect(decl(kp, 'width'), '浮窗宽度没有按视口收敛').toContain('100vw');
    expect(decl(kp, 'right')).toBe('0');
  });

  it('浮窗自带高度上限与内部滚动，不会把对话区顶出视口', () => {
    const kp = ruleAfter('.kp {');
    expect(decl(kp, 'max-height'), '没有高度上限，长知识点列表会超出视口').toMatch(/dvh|vh/);
    expect(decl(kp, 'overflow') ?? decl(kp, 'overflow-y')).toBe('auto');
  });

  it('定位框就是头部右侧控件组（锚点容器必须 position: relative）', () => {
    // 用带 `{` 的选择器取规则：模板里的 HTML 注释也写过 `.learn__head-right`，不带花括号会命中注释
    expect(decl(ruleAfter('.learn__head-right {'), 'position')).toBe('relative');
    // 窄屏那条重排规则不能把定位上下文丢掉
    const mobile = ruleAfter('.learn__head-right { grid-column');
    expect(decl(mobile, 'position'), '窄屏重排覆盖掉了定位上下文').toBe('relative');
  });

  it('浮窗挂在页头内（.learn__head-right 里），不再留在对话正文区', () => {
    const panelAt = source.indexOf('<aside v-if="knowledgePoints.length" id="learn-kp-panel"');
    const headerEnd = source.indexOf('</header>');
    const bodyAt = source.indexOf('class="learn__body"');
    expect(panelAt).toBeGreaterThan(-1);
    expect(panelAt, '浮窗被挪回正文区了').toBeLessThan(headerEnd);
    expect(panelAt).toBeLessThan(bodyAt);
  });
});
