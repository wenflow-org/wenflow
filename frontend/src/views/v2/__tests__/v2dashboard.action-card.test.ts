/**
 * 学习台行动卡 / 路径卡护栏（2026-10-08 用户侧视觉检查）
 *
 * 病根一：今日行动说明在提示条在场时按 32 字硬切，切出的是
 *   「取一条自己手头的真实日志行（带时间戳、级别、进程号、消息体的那一…」
 * ——停在半个短语上、左括号都没闭合（390 与 1440 两档截图都可见）。
 * 现在只保留「首句 / 首个分句」的语义裁剪，长度交给两行 CSS 截断兜底。
 *
 * 病根二：.dash__grid-main 是 stretch，路径卡被拉到与左侧行动卡等高，
 * 而路径卡内容全部堆在顶部，卡底留下约三分之一卡高的空白。让 .path__foot
 * 带 margin-top:auto 沉到卡底，空白变成正常的卡脚留白。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Dashboard.vue'), 'utf8');

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

/** 取 `const actionDesc = computed(` 起的那段脚本，用于断言里面不再有按字数硬切 */
function actionDescBlock(): string {
  const start = source.indexOf('const actionDesc = computed(');
  expect(start, '源码里找不到 actionDesc').toBeGreaterThan(-1);
  const end = source.indexOf('});', start);
  return source.slice(start, end + 3);
}

describe('学习台：说明文字与路径卡底边', () => {
  it('今日行动说明不再按字数硬切（32 字切法会把括号切在半截）', () => {
    const block = actionDescBlock();
    expect(block, '又出现了 32 字截断').not.toMatch(/slice\(0,\s*32\)/);
    expect(block, '又出现了 64 字截断').not.toMatch(/slice\(0,\s*64\)/);
    // 只保留了「取首句 / 取首个分句」的语义裁剪
    expect(block, '首句裁剪被删掉了，说明会整段铺开').toContain('split(');
  });

  it('行动说明用两行视觉截断兜住高度，且只夹今日行动那一处', () => {
    const task = ruleAfter('.action__desc--task');
    expect(decl(task, '-webkit-line-clamp')).toBe('2');
    expect(decl(task, 'overflow')).toBe('hidden');
    // 状态类文案（生成中/失败/空态）不夹，否则「你也可以先去别的页面看看」会被切掉
    const base = ruleAfter('.action__desc ');
    expect(decl(base, '-webkit-line-clamp'), '.action__desc 基础类被夹了').toBeNull();
  });

  it('路径卡页脚吸底（等高拉伸后空白不再堆在卡底）', () => {
    expect(decl(ruleAfter('.path__foot'), 'margin-top')).toBe('auto');
  });
});
