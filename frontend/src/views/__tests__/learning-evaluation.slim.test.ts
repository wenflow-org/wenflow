/**
 * 「课堂结算 + 学习反馈报告」消肿护栏（2026-11-06 走查）
 *
 * 一节 25 分钟的课总结成 4~5 屏的「超长火车票」，9~10 个模块里有多处自己抄自己：
 *  ① 「本节进展」（继续练习 / 识别技术能力跃迁点）与「知识点掌握」逐条重复；
 *  ② 本节表现 3 框 + 长期状态 4 框，每个数字底下印一行永不变化的名词解释，
 *     窄屏排成 7 行单列（实测 ~850px）；
 *  ③ 「当堂对话」默认铺开，且卡头「47 条消息」与按钮「展开更早的 54 条」自相矛盾；
 *  ④ 「下一步建议」正文被 markdown 渲染器接管成 17–18px，比自己的标题还大；
 *  ⑤ 移动端吸底条两颗键全是灰底、分不出主操作；PC 卡尾又重复一组离开按钮；
 *  ⑥ 「你的感受」为 5 颗星 + 3 个难度占 260px，提交键是 48px 全圆胶囊；
 *  ⑦ 结算弹窗副标题与步骤第 1 项同义重复。
 *
 * 本护栏逐条锁死，防止「报告又长回去」。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
/* 源码按行解析的断言（下面的 '}\n' / '\n}\n' 切片）必须先归一换行：仓库
   core.autocrlf=true，git 每次检出/合并会把工作区文件写成 CRLF，'\n' 切片
   会切出空串（2026-11-07 合并 develop 时实测踩到）。 */
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8').replace(/\r\n/g, '\n');

const card = read('../../components/CompletionCard.vue');
const page = read('../LearningEvaluationPage.vue');
const feedback = read('../../components/learning/SessionFeedbackPanel.vue');
const learn = read('../v2/V2LearningPage.vue');

/** 注释里会复述被删掉的旧实现，断言前一律剥注释 */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

function ruleOf(src: string, selector: string): string {
  const css = strip(src);
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
const has = (rule: string, re: RegExp) => re.test(rule);

/** 同一选择器可能在媒体查询里另有动画/覆盖规则：按「块内必须含 marker」挑基础规则 */
function ruleWith(src: string, selector: string, marker: string): string {
  const css = strip(src);
  let from = 0;
  for (;;) {
    const start = css.indexOf(`${selector} {`, from);
    if (start < 0) break;
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          const block = css.slice(start, i + 1);
          if (block.includes(marker)) return block;
          from = i + 1;
          break;
        }
      }
    }
  }
  throw new Error(`没有含「${marker}」的 ${selector} 规则`);
}

describe('结构消肿：重复的「本节进展」撤除，知识点掌握上提', () => {
  it('「本节进展」整卡与它的数据源一起退役', () => {
    const live = strip(card);
    expect(live).not.toContain('sec-progress');
    expect(live).not.toContain('本节进展');
    expect(live, 'progressHighlights 计算属性还留着').not.toContain('progressHighlights');
  });

  it('主题总结并入概览卡，知识点掌握紧随其后（不再有独立主题卡）', () => {
    const live = strip(card);
    const summary = live.indexOf('class="completion-summary"');
    const summaryTopic = live.indexOf('class="summary-topic"');
    const knowledge = live.indexOf('id="sec-knowledge"');
    const perf = live.indexOf('id="sec-perf"');
    expect(live, '独立主题卡又回来了').not.toContain('id="sec-topic"');
    expect(summary).toBeGreaterThan(-1);
    expect(summaryTopic, '主题总结没并进概览卡').toBeGreaterThan(summary);
    expect(knowledge, '知识点掌握没排在本节表现之前').toBeGreaterThan(summaryTopic);
    expect(perf).toBeGreaterThan(knowledge);
  });

  it('右侧悬浮目录条整条撤除（模块合并后只剩 ~1.5 屏）', () => {
    const live = strip(page);
    expect(live).not.toContain('eval-toc');
    expect(live, '目录数据源还留着').not.toContain('tocItems');
    expect(live, '滚动高亮监听还挂着').not.toContain('onTocScroll');
  });
});

describe('指标卡：解释收进 ⓘ，7 框不再排成 7 行', () => {
  it('框内不再印静态名词解释', () => {
    expect(strip(card)).not.toContain('metric-desc');
    expect(strip(card), '解释文本现在挂在 ⓘ 浮层里').toContain('metric-help__body');
  });

  it('本节表现 3 项恒定一行 3 列（窄屏也不拆行）', () => {
    expect(has(ruleOf(card, '.metrics-grid--three'), /grid-template-columns:\s*repeat\(3/)).toBe(true);
    const live = strip(card);
    const overrides = live.match(/\.metrics-grid--three\s*\{[^}]*\}/g) || [];
    expect(
      overrides.filter((r) => /grid-template-columns:\s*1fr/.test(r)),
      '又有断点把 3 项拆成单列（用户实测 7 行 850px 的根因）'
    ).toEqual([]);
  });

  it('页面级 :deep 覆盖不许把指标网格再压回单列', () => {
    const live = strip(page);
    /* 页面里这些覆盖都写成 :deep(.metrics-grid) —— 选择器尾部带一个「)」，正则要放它进来，
       否则整组断言会「一条都没匹配到」而静默通过（本文件第一版就踩了）。 */
    const overrides = live.match(/\.metrics-grid(?:--three)?\)?\s*\{[^}]*\}/g) || [];
    expect(overrides.length, '一条指标网格覆盖都没匹配到，断言形同虚设').toBeGreaterThan(2);
    const single = overrides.filter((r) => /grid-template-columns:\s*(1fr|minmax\(0, 1fr\))/.test(r));
    expect(single, `这 ${single.length} 条 :deep 覆盖会把指标卡压回单列`).toEqual([]);
    expect(overrides.some((r) => /repeat\(2, minmax\(0, 1fr\)\)/.test(r)), '窄屏 4 项应是 2×2').toBe(true);
    expect(overrides.some((r) => /repeat\(3, minmax\(0, 1fr\)\)/.test(r)), '3 项应保持一行 3 列').toBe(true);
  });

  it('长期状态：PC 一行 4 列、窄屏 2×2', () => {
    expect(has(ruleOf(card, '.metrics-grid'), /grid-template-columns:\s*repeat\(4/)).toBe(true);
    const narrow = strip(card).slice(strip(card).indexOf('@media (max-width: 900px)'));
    expect(narrow.slice(0, narrow.indexOf('}') + 1)).toMatch(/\.metrics-grid\s*\{\s*grid-template-columns:\s*repeat\(2/);
  });
});

describe('当堂对话：默认整块折叠 + 计数同源', () => {
  it('默认不渲染任何条目（不再保留「最近两条」预览）', () => {
    const live = strip(page);
    expect(live).not.toContain('TRANSCRIPT_PREVIEW_COUNT');
    expect(live).toContain('transcriptExpanded.value ? transcriptEntries.value : []');
  });

  it('数量即入口：卡头不再单摆静态计数胶囊（修 47 vs 54）', () => {
    const live = strip(page);
    expect(live, '静态记录胶囊又回来了').not.toContain('evaluation-transcript-card__meta');
    expect(live, '按钮里又写死了条数，两边必然再次不一致').not.toContain('展开更早的');
    expect(live, '切换键文案必须来自同一条时间线').toContain('展开 ${transcriptTotalCount.value} 条对话');
    expect(live, '卡头还在数 mainDialogueMessages（只有消息，不含小测卡）').not.toContain('{{ mainDialogueMessages.length }} 条消息');
  });

  it('展开后的讲解/小测卡吃满卡宽，只有用户气泡收窄', () => {
    expect(has(ruleWith(page, '.evaluation-transcript-item', 'padding: 16px 18px'), /max-width:\s*100%/)).toBe(true);
    expect(has(ruleOf(page, '.evaluation-transcript-item--user'), /max-width:\s*min\(100%, 620px\)/)).toBe(true);
  });
});

describe('字号穿帮：下一步建议与关键收获同级', () => {
  it('有序列表统一 14px，渲染器内部段落强制继承', () => {
    expect(has(ruleOf(card, '.ordered-list'), /font-size:\s*14px/)).toBe(true);
    const live = strip(card);
    const inherit = live.match(/\.ordered-list li :deep\(\.markdown-renderer[^{]*\{[^}]*\}/g) || [];
    expect(inherit.some((r) => r.includes('font-size: inherit')), '渲染器段落没有强制继承字号').toBe(true);
  });
});

describe('按钮层级：吸底条有主操作，PC 卡尾不重复离开', () => {
  it('吸底条两键 40 高 / 8px 圆角 / 10px 间距', () => {
    const btn = ruleOf(page, '.evaluation-ctabar__btn');
    expect(has(btn, /min-height:\s*40px/)).toBe(true);
    expect(has(btn, /border-radius:\s*8px/)).toBe(true);
    expect(ruleWith(page, '.evaluation-ctabar', 'position: fixed'), '吸底条间距没收到 10px').toMatch(/gap:\s*10px/);
  });

  it('已结算时「继续练习」顶上主按钮位（否则一屏两颗灰键）', () => {
    expect(page).toContain("'evaluation-ctabar__btn--primary': taskCompleted");
    const live = strip(page);
    expect(live, '主按钮只剩 --primary 一种实心样式').toContain('.evaluation-ctabar__btn--primary {');
  });

  it('卡尾动作行不再重复「返回学习路径」（顶部操作栏已有）', () => {
    const actions = strip(card).slice(strip(card).indexOf('completion-actions__row'));
    expect(actions.slice(0, actions.indexOf('</div>'))).not.toContain('返回学习路径');
    expect(page, '顶部返回入口仍在').toContain('返回学习路径');
  });
});

describe('「你的感受」压缩：PC 三列一行，移动端 38px 方角提交键', () => {
  it('PC ≥901 三列并排', () => {
    const css = strip(feedback);
    const desktop = css.slice(css.indexOf('@media (min-width: 901px)'));
    expect(desktop.slice(0, desktop.indexOf('\n}\n')), '桌面没有把评分/难度/提交并到一行').toMatch(/\.session-feedback__main\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, auto\) minmax\(0, auto\)/);
  });

  it('移动端提交键 38px / 8px（不再是全圆大胶囊）', () => {
    const css = strip(feedback);
    const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(mobile).toMatch(/\.session-feedback__actions \.feedback-btn\s*\{[\s\S]*?height:\s*38px;[\s\S]*?border-radius:\s*8px;/);
  });
});

describe('精细化：指标卡对齐、图标颜色、双栏、入口归位', () => {
  it('指标卡显式左对齐（全局 .metric-card 的 text-align:center 不能漏进来）', () => {
    const rule = ruleOf(card, '.metric-card');
    expect(has(rule, /text-align:\s*left/), '没写 text-align: left → 标题会被全局 center 拉走，与左下角的读数错位').toBe(true);
    expect(has(ruleOf(card, '.metric-value'), /margin-top:\s*6px/), '标签与读数间距应为 6px').toBe(true);
    expect(has(ruleOf(card, '.metric-value'), /align-items:\s*flex-start/)).toBe(true);
  });

  it('标题图标每一种都带显式 fill（缺 fill 的 path/rect 默认纯黑，深色底上隐形）', () => {
    const icons = card.slice(card.indexOf('const ICONS'), card.indexOf('const icon ='));
    /* 逐条图标检查：允许用 <g fill="currentColor"> 包一组实心形状，但不许有「既不在带 fill 的分组里、
       自己也没写 fill」的形状——那种形状会掉成 #000 */
    const lines = icons.split('\n').filter((l) => /^\s{2}\w+: `/.test(l));
    /* 2026-11-06 精简后只剩 6 种标题/头部图标；阈值取 4 即可挡住「解析不到任何图标」的假通过 */
    expect(lines.length, '一条图标都没解析到，断言形同虚设').toBeGreaterThan(4);
    const offenders: string[] = [];
    for (const line of lines) {
      const body = line.replace(/<g[^>]*>/g, '').replace(/<\/g>/g, '');
      const grouped = /<g\s[^>]*fill=/.test(line);
      const shapes = body.match(/<(?:path|rect|circle)[^>]*>/g) || [];
      if (grouped) continue; // 整组已被外层 fill 覆盖
      for (const s of shapes) {
        if (!/[ \t]fill=/.test(s)) offenders.push(`${line.trim().slice(0, 24)}… ${s.slice(0, 40)}`);
      }
    }
    expect(offenders, `这些形状没写 fill，会掉成 #000：\n${offenders.slice(0, 4).join('\n')}`).toEqual([]);
  });

  it('关键收获与下一步建议 PC ≥1024 左右双栏', () => {
    const live = strip(card);
    expect(live).toContain('class="completion-duo"');
    expect(live, '两张卡必须同处一个双栏容器').toMatch(/completion-duo[\s\S]{0,400}id="sec-takeaways"[\s\S]{0,900}id="sec-next"/);
    const desk = live.slice(live.indexOf('@media (min-width: 1024px)'));
    /* 双栏规则取到第一个声明块结束（'}' + 换行）即可，不引入转义字符串 */
    const deskRule = desk.slice(0, desk.indexOf('}\n') + 1);
    expect(deskRule, '双栏规则缺失').toMatch(/\.completion-duo\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/);
  });

  it('推进/离开动作统一在页面顶部操作栏，卡内不再有一套', () => {
    const live = strip(card);
    expect(live).not.toContain('completion-actions');
    expect(live, '卡还在发 action 事件').not.toContain("emit('action'");
    expect(page).toContain('evaluation-head__continue');
    expect(page).toContain('evaluation-head__complete');
    expect(page, '顶部返回钮仍要在').toContain('返回学习路径');
  });

  it('当堂对话切换键在卡头、轻量胶囊（不是满宽蓝框长条）', () => {
    /* 卡头 = 从 __head 开始到列表容器之前的那一段 */
    const live = strip(page);
    const head = live.slice(live.indexOf('evaluation-transcript-card__head'), live.indexOf('evaluation-transcript-list'));
    expect(head, '切换键没进卡头').toContain('evaluation-transcript-toggle');
    const rule = ruleOf(page, '.evaluation-transcript-card .evaluation-transcript-toggle');
    expect(has(rule, /width:\s*100%/), '又变回满宽长条了').toBe(false);
    expect(has(rule, /border:\s*1px solid/)).toBe(true);
  });
});

describe('结算弹窗：标题下不再复述步骤第 1 项', () => {
  it('副标题已撤，步骤行仍是唯一进度说明', () => {
    const live = strip(learn);
    expect(live).not.toContain('settleLead');
    expect(live).not.toContain('settle__lead');
    expect(live, '步骤 1 的文案必须还在').toContain('关闭课堂并生成本次总结');
  });
});
