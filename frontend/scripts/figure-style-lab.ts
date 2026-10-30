// 视觉语言对照实验：同一批课堂内容，分别用「现有骨架」「调色板」「新图元」渲染，放在一张长页里比对
// 用法（在 frontend 目录）：node node_modules/vite-node/vite-node.mjs scripts/figure-style-lab.ts [输出 html]
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';
import { FIGURE_PALETTE_KEYS } from '@/components/teaching-figure/style';

const geoBins = {
  rows: 2,
  cols: 2,
  title: '把答案里的条件归到两栏',
  cells: [
    { r: 0, c: 0, text: '水源' },
    { r: 0, c: 1, text: '交通' },
    { r: 1, c: 0, text: '地形' },
    { r: 1, c: 1, text: '地价' },
  ],
  focus: { col: 0 },
};

const blocks: Array<{ title: string; note: string; html: string }> = [];

function add(title: string, note: string, kind: string, spec: Record<string, unknown>, palette?: any) {
  const r = renderSpecFigure(kind, spec, { palette });
  blocks.push({ title, note, html: r ? r.svg : '<p style="color:#b91c1c">渲染失败</p>' });
}

/* ① 现有骨架 vs 新图元：同一份「归位」内容 */
add('A · 现状：两列卡片（compare）', '条目是并列的两列，看不出「归属」；全部同字号同描边', 'compare', {
  title: '把答案里的条件归到两栏',
  left: { head: '自然条件', sub: '没人它还在', items: ['水源', '地形'] },
  right: { head: '社会经济条件', sub: '人弄出来的', items: ['交通', '地价'] },
  divider: '判据：\n没人它还在吗',
  leftTone: 'neutral',
  rightTone: 'accent',
}, 'indigo');

add('B · 新图元：收纳箱（bins）', '条目画在容器里——一眼看到「谁在谁里面」，不用读两列标题去推', 'bins', {
  title: '把答案里的条件归到两栏',
  bins: [
    { label: '自然条件', tone: 'ok', items: [{ label: '水源' }, { label: '地形' }, { label: '气候' }] },
    { label: '社会经济条件', tone: 'accent', items: [{ label: '交通' }, { label: '地价' }, { label: '劳动力' }] },
  ],
  note: '判据：没有人类活动，它还在吗？',
}, 'earth');

add('C · 新图元：天平（balance）', '用于取舍类内容：倾斜方向就是「哪边更重」，不是又一张并排表', 'balance', {
  title: '先补角度，还是先练材料落地？',
  left: { head: '补角度', sub: '一周 3 次', weight: 3, items: ['能覆盖新题型', '见效慢'] },
  right: { head: '练落地', sub: '每周都在用', weight: 5, items: ['每次考试都得分', '不解决漏角度'] },
  pivotLabel: '当前时间预算',
  note: '倾斜由代码按 weight 计算，模型只给两边各自的分量。',
}, 'earth');

add('D · 新图元：阶梯（ladder）', '用于层级/进度：位置本身就是信息，不必再画一遍流程箭头', 'ladder', {
  title: '区位大题的作答顺序',
  steps: [
    { label: '定角度', sub: '自然 / 社会经济', state: 'done' },
    { label: '落材料', sub: '每条挂一个线索', state: 'done' },
    { label: '扣设问', sub: '答到问的那一层', state: 'current' },
    { label: '排层次', sub: '先主后次', state: 'todo' },
  ],
  note: '第 3 步是本节要练的；前两步已能独立完成。',
}, 'earth');

/* ② 调色板：同一张对账矩阵，四种学科色 */
const matrixSpec = {
  title: '逐条对账：写到了 / 漏 / 堆砌',
  rowLabels: ['自然·地形', '自然·水源', '社会·交通', '社会·劳动力'],
  colLabels: ['第一段', '第二段', '第三段'],
  cells: [
    { r: 0, c: 0, tone: 'hit' },
    { r: 0, c: 1, tone: 'miss' },
    { r: 1, c: 0, tone: 'hit' },
    { r: 1, c: 2, tone: 'dup' },
    { r: 2, c: 1, tone: 'hit' },
    { r: 3, c: 1, tone: 'key' },
    { r: 3, c: 2, tone: 'key' },
  ],
  legend: [
    { text: '✓ 已写到', fill: '#e6f4f1' },
    { text: '— 漏', fill: '#f3f4f7' },
    { text: '叠 重复堆砌', fill: '#fdf3e6' },
  ],
  focus: { row: 0 },
};
for (const p of FIGURE_PALETTE_KEYS) {
  add(`调色板 · ${p}`, p === 'mono' ? '只靠字阶与线宽分层次（打印/压色场景）' : '只换色相，几何与字阶不变', 'matrix', matrixSpec, p);
}

/* ③ 焦点强调：同一张矩阵，有没有 focus 的差别 */
add('焦点 · 无 focus', '每行每格等重，读者得自己找「这次该看哪一行」', 'matrix', { ...matrixSpec, focus: undefined }, 'violet');
add('焦点 · 指向漏答的那一行', '焦点行加底色、表头提重、卡片起轻投影——这就是「信号」，不增加任何新信息', 'matrix', matrixSpec, 'violet');

const sections = blocks
  .map(
    (b) => `<section>
  <h2>${b.title}</h2>
  <p class="note">${b.note}</p>
  ${b.html}
</section>`,
  )
  .join('\n');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>教学图 · 视觉语言对照</title>
<style>
  :root{color-scheme:light}
  body{margin:0;padding:26px;background:#f4f5f7;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1f2430}
  h1{font-size:19px;margin:0 0 4px}
  .lead{margin:0 0 22px;font-size:13px;color:#5b6474;max-width:860px;line-height:1.7}
  section{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:14px 16px 16px;margin-bottom:16px;overflow-x:auto}
  h2{font-size:13px;margin:0 0 2px;color:#3730a3;font-family:ui-monospace,Consolas,monospace}
  .note{font-size:12px;color:#7b8494;margin:0 0 12px}
  svg{display:block;max-width:none}
</style></head><body>
<h1>教学图 · 视觉语言对照（同一批课堂内容）</h1>
<p class="lead">结论先说：单调不是因为「样本少」，而是因为每张图都是<b>同一套骨架</b>——89 张图里白底出现 658 次、13px 字号 409 次、描边几乎全是 1.1/1.2px，所有元素的视觉重量一样重。下面三组实验分别验证：换形状（搬运语义）、换色相（学科气质）、加焦点（信号）。</p>
${sections}
</body></html>`;

const out = path.resolve(process.argv[2] || '../outputs/learn-visual-aids-20261017/style-lab/lab.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('written', out, 'blocks', blocks.length);
