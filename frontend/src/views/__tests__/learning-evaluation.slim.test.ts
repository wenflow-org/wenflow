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
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');

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

  it('知识点掌握紧跟主题总结（报告顺序 = 目录顺序）', () => {
    const live = strip(card);
    const topic = live.indexOf('id="sec-topic"');
    const knowledge = live.indexOf('id="sec-knowledge"');
    const perf = live.indexOf('id="sec-perf"');
    expect(topic).toBeGreaterThan(-1);
    expect(knowledge, '知识点掌握没上提到主题总结下方').toBeGreaterThan(topic);
    expect(perf).toBeGreaterThan(knowledge);
  });

  it('目录同步：不再列「本节进展」，且顺序与报告一致', () => {
    const toc = page.slice(page.indexOf('const tocItems'), page.indexOf('const tocAvailability'));
    expect(toc).not.toContain('sec-progress');
    const order = ['sec-topic', 'sec-knowledge', 'sec-perf', 'sec-longterm', 'sec-takeaways', 'sec-next', 'sec-evaluation', 'sec-feedback', 'sec-transcript'];
    const at = order.map((id) => toc.indexOf(`'${id}'`));
    expect(at.every((v) => v > -1), '目录缺章').toBe(true);
    expect([...at].sort((a, b) => a - b), '目录顺序与报告顺序不一致').toEqual(at);
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

  it('卡头计数与展开按钮同源（修 47 vs 54）', () => {
    const live = strip(page);
    expect(live).toContain('{{ transcriptTotalCount }} 条记录');
    expect(live, '卡头还在数 mainDialogueMessages（只有消息，不含小测卡）').not.toContain('{{ mainDialogueMessages.length }} 条消息');
    expect(live, '按钮里又写死了条数，两边必然再次不一致').not.toContain('展开更早的');
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

describe('结算弹窗：标题下不再复述步骤第 1 项', () => {
  it('副标题已撤，步骤行仍是唯一进度说明', () => {
    const live = strip(learn);
    expect(live).not.toContain('settleLead');
    expect(live).not.toContain('settle__lead');
    expect(live, '步骤 1 的文案必须还在').toContain('关闭课堂并生成本次总结');
  });
});
