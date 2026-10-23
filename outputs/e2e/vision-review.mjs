// 外部视觉评审：把每张图（PNG）连同它所在的教学上下文交给视觉模型，按固定判据打分。
//
// 密钥不进仓库：从 WF_VISION_KEY_FILE 指向的文件读取（默认系统临时目录）。
// 用法：node outputs/e2e/vision-review.mjs <items.json> <imagesDir> <out.json> [roundLabel]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [itemsPath, imagesDir, outPath, label = 'round'] = process.argv.slice(2);
if (!itemsPath || !imagesDir || !outPath) {
  console.error('用法：node vision-review.mjs <items.json> <imagesDir> <out.json> [label]');
  process.exit(1);
}

const keyFile = process.env.WF_VISION_KEY_FILE || path.join(os.tmpdir(), 'wf-vis-key');
const KEY = fs.readFileSync(keyFile, 'utf8').trim();
const BASE = process.env.WF_VISION_BASE || 'https://newapi.wenflow.org/v1';
const MODEL = process.env.WF_VISION_MODEL || 'deepseek-v4.1-flash';

const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));

const SYSTEM = `你是一位严格的教学视觉评审，负责判断课堂里下发给学生的示意图是否真的有用。
你不看渲染代码，只看学生看到的东西：图 + 它出现时的那一轮对话。请毫不留情，宁可判"删"也不要客套。`;

const rubric = (it) => `下面是课堂上的一轮对话和紧随其后下发的一张图。
【学生上一句】${(it.context?.student || '（无）').slice(0, 600)}
【老师这一轮】${(it.context?.teacher || '（无）').slice(0, 1200)}
【图型】${it.figure?.kind || 'position-line'}
【图里的文字】（供你核对是否读得全）${JSON.stringify(it.figure?.spec || {}, null, 0).slice(0, 1500)}

请只输出一个 JSON 对象，不要解释、不要 markdown 代码块，字段如下：
{
 "usefulness": 0-3,          // 这张图是否在回答"学生这一刻需要看见什么"；0=纯装饰，3=没有它学生就难懂
 "geometry": 0-3,            // 图里的位置/数值/连线/包含是否承载了学科关系；0=只是把句子装进框，3=几何本身在推理
 "meta": true|false,         // 是否出现做题步骤、自查清单、批改评语这类元认知话术（而不是学科实体）
 "leak": true|false,         // 老师这一轮让学生自己产出某内容，而图里已经把完整答案给出
 "readability": 0-3,         // 文字是否读得全、有没有半截句/错位/压字/看不懂的缩写
 "redundant": true|false,    // 去掉这张图，学生靠老师这段话是否一样能懂
 "verdict": "keep"|"fix"|"drop",
 "oneLine": "一句话说这张图到底在讲什么",
 "worstIssue": "最该修的一处（没有就写 none）"
}`;

async function judge(it, imgB64) {
  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: 1400,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: rubric(it) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imgB64}` } },
        ],
      },
    ],
  };
  let content = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
        continue;
      }
      return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    try {
      const env = JSON.parse(text);
      content = env.choices?.[0]?.message?.content || '';
      if (content.trim()) break;
      const reason = env.choices?.[0]?.finish_reason;
      if (attempt === 2) return { error: `empty content (finish=${reason})`, raw: text.slice(0, 200) };
    } catch {
      if (attempt === 2) return { error: `bad envelope: ${text.slice(0, 160)}` };
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  const m = content.match(/\{[\s\S]*\}/);
  const candidate = m ? m[0] : content.trim();
  const repair = (value) => {
    let out = value.trim();
    if (!out.startsWith('{')) return out;
    // 截断时补齐未闭合的字符串与括号（模型常在 max_tokens 处断掉）
    const quotes = out.split('"').length - 1;
    if (quotes % 2 === 1) out += '"';
    const opens = (out.match(/\{/g) || []).length;
    const closes = (out.match(/\}/g) || []).length;
    out += '}'.repeat(Math.max(0, opens - closes));
    return out;
  };
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(repair(candidate));
    } catch {
      return { error: `bad json: ${candidate.slice(0, 160)}`, raw: content };
    }
  }
}

const results = [];
for (let i = 0; i < items.length; i++) {
  const imgPath = path.join(imagesDir, `${i}.png`);
  if (!fs.existsSync(imgPath)) {
    results.push({ i, user: items[i].user, kind: items[i].figure?.kind, error: 'missing image' });
    continue;
  }
  const b64 = fs.readFileSync(imgPath).toString('base64');
  const verdict = await judge(items[i], b64);
  results.push({
    i,
    user: items[i].user,
    kind: items[i].figure?.kind || 'position-line',
    at: items[i].at,
    ...verdict,
  });
  const tag = verdict.verdict || verdict.error || '?';
  console.log(`[${i + 1}/${items.length}] ${items[i].user} ${items[i].figure?.kind || 'position-line'} → ${tag}`);
  await new Promise((r) => setTimeout(r, 1200));
}

const ok = results.filter((r) => !r.error);
const mean = (k) => (ok.length ? Math.round((ok.reduce((n, r) => n + (Number(r[k]) || 0), 0) / ok.length) * 100) / 100 : null);
const share = (pred) => (ok.length ? Math.round((ok.filter(pred).length / ok.length) * 100) : 0);

const summary = {
  label,
  generatedAt: new Date().toISOString(),
  model: MODEL,
  total: items.length,
  judged: ok.length,
  errors: results.filter((r) => r.error).length,
  verdicts: {
    keep: ok.filter((r) => r.verdict === 'keep').length,
    fix: ok.filter((r) => r.verdict === 'fix').length,
    drop: ok.filter((r) => r.verdict === 'drop').length,
  },
  meanUsefulness: mean('usefulness'),
  meanGeometry: mean('geometry'),
  meanReadability: mean('readability'),
  metaShare: share((r) => r.meta === true),
  leakShare: share((r) => r.leak === true),
  redundantShare: share((r) => r.redundant === true),
  byKind: Object.fromEntries(
    [...new Set(ok.map((r) => r.kind))].map((k) => {
      const rows = ok.filter((r) => r.kind === k);
      return [
        k,
        {
          n: rows.length,
          keep: rows.filter((r) => r.verdict === 'keep').length,
          drop: rows.filter((r) => r.verdict === 'drop').length,
          usefulness: Math.round((rows.reduce((n, r) => n + (Number(r.usefulness) || 0), 0) / rows.length) * 100) / 100,
        },
      ];
    }),
  ),
  results,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 1), 'utf8');
console.log(JSON.stringify({ label, total: summary.total, judged: summary.judged, verdicts: summary.verdicts, meanUsefulness: summary.meanUsefulness, meanGeometry: summary.meanGeometry, metaShare: summary.metaShare, leakShare: summary.leakShare, redundantShare: summary.redundantShare }, null, 1));
