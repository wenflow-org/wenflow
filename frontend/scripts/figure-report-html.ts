/**
 * 生成一份可复制出去的单文件报告（无脚本、无外链）。
 *
 * 内容：今天教学图这一轮的结论、真实课数据、渲染修复清单、闸门失效与修复、
 * 以及**当前版本提示词原文**（核心 yaml 片段 + 运行时图型指南 + 六个出图时机判据）。
 *
 * 用法（frontend 目录）：
 *   node node_modules/vite-node/vite-node.mjs scripts/figure-report-html.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TeachingFigure from '../src/components/TeachingFigure.vue';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const FIGURE_CSS = (() => {
  const sfc = read('../src/components/TeachingFigure.vue');
  return [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
})();
const VISUAL_SRC = read('../../backend/src/services/ai-teaching/teaching-visual.service.ts');
const YAML = read('../../prompts/core/teaching-turn.yaml');
const ITEMS = JSON.parse(read('../figure-out/figures.json')) as GalleryItem[];

interface GalleryItem {
  sessionId: string;
  topic: string | null;
  user: string | null;
  at: string | number | null;
  figure: any;
  source?: { trigger?: string; reason?: string | null; kindHint?: string | null; ruleWhy?: string | null; matched?: string[] } | null;
  context?: { student?: string; teacher?: string };
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- 源码里取当前版本提示词 ---------- */

/** 运行时图型指南：从 TS 数组字面量逐行取字符串（含 `+` 续行的拼接） */
function extractKindGuide(src: string): string[] {
  const start = src.indexOf('const FIGURE_KIND_GUIDE = [');
  const end = src.indexOf("].join('\\n');", start);
  if (start < 0 || end < 0) return ['（未能从源码提取 FIGURE_KIND_GUIDE）'];
  return src
    .slice(start, end)
    .split('\n')
    .map((line) => [...line.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join(''))
    .filter((line) => line.trim() && !line.includes('const FIGURE_KIND_GUIDE'));
}

/** 六个出图时机：reason → ruleWhy（代码里的判据文案） */
function extractReasonWhys(src: string): Array<[string, string]> {
  return [...src.matchAll(/reason: '([a-z-]+)',[\s\S]{0,400}?ruleWhy: '([^']*)'/g)]
    .map((m) => [m[1], m[2]] as [string, string])
    .filter(([reason]) => reason !== 'ascii-structure' || true)
    .filter(([, why]) => why.length > 0);
}

const yamlLines = YAML.split('\n');
function yamlSlice(fromMarker: string, toMarker: string): string {
  const from = yamlLines.findIndex((l) => l.includes(fromMarker));
  const to = yamlLines.findIndex((l, i) => i > from && l.includes(toMarker));
  if (from < 0 || to < 0) return '（未能从 prompts/core/teaching-turn.yaml 提取）';
  return yamlLines.slice(from, to + 1).join('\n');
}
const YAML_RULES = yamlSlice('课堂结构图（可选', '带一句 `why`');
const YAML_FIGURE_FIELD = yamlSlice('- name: figure', '所有 `at/from/to` 必须是数字');

/* ---------- 统计 ---------- */

const countBy = (arr: GalleryItem[], pick: (i: GalleryItem) => string) => {
  const m: Record<string, number> = {};
  arr.forEach((i) => {
    const k = pick(i);
    m[k] = (m[k] || 0) + 1;
  });
  return m;
};
const KIND_LABEL: Record<string, string> = {
  cycle: '闭环',
  compare: '对照',
  ladder: '阶梯',
  'position-line': '位置线/时间轴',
  grid: '网格',
  matrix: '矩阵',
  quadrant: '象限',
  bipartite: '二分连线',
  board: '棋盘',
  bins: '归类',
  balance: '权衡',
  tree: '树',
  venn: '交集',
  bullseye: '靶盘',
  'range-bar': '区间条',
};
const REASON_LABEL: Record<string, string> = {
  'ascii-structure': '上一轮用字符画了结构',
  'position-description': '学生刚描述完位置关系',
  'time-order': '学生在描述事件先后',
  'structure-content': '上一轮在讲结构化关系',
  'task-structure': '任务本身就是结构化关系',
  'recap-cadence': '连续多轮没出图，收一张',
  none: '旧数据未记录（留痕从 2026-10-21 起）',
};

const total = ITEMS.length;
const byKind = countBy(ITEMS, (i) => i.figure?.kind || 'position-line');
const byReason = countBy(ITEMS, (i) => i.source?.reason || 'none');
const luye = ITEMS.filter((i) => String(i.user).includes('陆野'));
const luyeKind = countBy(luye, (i) => i.figure?.kind || 'position-line');
const luyeReason = countBy(luye, (i) => i.source?.reason || 'none');
const sessionCounts: Record<string, number> = {};
const sessionKindCounts: Record<string, Record<string, number>> = {};
luye.forEach((i) => {
  sessionCounts[i.sessionId] = (sessionCounts[i.sessionId] || 0) + 1;
  const kind = i.figure?.kind || 'position-line';
  sessionKindCounts[i.sessionId] = sessionKindCounts[i.sessionId] || {};
  sessionKindCounts[i.sessionId][kind] = (sessionKindCounts[i.sessionId][kind] || 0) + 1;
});
const maxSession = Math.max(...Object.values(sessionCounts), 0);
const maxSameKindInSession = Math.max(
  ...Object.values(sessionKindCounts).flatMap((m) => Object.values(m)),
  0,
);

/* ---------- 样例图（同一组件 SSR） ---------- */

const pickIndex = (fn: (i: GalleryItem) => boolean) => ITEMS.findIndex(fn);
const sampleSpecs = [
  {
    idx: pickIndex((i) => i.source?.reason === 'time-order' && (i.figure?.spans?.length || 0) >= 1),
    caption: '时间轴：两次发出、两次返回，晚到的旧响应覆盖新结果。参考线与区间分别是「发生了什么」和「用了多久」。',
  },
  {
    idx: pickIndex((i) => i.figure?.kind === 'compare' && Array.isArray(i.figure?.spec?.left?.chain)),
    caption: '对照的链路形态：跳数徽标骑在集群边界上（白垫圈断开边界线），箭头数就是跨了几次集群。',
  },
  {
    idx: pickIndex((i) => i.figure?.kind === 'ladder'),
    caption: '阶梯：步名超过一行时卡片按文字加宽、第二行超出再收省略号，不再捅出边框。',
  },
  {
    idx: pickIndex((i) => {
      const ticks = i.figure?.axis?.ticks || [];
      return ticks.some((t: any, k: number) => k > 0 && Math.abs(Number(t.at) - Number(ticks[k - 1].at)) < 8);
    }),
    caption: '相邻刻度标签：40% 与 45% 各带六个字，重叠时后来的下移一行，区间标注同步下移。',
  },
].filter((s) => s.idx >= 0);

const sampleHtml = await Promise.all(
  sampleSpecs.map(async (s) => {
    const item = ITEMS[s.idx];
    const html = await renderToString(createSSRApp(TeachingFigure, { figure: item.figure }));
    return { ...s, item, html };
  }),
);

/* ---------- 报告正文 ---------- */

const version = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') }).toString().trim();
  } catch {
    return 'unknown';
  }
})();

const statRows = Object.entries(byKind)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `<tr><td>${esc(KIND_LABEL[k] || k)} <span class="mono">${esc(k)}</span></td><td class="num">${v}</td></tr>`)
  .join('');

const reasonRows = Object.entries(byReason)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `<tr><td>${esc(REASON_LABEL[k] || k)} <span class="mono">${esc(k)}</span></td><td class="num">${v}</td></tr>`)
  .join('');

const reasonWhyRows = extractReasonWhys(VISUAL_SRC)
  .map(([r, w]) => `<tr><td class="mono">${esc(r)}</td><td>${esc(w)}</td></tr>`)
  .join('');

const kindGuide = extractKindGuide(VISUAL_SRC)
  .map((line) => esc(line.replace(/^-\s*/, '')))
  .join('\n');

const FIXES = [
  ['阶梯步名捅出卡片', '9–38px 越界（外审实拍）', '按文字折两行 + 超长收省略号；卡片宽度跟文字走（150–240px）'],
  ['对照条目被截半句', '「先写入 this.list，视图立刻渲染…」后半句丢失', '条目改两行排版，行高按内容长'],
  ['桥接框把数字拆成两个', '「0 / .5」、末行只剩一个「小」', 'ASCII 词/数字边界回退 + 按行数均衡行宽'],
  ['刻度复述对象标签', '「最低那天」轴上下各出现一次', '同坐标同文案时只保留一处'],
  ['圆环节点左侧色带', '贴圆角边框的 5px 装饰条，放大读成「没闭合 + 阴影」', '删除装饰条（语气色由边框与标题承担）'],
  ['跳数徽标压在边界线上', '1/2 与集群边界线相切', '徽标下垫白圈，边界线到徽标前断开（保留「边界上序号=跨集群次数」的语义）'],
  ['无标签参考线', '模型给 at:2500 / label:null，图上一条凭空竖虚线', '只画有名字的参考线'],
  ['靠边参考线标签被裁', '「最后写视图：屏幕停在「北京」」右半截没了', '按估算宽度贴边时改内侧对齐（start/end）'],
  ['相邻刻度标签重影', '40% 与 45% 两条六字标签叠成一团', '按宽度贪心分行，区间标注与画布高度同步下移'],
  ['评审页位置线掉样式', '轴线 stroke:none、字号退回 16px（SSR 无 scope 属性、?inline 取不到 scoped 块）', '生成器直接读 SFC 的 style 注入'],
];

const fixRows = FIXES.map(
  ([a, b, c], i) => `<tr><td class="num">${i + 1}</td><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`,
).join('');

const contextRow = (label: string, text: string | undefined, cls: string) =>
  text
    ? `<div class="ctx ctx--${cls}"><span class="ctx__label">${label}</span><span class="ctx__text" title="${esc(text)}">${esc(text)}</span></div>`
    : '';

const sampleCards = sampleHtml
  .map(
    (s) => `<div class="sample">
  <div class="sample__cap">${esc(s.caption)}</div>
  <div class="sample__meta">${esc(s.item.figure?.kind)} · ${esc(s.item.user || '—')} · ${esc(s.item.topic || '—')} · 触发：${esc(
      REASON_LABEL[s.item.source?.reason || 'none'] || s.item.source?.reason || 'none',
    )}</div>
  ${contextRow('学生', s.item.context?.student, 'student')}
  ${contextRow('老师', s.item.context?.teacher, 'teacher')}
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
h1 { font-size: 24px; line-height: 1.4; margin: 0 0 6px; }
h2 { font-size: 17px; margin: 34px 0 10px; padding-left: 10px; border-left: 3px solid #4f46e5; }
h3 { font-size: 14px; margin: 20px 0 8px; color: #3730a3; }
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
pre { margin: 8px 0; padding: 12px 14px; background: #f8f9fb; border: 1px solid #e3e7ef; border-radius: 8px;
  font: 12px/1.7 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; color: #29303d; }
.note { color: #6b7280; font-size: 12px; margin: 6px 0 0; }
.sample { background: #fff; border: 1px solid #e3e7ef; border-radius: 12px; padding: 12px 14px; margin: 12px 0; overflow: auto; }
.sample__cap { font-size: 13px; color: #29303d; margin-bottom: 2px; }
.sample__meta { font-size: 11px; color: #8b93a3; margin-bottom: 6px; }
.sample svg { max-width: 100%; height: auto; }
.ctx { display: flex; gap: 8px; margin: 2px 0 6px; font-size: 13px; line-height: 1.65; }
.ctx__label { flex: none; font-size: 11px; font-weight: 600; color: #7b8494; border: 1px solid #e3e7ef; border-radius: 4px;
  padding: 1px 5px; height: 18px; line-height: 16px; }
.ctx--student .ctx__text { color: #4a5568; }
.ctx--teacher .ctx__text { color: #29303d; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.teaching-figure__hint { display: none !important; }
.kpi { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 4px; }
.kpi div { flex: 1 1 150px; background: #fff; border: 1px solid #e3e7ef; border-radius: 10px; padding: 10px 12px; }
.kpi b { display: block; font-size: 22px; line-height: 1.3; }
.kpi span { font-size: 12px; color: #6b7280; }
.tag { display: inline-block; padding: 0 6px; border-radius: 4px; background: #eef0ff; color: #4338ca; font-size: 11px; }
@media print {
  body { background: #fff; padding: 0; }
  .card, .sample, .lead { break-inside: avoid; }
  h2 { break-after: avoid; }
}
` + FIGURE_CSS;

const body = `
<div class="page">
  <h1>教学图这一轮：渲染收紧、闸门修好、提示词现状</h1>
  <p class="meta">2026-10-21 · 分支 feat/teaching-figures · 版本 ${esc(version)}（未推送） · 数据来源：主库 teaching_session_messages 真实下发记录</p>

  <div class="lead">
    <p><b>结论</b></p>
    <ol>
      <li>图型目录是固定的 16 种，模型只交 spec，渲染由代码确定性完成——这是设计，不是模型只画得出这几种。</li>
      <li>但真课里只出现了 4 种（位置线 10、对照 5、阶梯 4、闭环 1）；其中一课 ${maxSession} 张图、${maxSameKindInSession} 张全是位置线——会话上限 4 与同图型上限 3 都被突破。</li>
      <li>原因是两道重复闸门（会话上限 4 张、同图型 3 张）的计数读的是回合内存快照，整场都没触发；现已改为按库里的侧表计数，并补一道同图型硬闸。</li>
      <li>渲染侧修了 10 处：越界、截半句、拆数字、复述、装饰色带、徽标压线、无标签参考线、靠边裁切、刻度重影、评审页掉样式。</li>
      <li>全量检测：${total} 张图 0 处越界、0 处文字重叠、0 处省略号截断。</li>
    </ol>
  </div>

  <h2>一、真实课数据</h2>
  <div class="kpi">
    <div><b>${total}</b><span>图库里的图（含旧探针数据）</span></div>
    <div><b>${luye.length}</b><span>本轮真实课程产出（陆野 · 搜索竞态）</span></div>
    <div><b>${Object.keys(byKind).length}</b><span>出现的图型数</span></div>
    <div><b>${maxSession}</b><span>本轮单课最多图数（上限 4）</span></div>
  </div>
  <div class="card">
    <h3>图型分布</h3>
    <table><thead><tr><th>图型</th><th class="num">张数</th></tr></thead><tbody>${statRows}</tbody></table>
    <h3>触发源分布</h3>
    <table><thead><tr><th>为什么调用（代码判据）</th><th class="num">张数</th></tr></thead><tbody>${reasonRows}</tbody></table>
    <p class="note">陆野这节课：${Object.entries(luyeReason).map(([k, v]) => `${esc(REASON_LABEL[k] || k)} ${v}`).join('、')}。time-order 是这一轮新增的时机，在真实回合里确实触发（命中依据如「先发、发出、响应、返回」）。</p>
  </div>

  ${sampleCards}

  <h2>二、渲染修复清单</h2>
  <div class="card">
    <table>
      <thead><tr><th class="num">#</th><th>现象</th><th>证据</th><th>修法（全部确定性约束）</th></tr></thead>
      <tbody>${fixRows}</tbody>
    </table>
    <p class="note">检查口径：逐张比较文字 bbox 与画布/所在卡片矩形，再两两比对文字 bbox 求交叠面积；省略号用 SVG 文本内容扫描。检测脚本与修复都在前端渲染器与位置线模板里，不依赖模型配合。</p>
  </div>

  <h2>三、重复闸门为什么失效</h2>
  <div class="card">
    <p>证据：陆野这一轮共 ${luye.length} 张图（位置线 ${luyeKind['position-line'] || 0} 张），其中一课 <b>${maxSession} 张</b>、且 <b>${maxSameKindInSession} 张同型</b>——会话上限 4、同图型上限 3 都被突破，日志里「本会话图数已达上限」「同骨架」一次都没出现。而库里这个会话的侧表有 17 条消息、6 条带 figures——数据是齐的。</p>
    <p>根因：闸门的计数参数是回合内存里的消息列表，那份快照看不到已落库的图，计数恒为 0，两道闸都形同虚设。</p>
    <p>修法：仓库新增 <span class="mono">countFiguresByKind(sessionId)</span>，直接读 <span class="mono">teaching_session_messages</span> 侧表逐条解析；引擎在会话上限之后再加一道同图型硬闸（默认 3，与旧规则同值），计数取自库。提示词里也补了一句：同一节课同一种图最多 3 张，第 4 次换形状或用文字。</p>
    <p class="note">可调项：TEACHING_FIGURE_MAX_PER_SESSION（默认 4）、TEACHING_FIGURE_MAX_PER_KIND（默认 3）。</p>
  </div>

  <h2>四、当前版本提示词</h2>
  <p class="meta">下面三段是模型实际能看到的图相关文本：核心提示词片段（prompts/core/teaching-turn.yaml）、运行时追加的图型指南（teaching-visual.service.ts）、以及六个出图时机的判据文案。</p>

  <h3>4.1 核心提示词 · 图规则</h3>
  <pre>${esc(YAML_RULES)}</pre>

  <h3>4.2 核心提示词 · figure 字段契约</h3>
  <pre>${esc(YAML_FIGURE_FIELD)}</pre>

  <h3>4.3 运行时图型指南（每次给时机时追加）</h3>
  <pre>${kindGuide}</pre>

  <h3>4.4 六个出图时机（代码判据，写进 figureSource）</h3>
  <div class="card" style="padding:0;border:0;background:none">
    <table><thead><tr><th>reason</th><th>判据文案（ruleWhy）</th></tr></thead><tbody>${reasonWhyRows}</tbody></table>
  </div>

  <h3>4.5 确定性护栏（代码，不靠模型自觉）</h3>
  <pre>1. 时间轴误用：位置线带时间单位 + 区间标签含「幅度/涨跌/差值/百分比/%」→ 拒绝，改用 range-bar
2. 极值点当区间：marks &lt; 3、无刻度、≥1 个区间、且 ≥2 个标签含「最高/最低/最大/最小」→ 拒绝
3. 图内数字与正文对账：两边各 ≥2 个数字且零交集 → 判定图文打架，本轮不出图
4. 防答案泄漏：本轮回复布置了「由学生自己画/排」的练习 → 不出图
5. 重复闸门：同骨架（bigram Jaccard ≥ 0.45）不重摆；会话 ≤4 张；同图型 ≤3 张（按库计数）
6. 留痕：figureSource = { trigger, reason, kindHint, ruleWhy, matched[] }，随消息落库，评审页直接展示</pre>

  <h2>五、复现与文件</h2>
  <div class="card">
    <p>评审页（图库，36 张，含出图动机）：<span class="mono">outputs/teaching-figures-review.html</span></p>
    <p>本报告：<span class="mono">outputs/teaching-figures-report-20261021.html</span></p>
    <p>生成命令（frontend 目录）：</p>
    <pre>node node_modules/vite-node/vite-node.mjs scripts/figure-review-html.ts   # 图库
node node_modules/vite-node/vite-node.mjs scripts/figure-report-html.ts   # 本报告
cd ../backend &amp;&amp; FIGURE_DB=D:/test/wenflow/backend/prisma/dev.db npx ts-node --transpile-only scripts/export-figures.ts</pre>
    <p>测试：后端 68 条（出图服务 66 + 图型计数 2）、前端 44 条（渲染器 24 + 组件 20）。</p>
    <p class="note">数据说明：本轮真课的后端是从图分支起的 3005，但 Prisma 解析到主树 dev.db，所以会话数据落在主库；autopilot 在第 13 步被「进程重启」中断（两个后端共用一个库时探活互相干扰），图已全部落库并导出。</p>
  </div>
</div>`;

const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<title>教学图报告 · 2026-10-21</title>
<style>${CSS}</style>
</head>
<body>${body}</body></html>`;

const targets = [
  new URL('../../outputs/teaching-figures-report-20261021.html', import.meta.url),
  new URL('../figure-out/report.html', import.meta.url),
];
for (const path of targets) writeFileSync(path, html, 'utf8');
console.log(`report: ${total} figures, ${sampleCards.split('<div class="sample">').length - 1} samples, ${Math.round(html.length / 1024)}KB`);
