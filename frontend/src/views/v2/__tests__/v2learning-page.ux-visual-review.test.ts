/**
 * 课堂页 2026-10-08 用户侧视觉走查修复的源码锁。
 *
 * #17/#21/#22/#70 头部「知识点 0/2」胶囊实测 82×26（手机）/86×28（电脑），
 *   低于 36px 触控地板，而它是知识点浮窗唯一入口 —— 补 min-height: 36px。
 * #62/#70 桌面档「‹ 返回路径详情」实测 87×20，是返回路径详情唯一鼠标出口 —— 补到 ≥36px 高。
 * #61     窄屏头部「学习中」与 12 字任务名抢宽度，末字孤行 —— 窄屏把状态收进 ⋯ 菜单。
 * #18     服务端把题干截 20 字 + 省略号当 title，与完整题干重复上屏 —— 改为前缀去重。
 * #19     判错讲解的 markdown 标记（`\d{2}` / **加粗**）按纯文本插值 —— 走 markdown 管线。
 * #66     开课准备态两处占位词 —— 任务详情并行返回即回填任务名。
 * #67     准备态等待预期「一般几秒到十几秒」与实际 45s 不符 —— 改区间 + 给退路。
 * #69     输入框聚焦时全局直角 outline 与外层圆角焦点环叠成两个框 —— 输入类退掉自身 outline。
 *
 * 一律不看像素值，只锁「几何/语义声明」，回归时最容易悄悄改回去的点。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPage.vue'), 'utf8');
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(source);

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
  const re = new RegExp(`(?:^|[;{\\s])${prop.replace('-', '\\-')}\\s*:`);
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
  new RegExp(`(?:^|[;{\\s])${prop.replace('-', '\\-')}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;

/** 全部 ≤900 媒体块（含内容），供「覆盖规则必须落在最后一块」的断言 */
function narrowBlocks(): string[] {
  return [...css.matchAll(/@media \(max-width: 900px\) \{/g)].map((m) => blockAt(m.index!));
}

describe('课堂页头部触控热区（#17/#21/#22/#62/#70）', () => {
  it('「知识点 0/2」胶囊补到 ≥36px 高（知识点浮窗唯一入口）', () => {
    const kpbtn = ruleHaving('.learn__kpbtn', 'min-height');
    expect(decl(kpbtn, 'min-height')).toBe('36px');
  });

  it('窄屏仍保留 36px 命中区（窄屏 padding 只给到 26px 高）', () => {
    const hit = narrowBlocks().filter((b) => b.includes('.learn__kpbtn'));
    expect(hit, '窄屏没有任何 .learn__kpbtn 规则').not.toHaveLength(0);
    const last = hit[hit.length - 1];
    expect(last).toMatch(/min-height\s*:\s*36px\s*;/);
  });

  it('桌面「‹ 返回路径详情」补到 ≥36px 高且文字垂直居中', () => {
    const back = ruleHaving('.learn__back', 'min-height');
    expect(decl(back, 'min-height')).toBe('36px');
    expect(decl(back, 'align-items'), '热区变高后文字没有垂直居中').toBe('center');
  });

  it('知识点按钮有可被读屏读到的 aria-label（走查复看未确认的点，按 #78 补上）', () => {
    // 名字要带上计数与开合状态，不能只写死一句「打开知识点」丢掉 <b> 里的进度
    const btn = /class="learn__kpbtn"[\s\S]{0,200}?aria-expanded/.exec(source)?.[0] ?? '';
    expect(btn, '知识点按钮找不到 aria-label').toMatch(/:aria-label="`知识点 \$\{masteredCount\}\/\$\{knowledgePoints\.length\}/);
    expect(btn, 'aria-label 没有随浮窗开合变化').toMatch(/kpOpen \? '收起' : '打开'/);
  });
});

describe('课堂页窄屏头部不再和标题抢宽度（#61）', () => {
  it('窄屏隐藏头部连接态，并把它移进 ⋯ 菜单', () => {
    const last = narrowBlocks();
    const tail = last[last.length - 1];
    expect(tail, '连接态在窄屏仍占头部宽度').toContain('.learn__live--head { display: none; }');
    expect(tail, '⋯ 菜单里的状态行没有在窄屏放出来').toMatch(/\.learn__menu-status\s*\{\s*display:\s*block;\s*\}/);
  });

  it('状态行默认只在菜单里出现（桌面头部仍常驻，不受影响）', () => {
    expect(ruleHaving('.learn__menu-status', 'display')).toMatch(/display\s*:\s*none\s*;/);
    expect(source, '模板里没有把连接态放进 ⋯ 菜单').toContain('class="learn__menu-status"');
    expect(source, '头部连接态丢了窄屏标记类').toContain('class="learn__live learn__live--head"');
  });
});

describe('检查点标题不再重复截断题干（#18）', () => {
  it('title 去掉尾部省略号后是题干前缀时，只渲染完整题干', () => {
    expect(source, '前缀去重没做，只剩旧的「完全相同」判断').not.toContain('checkpoint.title !== checkpoint.question');
    expect(source).toContain('function checkpointTitlePair');
    const fn = /function checkpointTitlePair[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
    expect(fn, '没有把 title 去掉尾部省略号再比对前缀').toMatch(/replace\(\/\[\.…\]\+\$\/,\s*''\)/);
    expect(fn, '没有用 startsWith 判定前缀').toContain('question.startsWith(stem)');
  });

  it('模板只渲染去重后的标题与题干', () => {
    expect(source).toContain('{{ checkpointHeading }}');
    expect(source).toContain('v-if="checkpointDetail"');
  });
});

describe('检查点反馈正文走 markdown（#19）', () => {
  it('判错讲解不再用纯文本插值', () => {
    expect(source, '反馈框又退回 {{ checkpointFeedback }} 纯文本插值').not.toMatch(/\{\{\s*checkpointFeedback\s*\}\}/);
    expect(source).toContain('v-html="checkpointFeedbackHtml"');
  });

  it('反馈 HTML 复用 AI 气泡的 markdown 渲染管线', () => {
    expect(source).toMatch(/const checkpointFeedbackHtml = computed\(\(\) => formatMessage\(/);
    const rule = ruleHaving('.checkpoint__feedback :deep(code)', 'background');
    expect(decl(rule, 'background'), '行内 code 没有淡底，反引号内容读不出来').toContain('color-mix');
  });
});

describe('开课准备态不再用占位词与失真的等待预期（#66/#67）', () => {
  it('任务详情并行返回即回填任务名（不等开课请求）', () => {
    const boot = /const taskPromise[\s\S]*?void taskPromise\.then\([\s\S]*?\n\s*\}\);/.exec(source)?.[0] ?? '';
    expect(boot, '没有在 taskPromise 上提前回填 taskTitle').toMatch(/taskPromise\.then\(/);
    expect(boot).toMatch(/taskTitle\.value = task\?\.title \|\| task\?\.displayLabel \|\| ''/);
  });

  it('准备卡文案去掉「当前任务」占位与「一般几秒到十几秒」的失真承诺', () => {
    expect(source, '旧承诺文案还在').not.toContain('一般几秒到十几秒');
    const p = /问流正在为[\s\S]*?<\/p>/.exec(source)?.[0] ?? '';
    expect(p, '准备卡找不到正文').not.toBe('');
    expect(p, '准备卡仍用「当前任务」占位').not.toContain('当前任务');
    expect(p, '没有给出「超过 20 秒可点重新尝试」的退路').toContain('超过 20 秒');
    expect(p).toContain('重新尝试');
  });
});

describe('输入框聚焦不再套两个框（#69）', () => {
  it('输入类退掉自身直角 outline，焦点提示只留外层 .composer__box 一圈', () => {
    const rule = ruleHaving('.composer__box .composer__textarea:focus-visible', 'outline');
    expect(decl(rule, 'outline')).toBe('none');
    // 外层唯一的焦点环仍在
    const box = ruleHaving('.composer__box:focus-within', 'box-shadow');
    expect(box).toContain('var(--mk-focus-ring)');
  });
});
