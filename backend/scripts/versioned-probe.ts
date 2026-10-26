/**
 * 版本化出图探针（今晚三版迭代共用）：真实 teaching-turn 提示词 + 真实图型路由 +
 * 线上同一条归一化路径，直连通道（平台额度 402 期间的既定通道），并发受控。
 *
 * 密钥不进仓库、不打印：从 WF_VISION_KEY_FILE 指向的文件读取。
 * 用法：npx ts-node --transpile-only scripts/versioned-probe.ts <cases.json> <out.json> [concurrency=3] [attempts=2]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [casesPath, outPath, concRaw, attemptsRaw] = process.argv.slice(2);
if (!casesPath || !outPath) throw new Error('用法: versioned-probe <cases.json> <out.json> [concurrency=3] [attempts=2]');
const CONCURRENCY = Math.max(1, Number(concRaw) || 3);
const ATTEMPTS = Math.max(1, Number(attemptsRaw) || 3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KEY = readFileSync(process.env.WF_VISION_KEY_FILE || join(tmpdir(), 'wf-vis-key'), 'utf8').trim();
const BASE = process.env.WF_VISION_BASE || 'https://newapi.wenflow.org/v1';
const MODEL = process.env.WF_PROBE_MODEL || 'deepseek-v4.1-flash';

const md = readFileSync(join(__dirname, '..', '..', 'prompts', 'skill.teaching-turn.md'), 'utf8');
const systemPrompt = md.replace(/^---[\s\S]*?---\s*/, '');
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));

import { buildVisualOpportunity, FIGURE_KIND_GUIDE } from '../src/services/ai-teaching/teaching-visual.service';
import { normalizeTeachingFigureForProbe } from '../src/skills/teaching-turn';

/** 带信号量的任务池：最多 CONCURRENCY 个在飞 */
async function pool<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return out;
}

async function callModel(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = {
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = json?.choices?.[0]?.message?.content ?? '';
  const text = String(raw).trim();
  // 模型常把 JSON 裹进 markdown（```json 块）或前面垫一句说明：先截代码块，再做括号配对提取
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start < 0) throw new Error(`no json in output: ${candidate.slice(0, 120)}`);
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (esc) { esc = false; continue; }
    if (ch === String.fromCharCode(92)) { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const slice = end > start ? candidate.slice(start, end + 1) : candidate.slice(start);
  return JSON.parse(slice) as Record<string, unknown>;
}

async function runCase(c: any): Promise<any> {
  // 真路由：KIND_RULES 扫 student+assistant 文本，命中的给 kindHint 与 instruction
  const history = [
    ...(c.assistant ? [{ role: 'assistant', content: c.assistant, timestamp: '2026-10-26T00:00:00.000Z' }] : []),
    { role: 'user', content: c.student, timestamp: '2026-10-26T00:01:00.000Z' },
  ];
  const opp = buildVisualOpportunity(history as any, c.taskTitle)
    // 探针的 history 只有一句讲解，cue 词表覆盖率天然低于线上多轮对话；
    // 线上等价形态是「编排层已判定本轮要出图」——补通用出图机会，kindHint 留空让模型自己选型，
    // 选错仍由归一化与图型白名单裁决。这与 engine 的 task-structure 强出图指令同构。
    ?? {
      suggested: true,
      reason: 'probe-exposition',
      kindHint: null,
      ruleWhy: '探针判定本轮为学生需要看图的讲解/纠错时机',
      matched: [],
      instruction:
        '本轮已由编排层判定为**出图时机**。**默认必须输出一张图**（reply 之后输出顶层块 `figure`）；'
        + '只有本轮正要布置「由学生自己画/填」的练习（答案泄漏）或内容确实没有任何空间/数值/指向关系时可以不出。'
        + '\n' + FIGURE_KIND_GUIDE,
    };
  const payload: Record<string, unknown> = {
    task: {
      title: c.taskTitle,
      description: c.taskDescription,
      taskType: c.taskType,
      acceptanceCriteria: c.acceptance,
    },
    scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
    knowledge: { currentPoint: c.topic },
    messages: [{ role: 'user', content: c.student }],
    visualOpportunity: opp,
    instruction: opp?.instruction,
  };
  let out: Record<string, unknown> | null = null;
  let lastErr: string | null = null;
  for (let i = 0; i < ATTEMPTS && !out; i += 1) {
    // 第 3 次起加码出图指令（模拟编排层在无图时的重试提示）：仍由同一提示词/归一化裁决
    if (i >= 2) {
      payload.instruction = `${String(payload.instruction ?? '')}
【编排层重试提示】上一轮没有配图；本轮已判定为学生需要看图的关键时机（讲解关系/对比正误/呈现结构），请输出 figure 字段。`;
    }
    try {
      out = await callModel(payload);
    } catch (err) {
      lastErr = String((err as Error)?.message || err);
      console.log(`[${c.id}] 第 ${i + 1} 次失败：${lastErr.slice(0, 100)}`);
      // 402/429 是渠道池个别上游没钱/限流：退避后换上游重试
      await sleep(4000 + i * 3000);
    }
  }
  const figureRaw = out?.figure ?? null;
  const norm = figureRaw ? normalizeTeachingFigureForProbe(figureRaw) : { figure: null, reason: 'model-emitted-none' };
  const reply = String(out?.reply || '');
  const row = {
    id: c.id,
    course: c.course,
    subject: c.subject,
    topic: c.topic,
    taskTitle: c.taskTitle,
    taskType: c.taskType,
    intent: c.intent ?? null,
    expectKind: c.expectKind ?? null,
    routedKind: opp?.kindHint ?? null,
    emitted: !!figureRaw,
    rawKind: (figureRaw as any)?.kind ?? null,
    normalizeReason: (norm as any).reason ?? null,
    // V4：归一化拒绝时把模型的原始 spec 带出来，离线能回答「为什么这张被拒」
    rawSpec: (norm as any).figure ? null : ((figureRaw as any)?.spec ?? null),
    figure: (norm as any).figure ?? null,
    user: c.student,
    context: { student: c.student, teacher: reply },
    reply,
    assistant: c.assistant ?? null,
    error: lastErr,
  };
  console.log(`[${c.id}] → ${row.figure ? row.figure.kind : '无图'}${row.normalizeReason ? ` (${row.normalizeReason})` : ''}`);
  return row;
}

(async () => {
  const started = Date.now();
  const rows = await pool(cases.map((c: any) => () => runCase(c)));
  const order = new Map(cases.map((c: any, i: number) => [c.id, i]));
  rows.sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  writeFileSync(outPath, JSON.stringify(rows, null, 1), 'utf8');
  const landed = rows.filter((r: any) => r.figure).length;
  console.log(`\n共 ${rows.length} 例，出图并归一化通过 ${landed} 张（并发 ${CONCURRENCY}，耗时 ${Math.round((Date.now() - started) / 1000)}s）→ ${outPath}`);
})();
