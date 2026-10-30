// 概念可视化探针（直连通道）：平台额度用尽（402）时走 newapi 通道 key，只读文件、不落库、不打印。
// 用法：node outputs/e2e/concept-probe-direct.mjs <cases.json> <out.json> [attempts]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [casesPath, outPath, attemptsRaw] = process.argv.slice(2);
if (!casesPath || !outPath) throw new Error('用法: concept-probe-direct.mjs <cases.json> <out.json> [attempts]');
const attempts = Math.max(1, Number(attemptsRaw) || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyFile = process.env.WF_VISION_KEY_FILE || path.join(os.tmpdir(), 'wf-vis-key');
const KEY = fs.readFileSync(keyFile, 'utf8').trim();
const BASE = process.env.WF_VISION_BASE || 'https://newapi.wenflow.org/v1';
const MODEL = process.env.WF_PROBE_MODEL || 'deepseek-v4.1-flash';

const md = fs.readFileSync('prompts/skill.teaching-turn.md', 'utf8');
const systemPrompt = md.replace(/^---[\s\S]*?---\s*/, '');
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

const CONCEPT_INSTRUCTION = [
  '本轮是**概念讲解**（不是出题、不是练习）：把这个概念本身摆给学生看。',
  '画概念结构图：节点是概念要素（概念/过程/量/条件），边是**有名字的关系**（产生/供给/构成/依赖/导致/对照）。',
  '规则：① 不要在图上写「答案」或考点；② 每条边必须写关系名；③ 2~10 个节点，只保留解释这个概念必须出现的要素；',
  '④ 常见误解不要画进节点（别把错的说法当成概念的一部分）；⑤ 输出 figure.kind = "concept-map"。',
].join('\n');

async function callOnce(c) {
  const body = {
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: {
            title: c.taskTitle,
            description: c.taskDescription,
            taskType: 'explain',
            acceptanceCriteria: c.acceptance,
          },
          scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
          knowledge: { currentPoint: c.topic },
          messages: [{ role: 'user', content: c.student }],
          visualOpportunity: { suggested: true, reason: 'concept-exposition', kindHint: 'concept-map' },
          instruction: CONCEPT_INSTRUCTION,
        }),
      },
    ],
  };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const raw = json?.choices?.[0]?.message?.content ?? '';
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const slice = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  return JSON.parse(slice);
}

const results = [];
for (const c of cases) {
  let out = null;
  let lastErr = null;
  for (let i = 0; i < attempts && !out; i += 1) {
    try {
      out = await callOnce(c);
    } catch (err) {
      lastErr = String(err?.message || err);
      console.log(`[${c.id}] 第 ${i + 1} 次失败：${lastErr.slice(0, 120)}`);
      // 402 是渠道池里个别上游没钱、429 是上游限流：等一会换一个上游再试
      await sleep(4000 + i * 3000);
    }
  }
  const figure = out?.figure ?? null;
  results.push({
    id: c.id,
    subject: c.subject,
    topic: c.topic,
    taskTitle: c.taskTitle,
    student: c.student,
    expectKind: c.expectKind,
    emitted: !!figure,
    rawKind: figure?.kind ?? null,
    spec: figure?.spec ?? null,
    reply: String(out?.reply || '').slice(0, 900),
    error: lastErr,
  });
  console.log(`[${c.id}] → ${figure ? figure.kind : '无图'}${lastErr && !figure ? ' (' + lastErr.slice(0, 60) + ')' : ''}`);
}
fs.writeFileSync(outPath, JSON.stringify(results, null, 1), 'utf8');
console.log(`\n共 ${results.length} 例，出图 ${results.filter((r) => r.emitted).length}`);
