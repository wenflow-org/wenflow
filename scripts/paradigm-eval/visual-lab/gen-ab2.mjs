// 扩散提示词 A/B 实验 v2：生产模板(P) vs 改良模板(I) × 5 案例（含方差重复）
// 生产模板 = 逐字取自 backend/src/services/ai-teaching/teaching-visual.service.ts#composeTeachingVisualPrompt
// 凭据从 backend/.env 读取，不落盘。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const URL_ = get('IMAGE_API_URL');
const KEY = get('IMAGE_API_KEY');
const MODEL = get('IMAGE_MODEL') || 'agnes-image-2.5-flash';

// ---- P：生产模板（逐字，含 kind="对比图" 的口径）----
const P_STYLE = [
  '教学示意图（课堂辅助用）',
  '类型：对比图',
  '要求：简洁、线条清晰、结构明确，只画描述里说的内容；不要多余的装饰与无关文字',
  '画面里不要出现任何文字：不要标签、不要对话气泡、不要表格与编号；要说明的内容由图下方的说明文字承担，至多保留极少量数字符号',
  '画关系不画故事：画面呈现的是顺序/层级/包含/对比/变化这类抽象关系；状态差异要画出可见区别（如满/半、开/合）',
  '构图：横向关系用横向构图，纵向层级用纵向构图，画面留白充足',
].join('；');
const P_TAIL = '。再次强调：画面内不出现文字与标注，只画图形与关系。';
const composeP = subject => `${P_STYLE}。画面内容：${subject}${P_TAIL}`;

// ---- I：改良模板（隐喻调优：具身场景 + 风格锚 + 物理代理化）----
const I_STYLE = [
  '教学具身插画（课堂辅助用，呈现一个可触摸的物理场景或隐喻）',
  '风格：扁平矢量插画，纯色浅底，粗轮廓，高对比，海报式构图，人物与物件清晰可辨，画面干净',
  '用可见的物理差异表达抽象区别：温度、光影、物件状态、姿态、距离——不要试图画出看不见的东西（情绪、时间、顺序），一律翻译成看得见的物理代理',
  '画面里不要出现任何文字：不要标签、不要对话气泡、不要表格与编号',
  '构图：单场景聚焦或左右双联并置（两格结构一致、差异集中在核心物件上），画面留白充足',
].join('；');
const I_TAIL = '。再次强调：画面内不出现文字与标注，只画图形与实物。';
const composeI = subject => `${I_STYLE}。画面内容：${subject}${I_TAIL}`;

const CASES = [
  {
    id: 'have-done',
    size: '1024x1024',
    subject: '一个人站在一束明亮温暖的聚光灯圆圈里，双手稳稳举起一张刚显影完成的拍立得照片向前展示，照片里是一本合上的书；身后灰暗背景里延伸着一条渐渐隐没的传送带，带上有淡淡的脚印。聚焦"在聚光灯下持有并展示照片"这个姿态。',
  },
  {
    id: 'alone-lonely',
    size: '1312x736',
    subject: '左右并置的双联画，两格构图完全相同：同一个单人房间、同一把椅子、同一个人、同样的窗与灯。左格光线温暖，桌上冒着热气的茶杯与摊开的书；右格同样的家具，色调冷灰，茶杯空了，灯光暗淡。差异只在光线、色调与物件状态。',
  },
  {
    id: 'lock-queue',
    size: '1024x1024',
    subject: '一扇只有一个隔间的公共厕所门前，三个人排成一队等待，门内有人；队伍里的每个人头顶有一条虚线连向门把手（代表排队等锁）。第一人手里攥着一把黄铜钥匙。整体用排队这个日常场景映射"线程争抢同一把锁"。',
  },
  {
    id: 'derivative-speed',
    size: '1024x1024',
    subject: '一辆汽车在笔直公路上行驶，仪表盘上速度指针清晰，车尾拖着一道短促的速度线；公路旁立着一块里程碑，车前挡风玻璃上贴着同一时刻的照片，照片里只有车与路面。用"速度表读数"映射"某一瞬间的瞬时速度（导数）"，用"整段路程"背景映射平均值。',
  },
  {
    id: 'broken-return',
    size: '1312x736',
    subject: '横向构图的极简技术场景：左侧一台客户端机器（方形），右侧一台服务端机器（方形），中间大段空白。从左向右一条完整实心箭头线（请求走完全程到达右侧）；从右向左一条虚线（响应），这条虚线在回程中途断成两截，断口处留明显缺口和一小段散落的虚点，永远到不了左侧。断口位于两机正中间，是整个画面唯一且最醒目的焦点。右机内部一个对勾形状，左机内部一个空心圆。',
  },
];

const RUNS = [];
for (const c of CASES) {
  RUNS.push({ id: `${c.id}-P`, case: c, variant: 'P', prompt: composeP(c.subject), size: c.size });
  RUNS.push({ id: `${c.id}-I`, case: c, variant: 'I', prompt: composeI(c.subject), size: c.size });
}
// 方差重复：拍立得 + 断口 关键格各再采一次
const again = ['have-done', 'broken-return'];
for (const id of again) {
  const c = CASES.find(x => x.id === id);
  RUNS.push({ id: `${id}-P2`, case: c, variant: 'P', prompt: composeP(c.subject), size: c.size });
  RUNS.push({ id: `${id}-I2`, case: c, variant: 'I', prompt: composeI(c.subject), size: c.size });
}

const results = [];
for (const run of RUNS) {
  try {
    const started = Date.now();
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model: MODEL, prompt: run.prompt, n: 1, size: run.size, response_format: 'url' }),
      signal: AbortSignal.timeout(180000),
    });
    const j = await res.json().catch(() => ({}));
    const url = j?.data?.[0]?.url || '';
    const out = { id: run.id, variant: run.variant, status: res.status, ms: Date.now() - started, prompt: run.prompt };
    if (url) {
      const imgRes = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        fs.writeFileSync(path.join(__dirname, 'ab2-' + run.id + '.png'), buf);
        out.file = 'ab2-' + run.id + '.png';
      }
    } else out.error = JSON.stringify(j).slice(0, 160);
    results.push(out);
    console.log(run.id, run.variant, '->', res.status, `${out.ms}ms`, out.file || out.error);
  } catch (e) {
    results.push({ id: run.id, error: String(e).slice(0, 160) });
    console.log(run.id, 'ERR', String(e).slice(0, 100));
  }
  await new Promise(r => setTimeout(r, 1500));
}
fs.writeFileSync(path.join(__dirname, 'ab2-results.json'), JSON.stringify(results, null, 1));
console.log('DONE', results.filter(r => r.file).length, '/', RUNS.length);
