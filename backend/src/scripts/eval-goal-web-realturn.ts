/* eslint-disable no-console -- 一次性离线评测 CLI */
/* eslint-disable @typescript-eslint/no-explicit-any -- 上游 JSON 形状动态 */
/* eslint-disable @typescript-eslint/no-require-imports -- node:sqlite 只有 require 形态 */
/**
 * goal「最终提议轮」联网 vs 不联网 A/B（真实对话上下文）。
 *
 * 为什么不做逐轮回放：goal LLM 往往在**最后一轮**才产出 needsMaterial，逐轮回放时
 * 联网结果没有"下一轮"可用；而且两臂的对话轨迹会因随机性分叉，混入非联网因素。
 *
 * 本脚本固定同一段真实对话上下文（最后一条用户发言之前的所有 user/assistant 消息），
 * 让两臂只差一件事：
 *   A = 不联网
 *   B = 用真实 goal LLM 自己产出的 needsMaterial.queries 走平台 searchWeb + fetchWeb，
 *       把来源笔记注入最终提议轮
 * 然后由独立模型匿名比较最终 understanding / needsMaterial / 提议质量。
 *
 * 跑法：
 *   DEMO_LLM_KEY=... npx ts-node --transpile-only src/scripts/eval-goal-web-finalturn.ts --limit=10
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { loadPromptFile } from '../composers/prompt-files/loader';
import { buildGoalConversationUserPayload } from '../skills/goal-conversation';
import { extractStructuredPayload } from '../skills/goal-conversation/structured-validator';
import { searchWeb } from '../services/search';
import { fetchWeb } from '../services/fetch';

const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };

const OUT = path.resolve(__dirname, '..', '..', '..', 'doc', 'local', 'GOAL-WEB-REALTURN-2026-10-20');
const LLM_URL = process.env.DEMO_LLM_URL || 'http://101.43.146.102:30001/v1/chat/completions';
const LLM_KEY = process.env.DEMO_LLM_KEY || '';
const LLM_MODEL = process.env.DEMO_LLM_MODEL || 'deepseek-v4.1-flash';
const JUDGE_MODEL = process.env.DEMO_JUDGE_MODEL || 'agnes-3.0-flash';
const GOAL_SYSTEM_PROMPT = loadPromptFile('skill:goal-conversation')?.systemPrompt || '';
if (!GOAL_SYSTEM_PROMPT) throw new Error('goal system prompt 未加载');

/**
 * 真实「要方案」轮次的识别规则：只用用户自己的话，不用平台合成提问。
 * 选第一个命中的用户轮；没有命中的对话整段跳过。
 */
const PLAN_REQUEST_PATTERNS = [
  /怎么安排/,
  /帮我排/,
  /排一下/,
  /怎么学/,
  /从哪(开始|下手)/,
  /给(我|个)(方案|计划)/,
  /具体(怎么|如何)/,
  /第一步/,
  /先学什么/,
  /怎么练/,
  /怎么设置/,
];

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function normalizeNeedsMaterial(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return null;
}

function truncate(text: string, max: number): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

async function chat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  let lastMeta = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(LLM_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || LLM_MODEL,
        messages,
        temperature: options.temperature ?? 0.25,
        max_tokens: attempt === 0 ? (options.maxTokens ?? 3200) : Math.max(options.maxTokens ?? 3200, 8000),
        enable_thinking: false,
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(240000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    const content = String(json.choices?.[0]?.message?.content || '');
    if (content.trim()) return content;
    lastMeta = `finish=${json.choices?.[0]?.finish_reason}, reasoning=${String(
      json.choices?.[0]?.message?.reasoning_content || ''
    ).length}`;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`LLM 返回空 content（${lastMeta}）`);
}

function extractJson(content: string): any | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// 数据
// --------------------------------------------------------------------------

interface GoalCase {
  id: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  finalUser: string;
  planTurn: number;
  gold: {
    needsMaterial: boolean | null;
    block: string | null;
    realProblem: string | null;
    surfaceGoal: string | null;
    baseline: unknown;
    timeDimensions: unknown;
    successCriteria: unknown;
    goldQueries: string[];
  };
}

function loadGoals(limit: number): GoalCase[] {
  const db = new DatabaseSync('prisma/dev.db', { readOnly: true });
  const rows = db
    .prepare('SELECT id, collectedData FROM goal_conversations WHERE collectedData IS NOT NULL ORDER BY createdAt DESC')
    .all() as Array<{ id: string; collectedData: string }>;
  const out: GoalCase[] = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    let collected: any;
    try {
      collected = JSON.parse(row.collectedData);
    } catch {
      continue;
    }
    const messages = Array.isArray(collected.messages) ? collected.messages : [];
    const normalized = messages
      .filter((m: any) => (m?.role === 'user' || m?.role === 'ai') && String(m.content || '').trim())
      .map((m: any) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: String(m.content) }));
    // 只取**用户自己真的在要方案/问怎么安排**的那一轮；不用平台话术合成提问。
    const planIndex = normalized.findIndex(
      (m) => m.role === 'user' && PLAN_REQUEST_PATTERNS.some((pattern) => pattern.test(m.content))
    );
    if (planIndex < 0) continue;
    const understanding = collected.understanding || {};
    const goldQueries = Array.isArray(understanding.needsMaterial?.queries)
      ? understanding.needsMaterial.queries.map((q: unknown) => String(q || '').trim()).filter(Boolean)
      : [];
    out.push({
      id: row.id,
      history: normalized.slice(0, planIndex),
      finalUser: normalized[planIndex].content,
      planTurn: planIndex + 1,
      gold: {
        needsMaterial: normalizeNeedsMaterial(understanding.needsMaterial),
        block: understanding.primary_block_type || null,
        realProblem: understanding.real_problem || null,
        surfaceGoal: understanding.surface_goal || null,
        baseline: understanding.current_baseline || null,
        timeDimensions: understanding.time_dimensions || null,
        successCriteria: understanding.success_criteria || null,
        goldQueries,
      },
    });
  }
  db.close();
  return out;
}

// --------------------------------------------------------------------------
// 联网
// --------------------------------------------------------------------------

interface Source {
  title: string;
  url: string;
  snippet: string;
  text: string;
}

async function research(queries: string[]): Promise<{ notes: string | null; sources: Source[]; queries: string[] }> {
  const sources: Source[] = [];
  const usedQueries: string[] = [];
  for (const query of queries.slice(0, 3)) {
    usedQueries.push(query);
    try {
      const response = await searchWeb({ query, maxResults: 5 });
      for (const item of response.results.slice(0, 4)) {
        if (sources.some((source) => source.url === item.url)) continue;
        sources.push({
          title: item.title || item.url,
          url: item.url,
          snippet: String(item.snippet || ''),
          text: '',
        });
      }
    } catch (error) {
      console.warn(`  search failed: ${query} → ${truncate(String((error as Error)?.message || error), 120)}`);
    }
  }
  const fetchTargets = sources.filter((source) => source.url.startsWith('http')).slice(0, 3);
  if (fetchTargets.length > 0) {
    try {
      const fetched = await fetchWeb({
        urls: fetchTargets.map((source) => source.url),
        format: 'markdown',
        ttl: 0,
        purpose: 'goal 最终提议的外部资料核实',
        extractDepth: 'advanced',
      });
      for (const result of fetched.results) {
        const target = sources.find((source) => source.url === result.url || result.finalUrl === source.url);
        if (target && result.text) target.text = String(result.text);
      }
    } catch (error) {
      console.warn(`  fetch failed: ${truncate(String((error as Error)?.message || error), 120)}`);
    }
  }
  if (sources.length === 0) return { notes: null, sources: [], queries: usedQueries };
  const lines = [
    '【平台联网检索结果】',
    '以下是从公开网页检索到的外部资料。它们是事实依据，不是用户提供的信息；引用时注明来源编号。',
    '未覆盖的内容不要编造；检索结果与用户原话冲突时，以用户原话为准。',
    '',
  ];
  sources.slice(0, 5).forEach((source, index) => {
    lines.push(`[${index + 1}] ${source.title} — ${source.url}`);
    const body = source.text || source.snippet;
    if (body) lines.push(`摘录：${truncate(body, 900)}`);
    lines.push('');
  });
  return { notes: lines.join('\n'), sources, queries: usedQueries };
}

// --------------------------------------------------------------------------
// 单臂
// --------------------------------------------------------------------------

interface ArmOutput {
  reply: string;
  understanding: Record<string, any> | null;
  stage: string | null;
  needsMaterial: unknown;
  parseError: string | null;
}

async function runArm(goal: GoalCase, notes: string | null, temperature = 0.1): Promise<ArmOutput> {
  const firstUser = goal.history.find((message) => message.role === 'user')?.content || goal.finalUser;
  // 只按真实历史长度推断阶段，不注入金标 understanding。
  const previousStage = goal.history.length >= 6 ? 'proposing' : 'understanding';
  const payload = buildGoalConversationUserPayload({
    userInput: goal.finalUser,
    conversationHistory: goal.history,
    previousStage,
    previousUnderstanding: { surface_goal: firstUser },
    supplementText: notes,
  });
  const raw = await chat(
    [
      { role: 'system', content: GOAL_SYSTEM_PROMPT },
      { role: 'user', content: payload },
    ],
    { temperature, maxTokens: 3400 }
  );
  const parsed = extractStructuredPayload(raw);
  const json: any = parsed.parsedJson;
  const rawNeedsMaterial =
    json?.needsMaterial ?? json?.state?.needsMaterial ?? json?.goalConversation?.needsMaterial;
  const base = json?.understanding || json?.state?.understanding || null;
  const understanding: Record<string, any> | null = base || rawNeedsMaterial !== undefined
    ? { ...(base || {}), ...(rawNeedsMaterial !== undefined ? { needsMaterial: rawNeedsMaterial } : {}) }
    : null;
  return {
    reply: String(json?.reply || parsed.dialogueText || '').trim(),
    understanding,
    stage: json?.state?.stage ? String(json.state.stage) : null,
    needsMaterial: rawNeedsMaterial ?? understanding?.needsMaterial ?? null,
    parseError: parsed.parseError || (json ? null : 'no_json'),
  };
}

// --------------------------------------------------------------------------
// 裁判
// --------------------------------------------------------------------------

interface JudgeResult {
  scores: Record<string, { understanding: number; needs_material: number; grounding: number; scope: number; overall: number }>;
  best: string;
  why: string;
}

function compact(output: ArmOutput): string {
  const u = output.understanding || {};
  return [
    `最后一轮回复：${output.reply || '(空)'}`,
    `最终理解：${JSON.stringify(
      {
        surface_goal: u.surface_goal,
        real_problem: u.real_problem,
        primary_block_type: u.primary_block_type,
        current_baseline: u.current_baseline,
        time_dimensions: u.time_dimensions,
        success_criteria: u.success_criteria,
        needsMaterial: u.needsMaterial,
        confirmedProposal: u.confirmedProposal,
      },
      null,
      0
    )}`,
  ].join('\n');
}

async function judge(goal: GoalCase, a: ArmOutput, b: ArmOutput): Promise<JudgeResult> {
  const shift = goal.id.length % 2;
  const order: Array<['A' | 'B', string]> = shift === 0 ? [['A', 'X'], ['B', 'Y']] : [['B', 'X'], ['A', 'Y']];
  const labelToArm: Record<string, 'A' | 'B'> = {};
  const blocks = order.map(([arm, label]) => {
    labelToArm[label] = arm;
    return `### 回复 ${label}\n${compact(arm === 'A' ? a : b)}`;
  });
  const prompt = [
    '你是独立评审。下面是一个学习者的真实目标对话（按时间顺序）和这一轮用户真实发言，以及两个匿名系统给出的回复与理解。',
    '只评内容质量，不评格式/长度/JSON 结构。按 1-5 打分（5 最好）：',
    '- understanding：是否抓住真实问题、约束、起点（尤其 current_baseline 是否有依据而不是默认 beginner）',
    '- needs_material：如果需要外部资料，是否给出了具体、可检索的对象（名称/地区/年份/文件类型）；如果不需要，是否明确没有乱加',
    '- grounding：外部事实是否可核验、有无编造；不确定的是否明说',
    '- scope：时间、范围、验收标准是否与用户约束一致',
    '- overall：综合',
    '最后选一个更好的（允许 tie）。只输出一个 JSON 对象，不要解释。',
    '格式：{"scores":{"X":{"understanding":0,"needs_material":0,"grounding":0,"scope":0,"overall":0},"Y":{...}},"best":"X|Y|tie","why":"一句话"}',
    '',
    '对话：',
    ...goal.history.map((message) => `${message.role === 'user' ? '用户' : '系统'}：${message.content}`),
    `用户：${goal.finalUser}`,
    '',
    ...blocks,
  ].join('\n');
  const raw = await chat([{ role: 'user', content: prompt }], {
    model: JUDGE_MODEL,
    temperature: 0.1,
    maxTokens: 1000,
  });
  const parsed = extractJson(raw) || { scores: {}, best: 'tie', why: raw.slice(0, 160) };
  const scores: JudgeResult['scores'] = {};
  for (const [label, score] of Object.entries(parsed.scores || {})) {
    const arm = labelToArm[label];
    if (arm) scores[arm] = score as any;
  }
  const bestKey = String(parsed.best || 'tie').trim();
  return { scores, best: labelToArm[bestKey] || bestKey || 'tie', why: String(parsed.why || '') };
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

interface CaseResult {
  caseId: string;
  historyTurns: number;
  planTurn: number;
  finalUser: string;
  gold: GoalCase['gold'];
  probe: ArmOutput;
  querySource: 'model' | 'gold' | 'none';
  webApplied: boolean;
  research: { queries: string[]; sources: Array<{ title: string; url: string }> };
  A: ArmOutput;
  B: ArmOutput;
  judge: JudgeResult;
  error: string | null;
}

function extractQueries(needsMaterial: unknown): string[] {
  const value: any = needsMaterial;
  if (!value || typeof value !== 'object') return [];
  const queries = Array.isArray(value.queries) ? value.queries : [];
  return queries.map((query: unknown) => String(query || '').trim()).filter(Boolean).slice(0, 3);
}

async function main() {
  const limit = Math.max(1, Number(arg('limit', '10')));
  const goals = loadGoals(limit);
  fs.mkdirSync(OUT, { recursive: true });
  const outFile = path.join(OUT, 'results.jsonl');
  fs.writeFileSync(outFile, '', 'utf-8');
  console.log(`final-turn eval goals=${goals.length} model=${LLM_MODEL} judge=${JUDGE_MODEL}`);

  for (const [index, goal] of goals.entries()) {
    console.log(
      `\n[${index + 1}/${goals.length}] ${goal.id} planTurn=${goal.planTurn} history=${goal.history.length} gold.nm=${goal.gold.needsMaterial} gold.q=${goal.gold.goldQueries.length}`
    );
    let result: CaseResult;
    try {
      // 共享第一次提议：用模型自己的 needsMaterial.queries 决定检索词（不把金标喂给 B）。
      const probe = await runArm(goal, null, 0.25);
      const modelQueries = extractQueries(probe.needsMaterial);
      const queries = modelQueries.length > 0 ? modelQueries : goal.gold.goldQueries;
      const querySource: 'model' | 'gold' | 'none' =
        modelQueries.length > 0 ? 'model' : goal.gold.goldQueries.length > 0 ? 'gold' : 'none';
      const researchResult = await research(queries);
      const webApplied = Boolean(researchResult.notes);
      // 第二次提议：A 无笔记；B 同 prompt + 笔记（温度 0.1，尽量只差笔记）。
      // 没有检索结果时 B 直接复用 A，避免把两次随机采样当成联网效果。
      const a = await runArm(goal, null, 0.1);
      const b = webApplied ? await runArm(goal, researchResult.notes, 0.1) : a;
      const judged = webApplied
        ? await judge(goal, a, b)
        : { scores: {}, best: 'n/a' as const, why: 'no research applied' };
      result = {
        caseId: goal.id,
        historyTurns: goal.history.length,
        planTurn: goal.planTurn,
        finalUser: goal.finalUser,
        gold: goal.gold,
        probe,
        querySource,
        webApplied,
        research: { queries: researchResult.queries, sources: researchResult.sources.map((s) => ({ title: s.title, url: s.url })) },
        A: a,
        B: b,
        judge: judged,
        error: null,
      };
      console.log(
        `  nm: A=${normalizeNeedsMaterial(a.needsMaterial)} B=${normalizeNeedsMaterial(b.needsMaterial)} gold=${goal.gold.needsMaterial} | overall A=${judged.scores.A?.overall ?? 'n/a'} B=${judged.scores.B?.overall ?? 'n/a'} best=${judged.best}`
      );
      console.log(`  querySource=${querySource} sources=${result.research.sources.length} | why: ${judged.why.slice(0, 120)}`);
    } catch (error) {
      result = {
        caseId: goal.id,
        historyTurns: goal.history.length,
        planTurn: goal.planTurn,
        finalUser: goal.finalUser,
        gold: goal.gold,
        probe: {} as any,
        querySource: 'none',
        webApplied: false,
        research: { queries: [], sources: [] },
        A: {} as any,
        B: {} as any,
        judge: { scores: {}, best: 'n/a', why: '' },
        error: String((error as Error)?.message || error).slice(0, 400),
      };
      console.log(`  ERROR: ${result.error}`);
    }
    fs.appendFileSync(outFile, `${JSON.stringify(result)}\n`, 'utf-8');
  }

  const results = fs
    .readFileSync(outFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CaseResult);
  const valid = results.filter((item) => !item.error);
  // A/B 均分只统计「联网真的生效」的案例；无检索结果时 B=A，计入会制造噪声。
  const webCases = valid.filter((item) => item.webApplied);
  const metrics = ['understanding', 'needs_material', 'grounding', 'scope', 'overall'] as const;
  const avg = (arm: 'A' | 'B', metric: (typeof metrics)[number]) => {
    const values = webCases.map((item) => Number(item.judge.scores[arm]?.[metric])).filter(Number.isFinite);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const best = { A: 0, B: 0, tie: 0 };
  for (const item of webCases) {
    if (item.judge.best === 'A') best.A += 1;
    else if (item.judge.best === 'B') best.B += 1;
    else best.tie += 1;
  }
  const nm = {
    A: valid.filter((item) => normalizeNeedsMaterial(item.A.needsMaterial) === true).length,
    B: valid.filter((item) => normalizeNeedsMaterial(item.B.needsMaterial) === true).length,
    gold: valid.filter((item) => item.gold.needsMaterial === true).length,
    n: valid.length,
  };
  const summary = {
    n: valid.length,
    webApplied: webCases.length,
    errors: results.length - valid.length,
    averages: Object.fromEntries(['A', 'B'].map((arm) => [arm, Object.fromEntries(metrics.map((m) => [m, avg(arm as any, m)]))])),
    best,
    needsMaterial: nm,
    research: {
      queries: valid.reduce((sum, item) => sum + item.research.queries.length, 0),
      sources: valid.reduce((sum, item) => sum + item.research.sources.length, 0),
      querySources: {
        model: valid.filter((item) => item.querySource === 'model').length,
        gold: valid.filter((item) => item.querySource === 'gold').length,
        none: valid.filter((item) => item.querySource === 'none').length,
      },
    },
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  const lines = [
    '# goal 真实「要方案」轮「联网 vs 不联网」A/B — 2026-10-20',
    '',
    `样本：${valid.length} 段真实目标对话，取**用户自己问“怎么安排/怎么学/从哪开始”**的真实轮次；没有命中该模式的目标跳过。`,
    `其中 ${summary.webApplied} 段实际触发了检索并进入 A/B 均分。`,
    `生成 ${LLM_MODEL}，裁判 ${JUDGE_MODEL}。`,
    '**查询来源的诚实说明**：B 的检索词来自这段真实对话里 goal LLM 已经产出的 `needsMaterial.queries`（记录值），',
    '不是本轮在真实用户发言上重新生成的。因此这是一个**条件测试**：在需求/查询已经识别的前提下，检索证据是否改善回复；',
    '它不证明「模型能从这一句真实发言里自己识别资料需求」。querySource=model 的案例才同时覆盖识别；querySource=gold 的只覆盖检索效果。',
    '无检索结果的案例 B=A，不计入 A/B 均分（避免把两次随机采样当成联网效果）。',
    '本轮没有使用任何合成提问——输入就是用户原话。',
    '',
    '## 汇总',
    '',
    '| 指标 | A 不联网 | B 联网 |',
    '|---|---|---|',
    ...metrics.map((m) => {
      const a = summary.averages.A[m];
      const b = summary.averages.B[m];
      return `| ${m} | ${a === null ? 'n/a' : a.toFixed(2)} | ${b === null ? 'n/a' : b.toFixed(2)} |`;
    }),
    '',
    `裁判首选：A=${best.A}，B=${best.B}，tie=${best.tie}`,
    `needsMaterial=true：A ${nm.A}/${nm.n}，B ${nm.B}/${nm.n}，金标 ${nm.gold}/${nm.n}`,
    `检索：${summary.research.queries} 条查询，${summary.research.sources} 条来源；查询来源 model=${summary.research.querySources.model} / gold兜底=${summary.research.querySources.gold} / none=${summary.research.querySources.none}`,
    '',
    '## 逐例',
    '',
    ...valid.map((item, index) => [
      `### ${index + 1}. ${item.caseId}`,
      `- 第 ${item.planTurn} 轮真实用户发言（前文 ${item.historyTurns} 条）：${item.finalUser.slice(0, 100)}…`,
      `- 金标：nm=${item.gold.needsMaterial}，block=${item.gold.block}，queries=${item.gold.goldQueries.length}`,
      `- 查询来源：${item.querySource}；检索 ${item.research.queries.length} 条；联网生效：${item.webApplied}`,
      `- A：overall ${item.judge.scores.A?.overall ?? 'n/a'} / nm=${normalizeNeedsMaterial(item.A.needsMaterial)}`,
      `- B：overall ${item.judge.scores.B?.overall ?? 'n/a'} / nm=${normalizeNeedsMaterial(item.B.needsMaterial)}；来源 ${item.research.sources.length}`,
      `- 裁判首选：${item.judge.best}；理由：${item.judge.why}`,
      '',
    ].join('\n')),
  ];
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), lines.join('\n'), 'utf-8');
  console.log(`\nDONE ${path.join(OUT, 'REPORT.md')}`);
}

main().catch((error) => {
  console.error('[finalturn] failed:', error);
  process.exitCode = 1;
});
