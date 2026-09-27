// 扩散生图通道实测：3 张测试图（拍立得隐喻 / alone-lonely 双联 / 翻车案断口重试）
// 凭据从 backend/.env 读取（IMAGE_API_URL / IMAGE_API_KEY / IMAGE_MODEL），不落盘。
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

// 与生产 composeTeachingVisualPrompt 同源的风格约束（含尾部二次强调"无字"）
const STYLE = '教学示意图（课堂辅助用）；要求：简洁、线条清晰、结构明确，只画描述里说的内容；不要多余的装饰与无关文字；'
  + '画面里不要出现任何文字：不要标签、不要对话气泡、不要表格与编号；要说明的内容由图下方的说明文字承担，至多保留极少量数字符号；'
  + '画关系不画故事；构图：横向关系用横向构图，画面留白充足。';
const TAIL = '。再次强调：画面内不出现文字与标注，只画图形与关系。';

const TESTS = [
  {
    id: 'D1-polaroid',
    label: '拍立得隐喻（现在完成时 have done）',
    size: '1024x1024',
    subject: '极简二维扁平矢量插画，一个人站在一束明亮温暖的聚光灯圆圈里（代表"现在"），'
      + '他的双手正稳稳举起一张刚显影完成的拍立得照片向前展示，照片里是一个已完成的场景（一本合上的书）；'
      + '身后灰暗的背景里延伸着一条渐渐隐没的传送带（代表过去），带上有淡淡的脚印。'
      + '聚焦"在当前聚光灯下持有并展示照片"这个身体姿态，高对比，粗轮廓，海报风格。',
  },
  {
    id: 'D2-alone-lonely',
    label: 'alone vs lonely 双联画（内在状态，否定性概念酸测试）',
    size: '1312x736',
    subject: '左右并置的双联画，两个画格构图完全相同：一个单人房间，一个人坐在同一把椅子上，同样的窗、同样的灯、同样的姿势。'
      + '左格：光线温暖明亮，桌上放着冒热气的茶杯和摊开的书，画面氛围是从容自在的独处（客观上的"一个人"）；'
      + '右格：同样的房间同样的家具，但色调冷灰，茶杯是空的，灯光暗淡，画面氛围是空落落的孤独（主观上的"孤独"）。'
      + '两个画格在房间结构与人物姿态上保持高度一致，只在光线、色调与物件状态上呈现明显可见的差异。',
  },
  {
    id: 'D3-broken-return',
    label: '翻车案断口重试（同语义对照 M1）',
    size: '1312x736',
    subject: '横向构图的极简技术示意图：左侧是一台客户端机器（方形），右侧是一台服务端机器（方形），两台机器之间留出大段空白。'
      + '从左侧向右有一条完整的实心箭头线（代表请求，走完全程到达右侧机器）；'
      + '从右侧向左有一条虚线（代表响应），这条虚线在回程中途**断成两截**：断口处留有明显的缺口和一小段散落的虚点，'
      + '永远无法到达左侧机器。断口位于两台机器正中间，是整个画面唯一且最醒目的视觉焦点。'
      + '左右两台机器内部各有一个简单状态标记：右侧机器内是一个对勾形状（表示处理已完成），左侧机器内是一个空心的圆（表示没有收到任何东西）。',
  },
];

async function generateOne(test) {
  const prompt = `${STYLE}画面内容：${test.subject}${TAIL}`;
  const body = { model: MODEL, prompt, n: 1, size: test.size, response_format: 'url' };
  const started = Date.now();
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json().catch(() => ({}));
  const url = j?.data?.[0]?.url || '';
  const out = { id: test.id, label: test.label, size: test.size, status: res.status, ms: Date.now() - started, url: String(url).slice(0, 220), prompt };
  if (url) {
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const file = path.join(__dirname, test.id + '.png');
      fs.writeFileSync(file, buf);
      out.file = test.id + '.png';
      out.bytes = buf.length;
    }
  } else {
    out.error = JSON.stringify(j).slice(0, 200);
  }
  console.log(test.id, '->', out.status, `${out.ms}ms`, out.file || out.error || '(no url)');
  return out;
}

const results = [];
for (const t of TESTS) {
  try { results.push(await generateOne(t)); } catch (e) { results.push({ id: t.id, error: String(e).slice(0, 200) }); console.log(t.id, 'ERR', String(e).slice(0, 120)); }
  await new Promise(r => setTimeout(r, 2000));
}
fs.writeFileSync(path.join(__dirname, 'gen-diffusion-results.json'), JSON.stringify(results, null, 1));
console.log('DONE', results.filter(r => r.file).length, '/', TESTS.length);
