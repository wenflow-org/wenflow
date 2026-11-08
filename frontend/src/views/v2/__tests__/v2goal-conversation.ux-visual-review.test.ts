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

  it('2026-11-06 走查：步骤条随行计数退役（PC 左栏画像卡常驻同一读数，同屏两处计数是重复）', () => {
    expect(source, 'stage-nav__sub 应整体移除：计数由左栏画像卡承担，移动端由面板角标承担').not.toContain('stage-nav__sub');
    expect(source, '面板头计数仍要保留（唯一的已收集读数出口）').toContain('live.filledCount }} / {{ live.totalFields');
  });

  it('#60 完成态浮层动作行撑满、主按钮独占余宽（桌面档）', () => {
    const wide = mediaBlock(lastStyle, '(min-width: 1101px)');
    expect(decl(ruleOf(wide, '.proposal__actions--center'), 'width'), '动作行仍按内容宽居中，主按钮旁边空一大片').toBe('100%');
    const primary = ruleOf(wide, '.proposal__actions--center .btn-primary');
    expect(decl(primary, 'flex'), '主按钮没吃满余宽，「查看我的路径」仍是一小块').toBe('1');
    expect(decl(primary, 'justify-content'), '拉满后按钮文字没居中').toBe('center');
  });
});

/**
 * 入口态「现代 AI 首页范式」重排（2026-11-07 用户走查第二轮）：
 *
 * 用户原话：「顺序反了（『试试这些方向』挡在了标题和输入框中间，喧宾夺主）」「输入框太单薄
 * （和上面 3 个框高度一模一样）」「标题左对齐导致头重脚轻」。要求改成
 * 居中标题 → 大号多行输入卡 → 底部轻量灵感胶囊。
 *
 * 本 describe 逐条锁死新结构：
 *  ① 视觉顺序 = 标题/副标题 → 输入大卡 → 灵感胶囊 → 最近会话（回访降为次级）；
 *  ② 标题居中且抬到 24px（全站桌面比例档上限），副标题 14px 居中；
 *  ③ 桌面档输入框升级 110px 多行面板（textarea 独占一行 + 底部动作行）；
 *  ④ 示例方向降为 32px 透明胶囊（圆角 999），与输入卡形成 ~3:1 体量差；
 *  ⑤ 旧的「3 列小方卡 / 行尾 › / 卡片灰底」整层退役（不留死样式）。
 */
describe('入口态：居中标题 → 大输入卡 → 轻量胶囊（2026-11-07 走查）', () => {
  /** 模板里某个字面量首次出现的位置（用于断言视觉顺序） */
  const at = (needle: string) => source.indexOf(needle);

  it('① 视觉顺序：标题 → 输入大卡 → 灵感胶囊 → 最近会话', () => {
    const hero = at('class="entry__hero"');
    const composer = at('class="composer composer--entry"');
    const cards = at('class="entry__cards"');
    const recent = at('class="recent"');
    expect(hero).toBeGreaterThan(-1);
    expect(composer, '输入大卡不在模板里').toBeGreaterThan(-1);
    expect(cards, '灵感胶囊不在模板里').toBeGreaterThan(-1);
    expect(recent, '最近会话不在模板里').toBeGreaterThan(-1);
    expect(composer, '「试试这些」又插到标题与输入框之间了（本轮要修的就是这个）').toBeGreaterThan(hero);
    expect(cards, '灵感胶囊应排在输入大卡之后').toBeGreaterThan(composer);
    expect(recent, '最近会话应排到胶囊之后（回访是次级动作）').toBeGreaterThan(cards);
  });

  it('② 标题居中并抬到 24px，副标题 14px 居中', () => {
    const hero = ruleOf(allStyles, '.entry__hero');
    expect(decl(hero, 'flex-direction'), 'hero 退回横排：恢复卡会横在标题右侧').toBe('column');
    expect(decl(hero, 'align-items'), 'hero 没居中').toBe('center');
    expect(decl(hero, 'text-align'), '标题仍左对齐（用户原话「缩在左上角」）').toBe('center');
    const h1 = ruleOf(allStyles, '.entry__hero h1');
    expect(decl(h1, 'font-size'), '标题仍是 20px 以下，压不住整页').toBe('clamp(20px, 2.4vw, 24px)');
    const p = ruleOf(allStyles, '.entry__hero p');
    expect(decl(p, 'font-size')).toBe('14px');
    expect(decl(p, 'max-width'), '#55 的 640 列护栏不能动').toBe('640px');
  });

  it('③ 输入框是百来像素的多行面板（textarea 独占一行 + 底部动作行，两档同款）', () => {
    /* 选择器必须带 .entry 前缀：≤1100 档的 `.composer__box { padding: 6px }`（会话态底条用）
       后出现且同特异性，只用 `.composer--entry .composer__box` 会被它顶掉内衬 */
    const box = ruleOf(allStyles, '.entry .composer--entry .composer__box');
    expect(decl(box, 'min-height'), '输入框还是 54px 扁条，与胶囊同高').toBe('110px');
    expect(decl(box, 'padding'), '内衬被窄屏档顶掉，卡片又瘪回去').toBe('14px 16px');
    expect(decl(box, 'border-radius'), '输入大卡圆角没到 16px').toBe('16px');
    expect(decl(box, 'flex-wrap'), '不换行就无法把 textarea 顶成独立一行').toBe('wrap');
    const ta = ruleOf(allStyles, '.entry .composer--entry .composer__textarea');
    expect(decl(ta, 'flex'), 'textarea 没占满首行').toBe('1 0 100%');
    expect(decl(ta, 'min-height'), '首行输入区太矮，没有「多行面板」的体量').toBe('52px');
    expect(decl(ta, 'order'), 'order 不是 0：DOM 里回形针在前，会折成三行').toBe('0');
    expect(decl(ruleOf(allStyles, '.entry .composer--entry .composer__send'), 'order')).toBe('2');
  });

  it('③b 焦点环画在外层大卡上，textarea 自己不再套直角蓝框', () => {
    /* mk-primitives 的 `:root :focus-visible`（0,2,0）会盖住 `.composer__textarea`（0,1,0）
       的 outline: none，在圆角卡里套出一个直角蓝框（用户 图1）。必须用 :focus-visible 变体
       把特异度提到 0,3,0 才压得住。 */
    expect(allStyles, 'textarea 又会被 :root :focus-visible 套上直角蓝框').toContain('.composer__textarea:focus-visible');
    const rule = ruleOf(allStyles, '.composer__textarea:focus-visible');
    expect(decl(rule, 'outline')).toBe('none');
    // 焦点可见性由外层大卡的 focus-within 环承担（同一圈 --mk-focus-ring）
    const box = ruleOf(allStyles, '.composer__box:focus-within');
    expect(box, '外层大卡没有焦点环：去掉内层 outline 后键盘用户将看不到焦点').toContain('var(--mk-focus-ring)');
  });

  it('③c 窄屏固定间距（不再 space-evenly 把胶囊顶到视口底部）', () => {
    const narrow = mediaBlock(allStyles, '(max-width: 1100px)');
    const entry = ruleOf(narrow, '.entry');
    expect(decl(entry, 'justify-content'), 'space-evenly 又把输入框与胶囊撑到两端（图2 的 180px 白洞）').toBe('center');
  });

  it('④ 示例方向是 32px 透明胶囊（不再是同宽同底色的卡片）', () => {
    const row = ruleOf(allStyles, '.entry__cards');
    expect(decl(row, 'display'), '胶囊行退回 grid 三列').toBe('flex');
    expect(decl(row, 'flex-wrap')).toBe('wrap');
    expect(decl(row, 'justify-content'), '胶囊行没居中').toBe('center');
    const card = ruleOf(allStyles, '.scene-card');
    expect(decl(card, 'height'), 'lt36 预算恒为 0：胶囊盒子不许低于 36px').toBe('36px');
    expect(decl(card, 'border-radius'), '没做成胶囊（999）').toBe('999px');
    expect(decl(card, 'background'), '胶囊不该有实底：会和输入框抢材质').toBe('transparent');
    expect(decl(card, 'font-size')).toBe('13px');
    // 池子里的图标是 18px 的 svg，字号必须落在 svg 上
    expect(ruleOf(allStyles, '.scene-card__icon svg')).toContain('width: 15px');
  });

  it('⑤ 上一版「3 列小方卡」整层退役（不留死样式）', () => {
    expect(source, '行尾 › 已从模板移除，样式/媒体查询也要一并删').not.toContain('scene-card__go');
    expect(source, '旧的三列头（标题 + 换一批独占一行）已并入胶囊行').not.toContain('entry__cards-head');
    expect(source, '重复保留的深色卡片底色覆写已无对象').not.toContain("[data-theme='dark'] .scene-card");
    expect(source, '旧的三列网格已撤').not.toContain('repeat(3, minmax(0, 1fr))');
  });
});
