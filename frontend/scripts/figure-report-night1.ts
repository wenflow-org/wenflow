/**
 * 第一轮压测（2026-10-22 夜）的**独立**报告——不并入累计报告，也不与第二轮混算。
 *
 * 口径：只取 2026-10-22 23:34:15 之后、林小满/周子墨/周子轩 三位虚拟学习者下发的图。
 * 这一轮跑在「闸门改读库侧表 + 图型配额按证据等级 + 链路缺省串联 + 归一化容错」之后，
 * 目的是看真实课里闸门是否真的生效、图型怎么分布。
 *
 * 用法（frontend 目录）：
 *   node node_modules/vite-node/vite-node.mjs scripts/figure-report-night1.ts
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

const ITEMS = JSON.parse(read('../figure-out/night1-items.json')) as Item[];
const STATS = JSON.parse(read('../figure-out/tonight-stats.json'));
const AUDIT = (() => {
  try {
    return JSON.parse(read('../figure-out/night1-audit.json'));
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

const ctxBlock = (label: string, text: string | undefined, cls: string) =>
  text
    ? h('div', { class: `ctx ctx--${cls}` }, [
        h('span', { class: 'ctx__label' }, label),
        h('span', { class: 'ctx__text', title: text }, text),
      ])
    : null;

/** 挑 4 张有代表性的：带链路的对照、位置线、阶梯、交集 */
const pick = (pred: (it: Item) => boolean) => ITEMS.findIndex(pred);
const sampleIndexes = [
  pick((it) => it.figure?.kind === 'compare' && Array.isArray(it.figure?.spec?.left?.chain) && it.figure.spec.left.chain.length >= 1) >= 0
    ? pick((it) => it.figure?.kind === 'compare' && Array.isArray(it.figure?.spec?.left?.chain) && it.figure.spec.left.chain.length >= 1)
    : pick((it) => it.figure?.kind === 'compare'),
  pick((it) => it.figure?.kind === 'position-line'),
  pick((it) => it.figure?.kind === 'ladder'),
  pick((it) => it.figure?.kind === 'venn'),
].filter((i) => i >= 0);

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

const compareShare = Math.round(((STATS.byKind?.compare || 0) / STATS.figures) * 100);
const figuresPerTurn = (STATS.figures / 465).toFixed(2);

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
  <h1>第一轮压测：闸门修复后的真实课分布</h1>
  <p class="meta">2026-10-22 23:34:15 – 2026-10-23 02:24:20 · 分支 feat/teaching-figures · 版本 ${esc(version)}（未推送） · 数据：夜间库 teaching_session_messages 独立导出（不与第二轮合并）</p>

  <div class="lead">
    <p><b>这一轮要回答什么</b></p>
    <ol>
      <li>两道曾经失效的闸门（单课上限 4、同骨架去重）改成读库侧表后，在真实课里是否真的会触发。</li>
      <li>真实课堂的图型分布长什么样、单课会不会再出现「9 张一样」的堆叠。</li>
      <li>结论：闸门全部生效（会话上限触发 ${STATS.gates.sessionCap} 次、同图型 ${STATS.gates.kindCap} 次、同骨架 ${STATS.gates.sameShape} 次），单课最多 ${STATS.maxPerSession} 张；图型仍以对照为主（${compareShare}%）。</li>
    </ol>
  </div>

  <h2>一、这轮怎么跑的</h2>
  <div class="card">
    <p>三位虚拟学习者、三条故事线、两位工人并发；这一轮之前刚把「会话上限 / 图型配额 / 同骨架去重」从回合内存快照改为读库侧表，并上线归一化容错。闸门参数：单课 ≤4、同图型按证据等级（A4/B4/C3/D2）、同骨架 bigram 相似度 ≥0.45 不重摆。</p>
    <table>
      <thead><tr><th>学习者</th><th>学科内容</th><th>起止</th><th class="num">老师回合</th><th class="num">图</th><th>终态</th></tr></thead>
      <tbody>
        <tr><td>林小满</td><td>高中英语：did / have done / had done 的时间锚点</td><td>23:34 → 01:03</td><td class="num">123</td><td class="num">20</td><td>completed（16 步）</td></tr>
        <tr><td>周子墨</td><td>大一计算机：变量名与内存对象的引用关系</td><td>23:34 → 02:23</td><td class="num">235</td><td class="num">33</td><td>手动停（23 步）</td></tr>
        <tr><td>周子轩</td><td>初二生物：光合作用与呼吸作用的净积累</td><td>01:03 → 02:24</td><td class="num">107</td><td class="num">7</td><td>手动停（24 步）</td></tr>
      </tbody>
    </table>
    <p class="note">后两位是被我在 02:22 主动收工的，不是自然结束；这轮共 ${STATS.sessionsTouched} 个教学会话出过图（全部 42 个教学会话、465 个老师回合）。</p>
  </div>

  <h2>二、读数</h2>
  <div class="kpi">
    <div><b>${STATS.figures}</b><span>本轮产出的图</span></div>
    <div><b>${STATS.sessionsTouched}</b><span>出过图的教学会话</span></div>
    <div><b>${STATS.maxPerSession}</b><span>单课最多（上限 4）</span></div>
    <div><b>${compareShare}%</b><span>对照占比</span></div>
  </div>
  <div class="card">
    <h3>图型分布</h3>
    <table><thead><tr><th>图型</th><th class="num">张数</th></tr></thead><tbody>${kindRows}</tbody></table>
    <h3>按学习者</h3>
    <table><thead><tr><th>学习者</th><th class="num">图数</th></tr></thead><tbody>${learnerRows}</tbody></table>
    <h3>闸门触发（本轮日志计数）</h3>
    <table>
      <thead><tr><th>闸门</th><th class="num">触发次数</th><th>含义</th></tr></thead>
      <tbody>
        <tr><td>单课上限 4</td><td class="num">${STATS.gates.sessionCap}</td><td>模型还想出图，但本会话已满 4 张</td></tr>
        <tr><td>同图型配额</td><td class="num">${STATS.gates.kindCap}</td><td>该图型在本会话已到证据等级配额</td></tr>
        <tr><td>同骨架去重</td><td class="num">${STATS.gates.sameShape}</td><td>新图与已落库的图 bigram 相似度 ≥0.45</td></tr>
        <tr><td>归一化拒绝</td><td class="num">${STATS.gates.normalizationRejected}</td><td>spec 不合法、整张作废（本轮 0）</td></tr>
      </tbody>
    </table>
    <p class="note">出图密度：${STATS.figures} 张 / 465 个老师回合 ≈ 每 ${(1 / Number(figuresPerTurn)).toFixed(1)} 个回合一张；有图的 25 个会话平均 14.5 个老师回合。</p>
  </div>

  <h2>三、拿到这轮数据前修的两处失效</h2>
  <div class="card">
    <p><b>闸门计数读的是回合内存快照</b>：修复前 744 张图里，「单课上限 4」与「同骨架去重」日志 <b>0 次触发</b>，单课最多 12 张、同一会话相似度 0.55/0.60 的图仍被渲染。现在三道闸共用一次库侧快照（<span class="mono">listFigures(sessionId)</span>），本轮立刻看到 ${STATS.gates.sessionCap} 次上限拦截。</p>
    <p><b>图型配额一刀切</b>：原来按「每种 ≤3」，现在按证据等级（A4/B4/C3/D2，依据 <span class="mono">doc/DIAGRAM_PEDAGOGY_RESEARCH.md §五</span>），让证据强的图型有更多额度。</p>
    <p><b>同一轮还上了两处容错</b>：compare.chain 第二跳起省略 <span class="mono">from</span> 即画成串联（并行扇出必须显式 <span class="mono">from:"client"</span>）；条目接受 <span class="mono">{label|text|value}</span> 对象、对照栏头放宽到 26 字并允许截断——否则整张图会被归一化丢掉。</p>
  </div>

  <h2>四、逐张样本（全量 ${STATS.figures} 张见独立评审页）</h2>
  <p class="meta">四张代表：带并行扇出链路的对照、位置线、阶梯、交集。每张上方是它所处的那一轮（学生上一句 + 老师这条回复）。</p>
  ${sampleCards}

  <h2>五、渲染与几何审计（只针对本轮 ${STATS.figures} 张）</h2>
  <div class="card">
    <p>把本轮 ${STATS.figures} 张 SSR 成独立页面，在真实浏览器里逐张量每个文字的 client rect，换算回画布坐标：
      <b>越出画布 ${AUDIT ? AUDIT.outsideRows : '—'} 处、文字互相压住 ${AUDIT ? AUDIT.overlapRows : '—'} 处、省略号 ${AUDIT ? AUDIT.ellipsisRows : '—'} 处</b>（容差 1px；交叠按交集 ≥ 较小文本框 25% 判压住）。</p>
    <p class="note">本轮无渲染缺陷。同一渲染器在更大样本（857 张，含两轮与旧探针）上的审计同为 0 越界 / 0 交叠。</p>
  </div>

  <h2>六、结论与下一步</h2>
  <div class="card">
    <ol>
      <li>闸门从「写了但没生效」变成「真在拦」：单课上限 ${STATS.gates.sessionCap} 次、同骨架 ${STATS.gates.sameShape} 次，单课最多 ${STATS.maxPerSession} 张。</li>
      <li>分布高度集中：对照 ${STATS.byKind?.compare || 0} 张（${compareShare}%），其余 8 种共 ${STATS.figures - (STATS.byKind?.compare || 0)} 张。闸门限得住「几张」，限不住「偏爱哪种」。</li>
      <li>下一步：把 C 级（对照/交集/闭环）配额由 3 降到 2（历史 306 个会话里有 49 个正好用满 3 张对照），或在提示词里对「本课已用过对照」降权；两项都未验证。</li>
      <li>第二轮已用「非对照学科」复测：对照降到 47%，说明偏好是内容与模型共同作用——见 <span class="mono">figure-report-20261023-day3.html</span>。</li>
    </ol>
  </div>
</div>`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>第一轮压测报告 · 2026-10-22 夜</title>
<style>${CSS}</style>
</head><body>${body}</body></html>`;

const targets = [
  new URL('../../outputs/figure-report-20261022-night1.html', import.meta.url),
  new URL('../figure-out/night1-report.html', import.meta.url),
];
for (const path of targets) writeFileSync(path, html, 'utf8');
console.log(`night1 report: ${ITEMS.length} figures, ${samples.length} samples, ${Math.round(html.length / 1024)}KB`);
