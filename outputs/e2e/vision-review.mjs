// 外部视觉评审：把每张图（PNG）连同它所在的教学上下文交给视觉模型，按固定判据打分。
//
// 两套判据（第 5 个参数）：
//   leak（默认）  2026-10-26 口径：把「图里写全了答案」一律当泄题——这个口径把白板逼成了做题区
//   load          2026-10-27 口径：白板的本职是替文字减负，判「减负度 / 自明性」，
//                只有**板面把老师这一轮要学生自己说的那句话直接写出来**才算结论前置
//
// 密钥不进仓库：从 WF_VISION_KEY_FILE 指向的文件读取（默认系统临时目录）。
// 用法：node outputs/e2e/vision-review.mjs <items.json> <imagesDir> <out.json> [roundLabel] [rubric=leak|load]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [itemsPath, imagesDir, outPath, label = 'round', rubricArg = 'leak'] = process.argv.slice(2);
if (!itemsPath || !imagesDir || !outPath) {
  console.error('用法：node vision-review.mjs <items.json> <imagesDir> <out.json> [label] [rubric=leak|load]');
  process.exit(1);
}
const RUBRIC = rubricArg === 'load' ? 'load' : 'leak';

const keyFile = process.env.WF_VISION_KEY_FILE || path.join(os.tmpdir(), 'wf-vis-key');
const KEY = fs.readFileSync(keyFile, 'utf8').trim();
const BASE = process.env.WF_VISION_BASE || 'https://newapi.wenflow.org/v1';
const MODEL = process.env.WF_VISION_MODEL || 'deepseek-v4.1-flash';

const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));

const RUBRICS = {
  leak: {
    system: `你是一位严格的教学视觉评审，负责判断课堂里下发给学生的示意图是否真的有用。
你不看渲染代码，只看学生看到的东西：图 + 它出现时的那一轮对话。请毫不留情，宁可判"删"也不要客套。`,
    prompt: (it) => `下面是课堂上的一轮对话和紧随其后下发的一张图。
【学生上一句】${(it.context?.student || '（无）').slice(0, 600)}
【老师这一轮】${(it.context?.teacher || '（无）').slice(0, 1200)}
【图型】${it.figure?.kind || 'position-line'}
【图里的文字】（供你核对是否读得全）${JSON.stringify(it.figure?.spec || {}, null, 0).slice(0, 1500)}

请只输出一个 JSON 对象，不要解释、不要 markdown 代码块，字段如下：
{
 "usefulness": 0-3,          // 这张图是否在回答"学生这一刻需要看见什么"；0=纯装饰，3=没有它学生就难懂
 "geometry": 0-3,            // 图里的位置/数值/连线/包含是否承载了学科关系；0=只是把句子装进框，3=几何本身在推理
 "meta": true|false,         // 是否出现做题步骤指令、自查清单、批改评语这类元认知话术（而不是学科实体）。注意：图里留 "?" 空槽/虚线待填格**不算 meta**
 "leak": true|false,         // 老师这一轮让学生自己产出某内容，而图里已经把完整答案给出
 "readability": 0-3,         // 文字是否读得全、有没有半截句/错位/压字/看不懂的缩写
 "redundant": true|false,    // 伪视觉判定：把图里全部文字改写成正文句子，学生**会损失什么**？损失空间关系/数值对比/形态差异/并排对照中的对应结构 → false；毫无损失、方框只是给句子加边框 → true
 "verdict": "keep"|"fix"|"drop",
 "oneLine": "一句话说这张图到底在讲什么",
 "worstIssue": "最该修的一处（没有就写 none）"
}`,
  },

  /**
   * 减负口径（2026-10-27 用户定调）：白板不是做题区。
   * 「把材料画全」在这里是加分，不再是泄题；唯一的红灯是**替学生把话说出来**。
   */
  load: {
    system: `你是一位严格的教学视觉评审。这个课堂里的白板**不是做题区**——它的职责是把多步对比、
多变量结构、长背景材料一次摊开，替学生的纯文字工作记忆减负（把复杂信息外化，学生不用在脑子里
同时转六个数或想象两个烧杯）。所以「板面信息完整」是它的本职工作，不是泄题。
你不看渲染代码，只看学生看到的东西：图 + 它出现时的那一轮对话。请严格，但不要用「信息太多」当缺点。

输出格式：**只输出一个 JSON 对象**——不要写推理过程、不要开场白、不要 markdown 围栏；
第一个字符必须是 {，最后一个字符必须是 }。所有判断在心里完成。`,
    prompt: (it) => `下面是课堂上的一轮对话和紧随其后下发的一张白板。
【学生上一句】${(it.context?.student || '（无）').slice(0, 600)}
【老师这一轮】${(it.context?.teacher || '（无）').slice(0, 1200)}
【图型】${it.figure?.kind || 'position-line'}
【板上的文字】${JSON.stringify(it.figure?.spec || {}, null, 0).slice(0, 1500)}

请只输出一个 JSON 对象，不要解释、不要 markdown 代码块，字段如下：
{
 "relief": 0-3,        // 减负度：这张板是否替纯文字分担了复杂信息（多步对比 / 多变量关系 / 时间线 / 长背景）。
                      //   0=没有分担，学生看文字更快；3=看了这张板就不必在脑子里同时压着这些量或关系
 "selfExplain": 0-3,   // 自明性：不读老师的解释、只扫这张板，学生是否就能看懂「这里在比什么、差在哪」。
                      //   0=满屏问号/空壳，必须靠猜；3=扫一眼就明白
 "preAnswer": true|false, // 结论前置：板面的**标题、帧名、节点名或结论句**是否把老师这一轮要学生自己
                      //   说出的那句话直接写了出来（例如老师问「他先想拿到什么」，标题写着「先取信」）。
                      //   注意：把材料、数据、步骤、单位、副标注画全**不算** preAnswer——那是减负；
                      //   只有「替学生把结论说出来」才算
 "meta": true|false,   // 是否出现做题步骤指令、自查清单、批改评语这类元认知话术（而不是学科实体）
 "readability": 0-3,   // 文字是否读得全、有没有半截句/错位/压字/越界
 "verdict": "keep"|"fix"|"drop",
 "oneLine": "一句话说这张板在替学生扛住什么",
 "worstIssue": "最该修的一处（没有就写 none）"
}`,
  },
};

const SYSTEM = RUBRICS[RUBRIC].system;
const rubric = RUBRICS[RUBRIC].prompt;

function parseVerdict(content) {
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
      return null;
    }
  }
}

async function judge(it, imgB64) {
  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: rubric(it) },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imgB64}` } },
      ],
    },
  ];
  let lastRaw = '';
  // 模型会间歇性地把推理写进正文（判据未变，只是输出格式不听话）：
  // 拿着它的上一段话明确要求「只输出 JSON」再要一次，而不是把这条样本丢掉。
  for (let round = 0; round < 3; round++) {
    let content = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = { model: MODEL, temperature: 0, max_tokens: 2400, messages };
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
    const verdict = parseVerdict(content);
    if (verdict) return verdict;
    lastRaw = content;
    messages.push({ role: 'assistant', content: content.slice(0, 2000) || '(空)' });
    messages.push({
      role: 'user',
      content: '上一个回复不是可解析的 JSON。请只输出一个 JSON 对象：第一个字符必须是 {、最后一个字符必须是 }，不要解释、不要围栏。',
    });
  }
  return { error: `bad json: ${String(lastRaw).slice(0, 160)}`, raw: lastRaw };
}

// 并发受控（用户 2026-10-26 定：全程 3 并发）：信号量池，最多 3 个评审同时在飞
const CONC = Number(process.env.VISION_CONC || 3);
const results = [];
let cursor = 0;
const runOne = async (i) => {
  const imgPath = path.join(imagesDir, `${i}.png`);
  if (!fs.existsSync(imgPath)) {
    results.push({ i, user: items[i].user, kind: items[i].figure?.kind, error: 'missing image' });
    return;
  }
  const b64 = fs.readFileSync(imgPath).toString('base64');
  let verdict;
  try {
    verdict = await judge(items[i], b64);
  } catch (err) {
    verdict = { error: `network: ${String(err?.cause?.code || err?.message || err).slice(0, 80)}` };
  }
  results.push({
    i,
    user: items[i].user,
    kind: items[i].figure?.kind || 'position-line',
    at: items[i].at,
    ...verdict,
  });
  const tag = verdict.verdict || verdict.error || '?';
  console.log(`[${i + 1}/${items.length}] ${items[i].user} ${items[i].figure?.kind || 'position-line'} → ${tag}`);
};
await Promise.all(
  Array.from({ length: Math.min(CONC, items.length) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      await runOne(i);
    }
  }),
);
results.sort((a, b) => a.i - b.i);

const ok = results.filter((r) => !r.error);
const mean = (k) => (ok.length ? Math.round((ok.reduce((n, r) => n + (Number(r[k]) || 0), 0) / ok.length) * 100) / 100 : null);
const share = (pred) => (ok.length ? Math.round((ok.filter(pred).length / ok.length) * 100) : 0);

const summary = {
  label,
  rubric: RUBRIC,
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
  // leak 口径的字段
  meanUsefulness: mean('usefulness'),
  meanGeometry: mean('geometry'),
  leakShare: share((r) => r.leak === true),
  redundantShare: share((r) => r.redundant === true),
  // load 口径的字段（白板=减负区）
  meanRelief: mean('relief'),
  meanSelfExplain: mean('selfExplain'),
  preAnswerShare: share((r) => r.preAnswer === true),
  meanReadability: mean('readability'),
  metaShare: share((r) => r.meta === true),
  byKind: Object.fromEntries(
    [...new Set(ok.map((r) => r.kind))].map((k) => {
      const rows = ok.filter((r) => r.kind === k);
      const metric = RUBRIC === 'load' ? 'relief' : 'usefulness';
      return [
        k,
        {
          n: rows.length,
          keep: rows.filter((r) => r.verdict === 'keep').length,
          drop: rows.filter((r) => r.verdict === 'drop').length,
          [metric]: Math.round((rows.reduce((n, r) => n + (Number(r[metric]) || 0), 0) / rows.length) * 100) / 100,
        },
      ];
    }),
  ),
  results,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 1), 'utf8');
const headline =
  RUBRIC === 'load'
    ? {
        label, rubric: RUBRIC, total: summary.total, judged: summary.judged, verdicts: summary.verdicts,
        meanRelief: summary.meanRelief, meanSelfExplain: summary.meanSelfExplain,
        preAnswerShare: summary.preAnswerShare, metaShare: summary.metaShare,
      }
    : {
        label, rubric: RUBRIC, total: summary.total, judged: summary.judged, verdicts: summary.verdicts,
        meanUsefulness: summary.meanUsefulness, meanGeometry: summary.meanGeometry,
        metaShare: summary.metaShare, leakShare: summary.leakShare, redundantShare: summary.redundantShare,
      };
console.log(JSON.stringify(headline, null, 1));
