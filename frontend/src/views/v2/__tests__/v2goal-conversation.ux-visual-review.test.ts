/**
 * 「目标规划」页用户侧视觉走查（2026-10-08）四条修复的源码锁：
 *
 *  #55 入口副标题被 52ch（≈412px @13.5px）挤成两行、第二行只剩「段安排。」
 *      —— 同列卡片/输入框都是 640px，整句本来一行放得下。副标题回到 640 这条列。
 *  #58 点「确认，生成我的路径」后 stageIndex 仍停在 3，面板顶继续喊「可生成路径」，
 *      与正在转的生成浮层矛盾 —— 生成态改为跟随 phase。
 *  #57 澄清期状态字恒为「继续澄清中」：1/7、4/7、5/7 三屏同字，读不出「还差什么、
 *      何时进下一步」—— 改为由 7 项清单推导的「还差 N 项关键信息」，并在第 1 步
 *      右侧给出「已收集 N/7」，把步骤条与清单对应起来。
 *  #60 完成态浮层动作行按内容宽（247px）居中在 620px 卡片里、左右各空 ~187px，
 *      「查看我的路径」没有占住视觉重心 —— 桌面档让动作行撑满、主按钮独占余宽。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2GoalConversation.vue'), 'utf8');

const { descriptor, errors } = parse(source);
const styleBlocks = descriptor.styles.map((s) => s.content);
/** 全量样式（注释里也会出现选择器字样，ruleOf 里先剥注释再找） */
const allStyles = styleBlocks.join('\n');
/** 最后一个 <style> 块：媒体查询覆盖规则按仓库规矩必须落在这里 */
const lastStyle = styleBlocks[styleBlocks.length - 1] ?? '';

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 从字面 `.cls {` 起花括号配平，取出一条声明块 */
function ruleOf(cssRaw: string, selector: string): string {
  const css = stripComments(cssRaw);
  const start = css.indexOf(`${selector} {`);
  expect(start, `样式里没有 ${selector} 规则`).toBeGreaterThan(-1);
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

/** 取一个 `const X = computed(() => {…})` 的整块（模板串里的 ${…} 花括号自平衡，不影响配平） */
function computedBlock(name: string): string {
  const marker = `const ${name} = computed(() => {`;
  const start = source.indexOf(marker);
  expect(start, `没找到 ${name} 的 computed`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} 的 computed 不配平`);
}

/** 从字面 `@media (…) {` 起花括号配平地取出整个媒体查询块 */
function mediaBlock(css: string, query: string): string {
  const marker = `@media ${query} {`;
  const start = css.indexOf(marker);
  expect(start, `最后一个 <style> 块里没有 ${marker}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`${marker} 不配平`);
}

describe('目标规划页：用户侧视觉走查四条修复', () => {
  it('模板可解析（源码锁的前提）', () => {
    expect(errors).toEqual([]);
  });

  it('#55 入口副标题与卡片列同为 640px（不再被 52ch 挤成两行）', () => {
    const hero = ruleOf(allStyles, '.entry__hero p');
    expect(decl(hero, 'max-width'), '副标题仍被收窄，第二行会只剩「段安排。」').toBe('640px');
    // 护栏不腐化：卡片列确实是 640（副标题跟的是同一列宽）
    expect(decl(ruleOf(allStyles, '.entry__cards'), 'max-width')).toBe('640px');
  });

  it('#58 生成态阶段标签跟随 phase，不再只看 stageIndex', () => {
    const block = computedBlock('stageLabel');
    const gen = block.indexOf("phase.value === 'generating'");
    const s3 = block.indexOf('live.stageIndex === 3');
    expect(gen, 'stageLabel 没有 phase==="generating" 分支：点确认后仍会喊「可生成路径」').toBeGreaterThan(-1);
    expect(gen, 'stageIndex 检查排在 phase 之前，生成态仍会返回「可生成路径」').toBeLessThan(s3);
    expect(block).toContain('生成中');
  });

  it('#57 澄清期状态字由 7 项清单推导（1/7 与 5/7 不再同字）', () => {
    // 注释里也会提到旧文案，先剥注释再看代码
    const block = stripComments(computedBlock('stageLabel'));
    expect(block, '状态字不再引用已收集/总项数，仍是不变的「继续澄清中」').toContain('live.totalFields - live.filledCount');
    expect(block).toContain('还差');
    expect(block, '静态兜底文案又回来了：三屏同字的问题会复发').not.toContain('继续澄清中');
  });

  it('#57 步骤条第 1 步挂「已收集 N/7」，且窄屏隐藏（该行余量只有 ~11px）', () => {
    expect(source, '第 1 步没有随行计数，步骤条与 7 项清单无从对应').toContain('class="stage-nav__sub"');
    expect(source).toContain('{{ live.filledCount }}/{{ live.totalFields }}');
    // 基础档字号 ≥12（mobile:spec fonts 口径）
    const sub = ruleOf(allStyles, '.stage-nav__sub');
    expect(Number((decl(sub, 'font-size') || '').replace('px', ''))).toBeGreaterThanOrEqual(12);
    // 隐藏规则必须在最后一个 <style> 块的 max-width 媒体查询里（写在中间会被后续桌面规则盖成死代码）
    const narrow = mediaBlock(lastStyle, '(max-width: 1100px)');
    expect(decl(ruleOf(narrow, '.stage-nav__sub'), 'display'), '窄屏没隐藏随行计数，会挤破阶段导航那一行').toBe('none');
  });

  it('#60 完成态浮层动作行撑满、主按钮独占余宽（桌面档）', () => {
    const wide = mediaBlock(lastStyle, '(min-width: 1101px)');
    expect(decl(ruleOf(wide, '.proposal__actions--center'), 'width'), '动作行仍按内容宽居中，主按钮旁边空一大片').toBe('100%');
    const primary = ruleOf(wide, '.proposal__actions--center .btn-primary');
    expect(decl(primary, 'flex'), '主按钮没吃满余宽，「查看我的路径」仍是一小块').toBe('1');
    expect(decl(primary, 'justify-content'), '拉满后按钮文字没居中').toBe('center');
  });
});
