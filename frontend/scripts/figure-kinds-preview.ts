// 九图型总览 + 调色板对照：用产品同一个确定性渲染器出图，拼成一张 HTML（2026-10-19 视觉语言层验收用）
// 用法（在 frontend 目录）：node node_modules/vite-node/vite-node.mjs scripts/figure-kinds-preview.ts [输出路径]
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';
import { FIGURE_PALETTE_KEYS, paletteOfSubject, type FigurePalette } from '@/components/teaching-figure/style';

const cases: Array<[string, string, Record<string, unknown>]> = [
  ['grid', '课时安排（已有内容的表）', {
    title: '两种做法的排布：有内容的表才画',
    rows: 3,
    cols: 3,
    rowLabels: ['甲组', '乙组', '丙组'],
    colLabels: ['任务', '负责', '状态'],
    cells: [
      { r: 0, c: 0, text: '读材料' }, { r: 0, c: 1, text: '甲' }, { r: 0, c: 2, text: '已完', hl: 'ok' },
      { r: 1, c: 0, text: '列骨架' }, { r: 1, c: 1, text: '乙' }, { r: 1, c: 2, text: '进行', hl: 'accent' },
      { r: 2, c: 0, text: '对账' }, { r: 2, c: 1, text: '丙' }, { r: 2, c: 2, mask: true },
    ],
    note: '最后一格留给学生自己填：已填内容 + 少量留白才是教具，整张空表是输入控件。',
  }],
  ['matrix', '评分点 × 答案段落命中矩阵', {
    title: '逐条对账：写到了 / 漏 / 堆砌 / 同一条',
    rowLabels: ['自然·地形', '自然·水源', '社会·交通', '社会·劳动力'],
    colLabels: ['第一段', '第二段', '第三段'],
    cells: [
      { r: 0, c: 0, tone: 'hit' }, { r: 0, c: 1, tone: 'miss' },
      { r: 1, c: 0, tone: 'hit' }, { r: 1, c: 2, tone: 'dup' },
      { r: 2, c: 1, tone: 'hit' },
      { r: 3, c: 1, tone: 'key' }, { r: 3, c: 2, tone: 'key' },
    ],
    legend: [
      { text: '✓ 已写到', fill: '#e6f4f1' },
      { text: '— 漏', fill: '#f3f4f7' },
      { text: '叠 重复堆砌', fill: '#fdf3e6' },
    ],
    note: '同一行打两个 ≡ 表示这一条在两段里其实是同一件事。',
  }],
  ['compare', '两条分支并排对照', {
    title: '两种学习理论对「建议」的约束',
    left: { head: '行为主义', sub: '看行为变化', items: ['给即时反馈', '拆小步练习', '强化正确行为'] },
    right: { head: '建构主义', sub: '看意义建构', items: ['先激活旧知', '给真实情境', '让学生自己解释'] },
    divider: '分歧：\n学习发生在哪里',
    leftTone: 'neutral',
    rightTone: 'accent',
    note: '左右都是中性色时适合做「不暗示优劣」的对照。',
  }],
  ['quadrant', '2×2 象限（信度 × 效度）', {
    title: '评估结果怎么读：信度 × 效度',
    colLabels: ['效度高', '效度低'],
    rowLabels: [{ label: '信度高', sub: '稳定' }, { label: '信度低', sub: '不稳' }],
    cells: [
      { title: '可信可用', body: ['可以据此', '下判断'], tone: 'ok', icon: { kind: 'target', dots: [[0, 0], [1, -1]] } },
      { title: '稳定地偏', body: ['每次都错', '同一个方向'], tone: 'neutral', icon: { kind: 'target', dots: [[9, 8], [11, 9]] } },
      { title: '偶然命中', body: ['这次对了', '不代表能力'], tone: 'neutral', icon: { kind: 'target', dots: [[24, -18], [-21, 20]] } },
      { title: '不可用', body: ['既不稳也不准'], tone: 'warn', icon: { kind: 'target', dots: [[26, 24], [-25, -22]] } },
    ],
    note: '靶盘上的点是「这次打偏的方向」：越集中越有系统偏差。',
  }],
  ['bipartite', '多对多：目标 × 建议', {
    title: '一条建议可能服务多个目标',
    left: { head: '学习目标', nodes: [{ id: 'a', label: '倾听与表达' }, { id: 'b', label: '阅读准备' }, { id: 'c', label: '社会适应' }] },
    right: { head: '教育建议', nodes: [{ id: 'x', label: '多给表达机会' }, { id: 'y', label: '共读图画书' }, { id: 'z', label: '同伴合作任务' }] },
    edges: [
      { from: 'a', to: 'x' }, { from: 'a', to: 'z' },
      { from: 'b', to: 'y' }, { from: 'b', to: 'x' },
      { from: 'c', to: 'z' },
    ],
    note: '连线交叉本身就是信息：交叉越多，说明这条建议越是「通用型」。',
  }],
  ['board', '棋盘：中国象棋走法', {
    title: '炮二平五：横move 要跨列，只画上下会讲错',
    panelLabel: '标准开局',
    pieces: [
      { col: 4, rank: 9, key: 'K' }, { col: 4, rank: 0, key: 'k' },
      { col: 1, rank: 7, key: 'C' }, { col: 7, rank: 2, key: 'c' },
      { col: 4, rank: 6, key: 'P' }, { col: 4, rank: 3, key: 'p' },
    ],
    files: [{ col: 4, label: '中路', tone: 'accent' }],
    arrows: [
      { a1: { col: 1, rank: 7 }, a2: { col: 4, rank: 7 }, label: '炮二平五' },
      { a1: { col: 4, rank: 9 }, a2: { col: 4, rank: 7 }, label: '进一' },
    ],
    note: '红方先走：平是横move，进是朝对方走。',
  }],
  ['bins', '把条目放进容器（所属关系）', {
    title: '这些证据分别能用到什么程度',
    bins: [
      { label: '能直接采信', tone: 'ok', items: [{ label: '同一口径复现', mark: '强' }, { label: '样本覆盖多班', mark: '强' }] },
      { label: '只能参考', items: ['个案访谈', '单次课堂观察'] },
      { label: '不能用', tone: 'warn', items: [{ label: '没有对照的对比', mark: '弱' }] },
    ],
    focus: 0,
    note: '箱子的边界就是判据：说不清哪条该进哪箱，说明判据还没立住。',
  }],
  ['balance', '权衡：两边各自的分量', {
    title: '课堂时间怎么分：两种排法',
    left: { head: '先讲后练', sub: '概念先行', items: ['概念讲清楚', '练习时间被压'], weight: 7 },
    right: { head: '先练后讲', sub: '问题先行', items: ['暴露真实卡点', '初期挫败感强'], weight: 4 },
    pivotLabel: '课时总量固定',
    note: '倾斜只表示「这边更重」，不代表哪边更好——判据要学生自己给。',
  }],
  ['ladder', '层级 / 进度：位置本身就是信息', {
    title: '从读懂到能改：四级台阶',
    steps: [
      { label: '读懂例题', state: 'done', sub: '能复述' },
      { label: '照着走一遍', state: 'done', sub: '有提示' },
      { label: '自己走一遍', state: 'current', sub: '当前' },
      { label: '换条件重做', state: 'todo' },
      { label: '讲给别人听', state: 'todo' },
    ],
    note: '每一级都是一个「可以停下来验收」的门槛，不是时间刻度。',
  }],
];

const blocks = cases.map(([kind, label, spec]) => {
  const r = renderSpecFigure(kind, spec);
  return `<section><h2>${kind}<span>${label}</span></h2>${r ? r.svg : '<p style="color:#b91c1c">渲染失败</p>'}</section>`;
}).join('\n');

// 调色板对照：同一份 spec、同一个渲染器，只换 palette
const paletteSpec = {
  title: '同一张图，六套配色',
  steps: [
    { label: '读懂例题', state: 'done' },
    { label: '自己走一遍', state: 'current' },
    { label: '换条件重做' },
  ],
};
const paletteBlocks = FIGURE_PALETTE_KEYS.map((key: FigurePalette) => {
  const r = renderSpecFigure('ladder', paletteSpec, { palette: key });
  return `<figure><figcaption>${key}${key === 'earth' || key === 'warm' || key === 'violet' ? ' · paper' : ''}</figcaption>${
    r ? r.svg : '渲染失败'
  }</figure>`;
}).join('\n');

const subjectRows = [
  ['地理', 'earth'],
  ['历史', 'earth'],
  ['语文', 'violet'],
  ['数学', 'indigo'],
  ['物理', 'tech'],
  ['化学', 'tech'],
  ['英语', 'indigo'],
]
  .map(([subject, expected]) => `<tr><td>${subject}</td><td><code>${paletteOfSubject(subject)}</code></td><td>${expected}</td></tr>`)
  .join('');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>教学图图型总览</title>
<style>
  body{margin:0;padding:24px;background:#f6f7f9;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1f2430}
  h1{font-size:18px;margin:0 0 4px}
  .lead{margin:0 0 20px;font-size:13px;color:#5b6474}
  section{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:14px;margin-bottom:16px;overflow-x:auto}
  h2{font-size:13px;margin:0 0 10px;color:#4f46e5;font-family:ui-monospace,Consolas,monospace}
  h2 span{color:#7b8494;font-weight:400;margin-left:10px;font-family:inherit}
  svg{display:block;max-width:none}
  .palettes{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:14px;margin-bottom:20px}
  .palettes figure{margin:0;background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:10px;overflow-x:auto}
  .palettes figcaption{font:12px/1.6 ui-monospace,Consolas,monospace;color:#7b8494;margin-bottom:6px}
  table{border-collapse:collapse;background:#fff;border:1px solid #e3e7ef;border-radius:12px;font-size:13px}
  td,th{padding:6px 12px;border-bottom:1px solid #eef1f6;text-align:left}
  code{font-family:ui-monospace,Consolas,monospace;color:#4f46e5}
</style></head><body>
<h1>教学图图型总览（确定性 SVG 渲染 + 视觉语言层）</h1>
<p class="lead">与课堂里用的是同一份渲染器代码（frontend/src/components/teaching-figure/render.ts）：同一份 spec 永远画出同一张图，无生成、无联网、零乱码。加粗描边/底色变化只来自 palette 与 focus，几何不随主题变化。</p>
${blocks}
<h1 style="margin-top:24px">六套调色板</h1>
<p class="lead">学科 → 配色由 <code>paletteOfSubject</code> 决定（服务端与前端同一张表）；earth / warm / violet 自动带纸纹底。</p>
<div class="palettes">${paletteBlocks}</div>
<table><thead><tr><th>学科</th><th>实际</th><th>预期</th></tr></thead><tbody>${subjectRows}</tbody></table>
</body></html>`;

const out = path.resolve(process.argv[2] || '../outputs/learn-visual-aids-20261017/figure-kinds-preview.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('written', out);
