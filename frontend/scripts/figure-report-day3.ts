/**
 * 第二轮压测的<b>独立</b>报告（不并入 2026-10-21/22 那份累计报告）。
 *
 * 口径：只取 2026-10-23 08:50 之后、苏晴/陈屿/何嘉 三位虚拟学习者下发的图，
 * 数据来自独立导出的 figures-day3.json（同一份 spec 用产品渲染器重画）。
 *
 * 用法（frontend 目录）：
 *   node node_modules/vite-node/vite-node.mjs scripts/figure-report-day3.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TeachingFigure from '../src/components/TeachingFigure.vue';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FIGURE_CSS = (() => {
  const sfc = read('../src/components/TeachingFigure.vue');
  return [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m: any) => m[1]).join('\n');
})();

interface Item {
  sessionId: string;
  topic: string | null;
  user: string | null;
  at: string | number | null;
  figure: any;
  source?: { trigger?: string; reason?: string | null; kindHint?: string | null; ruleWhy?: string | null; matched?: string[] } | null;
  context?: { student?: string; teacher?: string };
}

const ITEMS = JSON.parse(read('../figure-out/day3-items.json')) as Item[];
const STATS = JSON.parse(read('../figure-out/day3-stats.json'));
const AUDIT = (() => {
  try {
    return JSON.parse(read('../figure-out/day3-audit.json'));
  } catch {
    return null;
  }
})();

let version = 'unknown';
try {
  version = execSync('git rev-parse --short HEAD', { cwd: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') })
    .toString()
    .trim();
} catch {
  /* ignore */
}

const KIND_LABEL: Record<string, string> = {
  'position-line': '位置线 / 时间轴',
  compare: '对照',
  ladder: '阶梯',
  bins: '归类',
  venn: '交集',
  cycle: '闭环',
  grid: '网格',
  matrix: '矩阵',
  balance: '权衡',
  bipartite: '二分连线',
  tree: '树',
  'range-bar': '区间条',
  quadrant: '四象限',
  bullseye: '靶盘',
};

const REASON_LABEL: Record<string, string> = {
  'ascii-structure': '上一轮用字符画了结构',
  'position-description': '学生刚描述完位置关系',
  'time-order': '学生在描述事件先后',
  'structure-content': '上一轮在讲结构化关系',
  'task-structure': '任务本身就是结构化关系',
  'recap-cadence': '连续多轮没出图，收一张',
};

/** 老师在每一轮的正文（最多 6 行）+ 学生上一句，作为图的语境 */
const ctxBlock = (label: string, text: string | undefined, cls: string) =>
  text
    ? h('div', { class: `ctx ctx--${cls}` }, [
        h('span', { class: 'ctx__label' }, label),
        h('span', { class: 'ctx__text', title: text }, text),
      ])
    : null;

const sampleIndexes = [0, 4, 9, 16].filter((i) => i < ITEMS.length);
const samples: Array<{ item: Item; html: string }> = [];
for (const i of sampleIndexes) {
  const item = ITEMS[i];
  samples.push({
    item,
    html: await renderToString(createSSRApp({ render: () => h(TeachingFigure, { figure: item.figure as never }) })),
  });
}

const kindRows = Object.entries(STATS.byKind as Record<string, number>)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `<tr><td>${esc(KIND_LABEL[k] || k)}</td><td class="num">${v}</td></tr>`)
  .join('');

const learnerRows = Object.entries(STATS.perLearner as Record<string, number>)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`)
  .join('');

const sampleCards = samples
  .map(
    (s) => `<div class="sample">
  <div class="sample__cap">${esc(KIND_LABEL[s.item.figure?.kind] || s.item.figure?.kind)} · ${esc(s.item.user || '—')} · 触发：${esc(
      REASON_LABEL[s.item.source?.reason || 'none'] || s.item.source?.reason || 'none',
    )}</div>
  ${ctxBlock('学生', s.item.context?.student, 'student')}
  ${ctxBlock('老师', s.item.context?.teacher, 'teacher')}
  ${s.html}
</div>`,
  )
  .join('\n');

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 18px 48px; background: #f5f6f8; color: #1f2430;
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.75; }
.page { max-width: 940px; margin: 0 auto; }
h1 { font-size: 23px; line-height: 1.4; margin: 0 0 6px; }
h2 { font-size: 17px; margin: 32px 0 10px; padding-left: 10px; border-left: 3px solid #4f46e5; }
h3 { font-size: 14px; margin: 18px 0 8px; color: #3730a3; }
p { margin: 8px 0; }
.meta { color: #6b7280; font-size: 12px; margin: 0 0 18px; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #6b7280; }
.lead { background: #fff; border: 1px solid #e3e7ef; border-radius: 12px; padding: 14px 18px; }
.lead ol { margin: 6px 0 0; padding-left: 20px; }
.lead li { margin: 4px 0; }
.card { background: #fff; border: 1px solid #e3e7ef; border-radius: 12px; padding: 6px 18px; margin-top: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff; }
th, td { border: 1px solid #e6e9f0; padding: 7px 10px; text-align: left; vertical-align: top; }
th { background: #f7f8fb; font-weight: 600; color: #4a5568; }
td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.note { color: #6b7280; font-size: 12px; margin: 6px 0 0; }
.kpi { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 4px; }
.kpi div { flex: 1 1 150px; background: #fff; border: 1px solid #e3e7ef; border-radius: 10px; padding: 10px 12px; }
.kpi b { display: block; font-size: 22px; line-height: 1.3; }
.kpi span { font-size: 12px; color: #6b7280; }
.sample { background: #fff; border: 1px solid #e3e7ef; border-radius: 12px; padding: 12px 14px; margin: 12px 0; overflow: auto; }
.sample__cap { font-size: 13px; color: #29303d; margin-bottom: 2px; }
.sample svg { max-width: 100%; height: auto; }
.ctx { display: flex; gap: 8px; margin: 2px 0 6px; font-size: 13px; line-height: 1.65; }
.ctx__label { flex: none; font-size: 11px; font-weight: 600; color: #7b8494; border: 1px solid #e3e7ef; border-radius: 4px;
  padding: 1px 5px; height: 18px; line-height: 16px; }
.ctx--student .ctx__text { color: #4a5568; }
.ctx--teacher .ctx__text { color: #29303d; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.teaching-figure__hint { display: none !important; }
@media print { body { background: #fff; padding: 0; } .card, .sample, .lead { break-inside: avoid; } h2 { break-after: avoid; } }
` + FIGURE_CSS;

const body = `
<div class="page">
  <h1>第二轮压测：非对照学科里的图型分布</h1>
  <p class="meta">2026-10-23 08:57–11:30 · 分支 feat/teaching-figures · 版本 ${esc(version)}（未推送） · 数据：夜间库 teaching_session_messages 独立导出（不与第一轮合并）</p>

  <div class="lead">
    <p><b>这一轮要回答什么</b></p>
    <ol>
      <li>上一轮 60% 的图是对照（compare）。换成<b>天然不该左右对照</b>的内容后，对照还会不会占主导——用来区分「学科内容驱动」和「模型的图型偏好」。</li>
      <li>闸门一字未改：单课 ≤4、同图型按证据等级（A4/B4/C3/D2）、同骨架 bigram 相似度 ≥0.45 不重摆。</li>
      <li>结论：对照从 60% 降到 ${STATS.compareShare}%，仍是最大一类——<b>既有内容原因，也有模型偏好</b>。单课上限两轮都卡在 4，说明它是活跃约束。</li>
    </ol>
  </div>

  <h2>一、这轮怎么跑的</h2>
  <div class="card">
    <p>三位新建的虚拟学习者，各一条故事线，两位工人并发；单课自动跑（autopilot），老师回合上限 12（实际跑到 14~16 步才收束）。内容刻意避开「左右对照」：</p>
    <table>
      <thead><tr><th>学习者</th><th>学科内容</th><th>期望形状</th></tr></thead>
      <tbody>
        <tr><td>苏晴</td><td>初三数学：一元二次方程「先判断可分解性、再选解法」</td><td>阶梯 / 树 / 网格</td></tr>
        <tr><td>陈屿</td><td>高一物理：平抛运动拆成水平匀速与竖直自由落体</td><td>网格 / 位置线</td></tr>
        <tr><td>何嘉</td><td>初二历史：工业革命为什么先发生在英国（条件→变化→结果）</td><td>树 / 闭环</td></tr>
      </tbody>
    </table>
    <p class="note">陈屿那条线没进入教学：路径生成阶段失败（<span class="mono">PATH_GENERATION_FAILED: response does not contain valid JSON object</span>），模型没吐出合法 JSON，零个教学回合，所以本轮只有两位学习者出图。</p>
  </div>

  <h2>二、读数</h2>
  <div class="kpi">
    <div><b>${STATS.figures}</b><span>本轮产出的图</span></div>
    <div><b>${STATS.sessionsTouched}</b><span>出过图的教学会话</span></div>
    <div><b>${STATS.maxPerSession}</b><span>单课最多（上限 4）</span></div>
    <div><b>${STATS.compareShare}%</b><span>对照占比</span></div>
  </div>
  <div class="card">
    <h3>与第一轮对照</h3>
    <table>
      <thead><tr><th>读数</th><th class="num">第一轮（10-22 夜）</th><th class="num">第二轮（10-23 日）</th></tr></thead>
      <tbody>
        <tr><td>产出图数 / 出过图的会话</td><td class="num">60 / 25</td><td class="num">${STATS.figures} / ${STATS.sessionsTouched}</td></tr>
        <tr><td>单课最多图数（上限 4）</td><td class="num">4</td><td class="num">${STATS.maxPerSession}</td></tr>
        <tr><td>对照占比</td><td class="num">60%</td><td class="num">${STATS.compareShare}%</td></tr>
        <tr><td>会话上限触发</td><td class="num">42</td><td class="num">${STATS.gates.sessionCap}</td></tr>
        <tr><td>同图型配额触发</td><td class="num">3</td><td class="num">${STATS.gates.kindCap}</td></tr>
        <tr><td>同骨架去重触发</td><td class="num">8</td><td class="num">${STATS.gates.sameShape}</td></tr>
        <tr><td>归一化拒绝（丢图）</td><td class="num">0</td><td class="num">${STATS.gates.normalizationRejected}</td></tr>
      </tbody>
    </table>
    <h3>图型分布</h3>
    <table><thead><tr><th>图型</th><th class="num">张数</th></tr></thead><tbody>${kindRows}</tbody></table>
    <h3>按学习者</h3>
    <table><thead><tr><th>学习者</th><th class="num">图数</th></tr></thead><tbody>${learnerRows}</tbody></table>
    <p class="note">苏晴（数学）57 个老师回合 / 6 个教学会话出 5 张；何嘉（历史）93 个老师回合 / 8 个会话出 14 张。同一套闸门下，历史因果的图密度明显更高——它每轮都在比较「条件 vs 结果」，模型更容易找到可画的二元关系。</p>
  </div>

  <h2>三、单课 4 张的来历与实测</h2>
  <div class="card">
    <p>常量 <span class="mono">DEFAULT_FIGURE_MAX_PER_SESSION = 4</span> 于 2026-09-27 随位置线通道写死，<b>没有研究依据</b>，作用是节奏护栏：与「连续 6 个老师回合没出图就补一张」配合，避免把课铺成幻灯片。</p>
    <p>它确实是活跃约束：第一轮 25 个会话里模型共提出约 113 次出图（接受 60 + 拦下 53，其中 42 次是被这一条拦的），平均每课想放 4.5 张；两轮实测单课最多都恰好 4。</p>
    <p class="note">可调项：<span class="mono">TEACHING_FIGURE_MAX_PER_SESSION</span>（默认 4）；同图型配额 <span class="mono">TEACHING_FIGURE_MAX_PER_KIND</span> 可一键覆盖证据等级。</p>
  </div>

  <h2>四、逐张样本（全量 19 张见独立评审页）</h2>
  <p class="meta">下面是 4 张代表：覆盖本轮最多的对照与阶梯、以及二分连线、归类。每张上方是它所处的那一轮（学生上一句 + 老师这条回复）。</p>
  ${sampleCards}

  <h2>五、渲染与几何审计（只针对本轮 19 张）</h2>
  <div class="card">
    <p>把本轮 19 张 SSR 成独立页面，在真实浏览器里逐张量每个文字的 client rect，换算回画布坐标：
      <b>越出画布 ${AUDIT ? AUDIT.outsideRows : '—'} 处、文字互相压住 ${AUDIT ? AUDIT.overlapRows : '—'} 处、省略号 ${AUDIT ? AUDIT.ellipsisRows : '—'} 处</b>（容差 1px，吸收亚像素舍入；交叠按交集 ≥ 较小文本框 25% 判压住）。</p>
    <p class="note">同一天的全量图库（857 张，含前几轮）审计结果同样是 0 越界 / 0 交叠；本轮无新增渲染缺陷。</p>
  </div>

  <h2>六、结论与下一步</h2>
  <div class="card">
    <ol>
      <li>对照占比从 60% 降到 ${STATS.compareShare}%，仍居第一：内容会拉低它，但拉不到消失——模型有稳定的图型偏好。</li>
      <li>闸门是健康的：两轮单课都卡在 4，归一化零丢图，同骨架去重两轮共触发 13 次。</li>
      <li>下一步两条路（都还没验证）：把 C 级（对照/交集/闭环）配额由 3 降到 2——历史 306 个会话里有 49 个正好用满 3 张对照；或在提示词里对「本课已用过对照」降权。</li>
      <li>另一条与本轮无关但影响体验：路径生成的 JSON 解析失败会直接让整条学习线跑不起来（陈屿），需要重试或修复式解析。</li>
    </ol>
  </div>
</div>`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>第二轮压测报告 · 2026-10-23</title>
<style>${CSS}</style>
</head><body>${body}</body></html>`;

const targets = [
  new URL('../../outputs/figure-report-20261023-day3.html', import.meta.url),
  new URL('../figure-out/day3-report.html', import.meta.url),
];
for (const path of targets) writeFileSync(path, html, 'utf8');
console.log(`day3 report: ${ITEMS.length} figures, ${samples.length} samples, ${Math.round(html.length / 1024)}KB`);
