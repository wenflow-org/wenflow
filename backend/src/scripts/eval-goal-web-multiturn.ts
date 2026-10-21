/* eslint-disable no-console -- 一次性离线评测 CLI */
/* eslint-disable @typescript-eslint/no-explicit-any -- 上游 JSON 形状动态 */
/* eslint-disable @typescript-eslint/no-require-imports -- node:sqlite 只有 require 形态 */
/**
 * goal 阶段「联网 vs 不联网」多回合真实回放。
 *
 * 与 demo-goal-web-research.ts 的区别：
 *  - 不是只跑第一轮，而是用 goal_conversations 里**真实用户发言**逐轮驱动；
 *  - 联网臂 B 只在模型自己产出 `understanding.needsMaterial.queries` 后才检索，
 *    检索结果注入**下一轮** user payload（模拟生产：goal LLM 出查询 → 平台检索 → 下一轮可用）；
 *  - 用平台正式链 `searchWeb` + `fetchWeb`，不再走百度/Bing 兜底；
 *  - 最终比较两臂的 understanding / needsMaterial / 提议质量，由独立模型匿名裁判。
 *
 * 跑法：
 *   DEMO_LLM_KEY=... npx ts-node --transpile-only src/scripts/eval-goal-web-multiturn.ts --limit=8 --max-turns=6
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

const OUT = path.resolve(__dirname, '..', '..', '..', 'doc', 'local', 'GOAL-WEB-EVAL-2026-10-20');
const LLM_URL = process.env.DEMO_LLM_URL || 'http://101.43.146.102:30001/v1/chat/completions';
const LLM_KEY = process.env.DEMO_LLM_KEY || '';
const LLM_MODEL = process.env.DEMO_LLM_MODEL || 'deepseek-v4.1-flash';
const JUDGE_MODEL = process.env.DEMO_JUDGE_MODEL || 'agnes-3.0-flash';
const GOAL_SYSTEM_PROMPT = loadPromptFile('skill:goal-conversation')?.systemPrompt || '';
if (!GOAL_SYSTEM_PROMPT) throw new Error('goal system prompt 未加载');

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
        temperature: options.temperature ?? 0.3,
        max_tokens: attempt === 0 ? (options.maxTokens ?? 3000) : Math.max(options.maxTokens ?? 3000, 8000),
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
  firstUser: string;
  userMessages: string[];
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
    const userMessages = messages
      .filter((m: any) => m?.role === 'user' && String(m.content || '').trim().length >= 10)
      .map((m: any) => String(m.content));
    if (userMessages.length < 2) continue;
    const understanding = collected.understanding || {};
    const goldQueries = Array.isArray(understanding.needsMaterial?.queries)
      ? understanding.needsMaterial.queries.map((q: unknown) => String(q || '').trim()).filter(Boolean)
      : [];
    out.push({
      id: row.id,
      firstUser: userMessages[0],
      userMessages,
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

/** 12 轮的长会话取「开头 2 轮 + 结尾 4 轮」，保证目标与最终确认都在；短会话全用。 */
function selectTurns(messages: string[], maxTurns: number): string[] {
  if (messages.length <= maxTurns) return messages;
  const head = messages.slice(0, Math.min(2, maxTurns));
  const tailCount = maxTurns - head.length;
  // slice(-0) 会返回整个数组（JS 的 -0 === 0），tailCount=0 时必须显式返回空。
  const tail = tailCount > 0 ? messages.slice(-tailCount) : [];
  return [...head, ...tail];
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

interface ResearchState {
  queries: string[];
  sources: Source[];
  notes: string | null;
  searchedQueries: Set<string>;
}

function newResearchState(): ResearchState {
  return { queries: [], sources: [], notes: null, searchedQueries: new Set() };
}

function buildNotes(sources: Source[]): string {
  if (sources.length === 0) return '';
  const lines = [
    '【平台联网检索结果】',
    '以下是从公开网页检索到的外部资料。它们是事实依据，不是用户提供的信息；引用时注明来源编号。',
    '未覆盖的内容不要编造；检索结果与用户原话冲突时，以用户原话为准。',
    '',
  ];
  sources.slice(0, 4).forEach((source, index) => {
    lines.push(`[${index + 1}] ${source.title} — ${source.url}`);
    const body = source.text || source.snippet;
    if (body) lines.push(`摘录：${truncate(body, 900)}`);
    lines.push('');
  });
  return lines.join('\n');
}

async function research(queries: string[], state: ResearchState): Promise<void> {
  const fresh = queries
    .map((q) => q.trim())
    .filter((q) => q.length >= 3 && !state.searchedQueries.has(q))
    .slice(0, 2);
  if (fresh.length === 0) return;
  for (const query of fresh) {
    state.searchedQueries.add(query);
    state.queries.push(query);
    try {
      const response = await searchWeb({ query, maxResults: 5 });
      const top = response.results.slice(0, 4);
      for (const item of top) {
        if (state.sources.some((source) => source.url === item.url)) continue;
        state.sources.push({
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
  // 抓尚未抓过正文的前两条
  const needFetch = state.sources.filter((source) => !source.text && source.url.startsWith('http')).slice(0, 2);
  if (needFetch.length > 0) {
    try {
      const fetched = await fetchWeb({
        urls: needFetch.map((source) => source.url),
        format: 'markdown',
        ttl: 0,
        purpose: 'goal 阶段外部资料核实',
        extractDepth: 'advanced',
      });
      for (const result of fetched.results) {
        const target = state.sources.find((source) => source.url === result.url || result.finalUrl === source.url);
        if (target && result.text) target.text = String(result.text);
      }
    } catch (error) {
      console.warn(`  fetch failed: ${truncate(String((error as Error)?.message || error), 120)}`);
    }
  }
  state.notes = buildNotes(state.sources);
}

// --------------------------------------------------------------------------
// 单臂多回合
// --------------------------------------------------------------------------

interface TurnRecord {
  turn: number;
  user: string;
  reply: string;
  stage: string | null;
  understanding: Record<string, unknown> | null;
  needsMaterial: unknown;
  parseError: string | null;
  researchUsed: boolean;
  queries: string[];
}

interface ArmResult {
  turns: TurnRecord[];
  finalUnderstanding: Record<string, unknown> | null;
  finalStage: string | null;
  finalNeedsMaterial: boolean | null;
  research: ResearchState;
  latencyMs: number;
}

async function runArm(
  goal: GoalCase,
  userMessages: string[],
  withWeb: boolean
): Promise<ArmResult> {
  const started = Date.now();
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let previousUnderstanding: Record<string, any> = {};
  let previousStage = 'understanding';
  let previousState: any = { stage: previousStage, confidence: 0, understanding: {} };
  const researchState = newResearchState();
  const turns: TurnRecord[] = [];
  let pendingNotes: string | null = null;

  for (const [index, user] of userMessages.entries()) {
    const payload = buildGoalConversationUserPayload({
      userInput: user,
      conversationHistory: history,
      previousState,
      previousUnderstanding,
      previousStage,
      supplementText: withWeb ? pendingNotes : null,
    });

    const raw = await chat(
      [
        { role: 'system', content: GOAL_SYSTEM_PROMPT },
        { role: 'user', content: payload },
      ],
      { temperature: 0.3, maxTokens: 3200 }
    );
    const parsed = extractStructuredPayload(raw);
    const json: any = parsed.parsedJson;
    // needsMaterial 是**顶层 hidden 字段**（goal-conversation skill 再把它收进 understanding）；
    // 直接调用 prompt 时必须手动合并，否则永远看不到资料需求。
    const rawNeedsMaterial =
      json?.needsMaterial ?? json?.state?.needsMaterial ?? json?.goalConversation?.needsMaterial;
    const understanding: Record<string, any> | null = (() => {
      const base = json?.understanding || json?.state?.understanding || null;
      if (!base && rawNeedsMaterial === undefined) return null;
      const merged = { ...(base || {}) };
      if (rawNeedsMaterial !== undefined) merged.needsMaterial = rawNeedsMaterial;
      return merged;
    })();
    const stage = String(json?.state?.stage || previousStage);
    const reply = String(json?.reply || parsed.dialogueText || '').trim();

    if (understanding) {
      previousUnderstanding = { ...previousUnderstanding, ...understanding };
    }
    previousStage = stage;
    previousState = {
      stage,
      confidence: num(json?.state?.confidence) ?? 0,
      understanding: previousUnderstanding,
    };
    history.push({ role: 'user', content: user });
    if (reply) history.push({ role: 'assistant', content: reply });

    const needsMaterial = understanding?.needsMaterial;
    const queries = Array.isArray((needsMaterial as any)?.queries)
      ? (needsMaterial as any).queries.map((q: unknown) => String(q || '').trim()).filter(Boolean)
      : [];

    turns.push({
      turn: index + 1,
      user,
      reply,
      stage,
      understanding,
      needsMaterial: needsMaterial ?? null,
      parseError: parsed.parseError || (json ? null : 'no_json'),
      researchUsed: Boolean(withWeb && pendingNotes),
      queries,
    });

    if (withWeb) {
      // 模型自己产出查询才检索；没有查询时不替它编（否则测的就不是 goal 自己的识别）
      if (queries.length > 0) {
        const before = researchState.sources.length;
        await research(queries, researchState);
        if (researchState.sources.length > before || researchState.notes) {
          pendingNotes = researchState.notes;
        }
      }
      // 如果模型给了需求但没有 queries，用 kind/title 生成两条查询（记录在案，视为联网臂的辅助步骤）
      if (queries.length === 0 && needsMaterial && typeof needsMaterial === 'object') {
        const title = String((needsMaterial as any).title || (needsMaterial as any).kind || '').trim();
        if (title) {
          const generated = [`${title} 官方`, `${title} 最新`];
          await research(generated, researchState);
          pendingNotes = researchState.notes;
        }
      }
    }
    console.log(`    ${withWeb ? 'B' : 'A'} turn ${index + 1}/${userMessages.length} stage=${stage} nm=${normalizeNeedsMaterial(needsMaterial)} q=${queries.length} research=${Boolean(pendingNotes)}`);
  }

  return {
    turns,
    finalUnderstanding: previousUnderstanding,
    finalStage: previousStage,
    finalNeedsMaterial: normalizeNeedsMaterial(previousUnderstanding?.needsMaterial),
    research: researchState,
    latencyMs: Date.now() - started,
  };
}

// --------------------------------------------------------------------------
// 裁判
// --------------------------------------------------------------------------

interface JudgeResult {
  scores: Record<string, { understanding: number; needsMaterial: number; grounding: number; scope: number; overall: number }>;
  best: string;
  why: string;
}

function compact(finalUnderstanding: Record<string, any> | null, lastReply: string): string {
  const u = finalUnderstanding || {};
  return [
    `最后一轮回复：${lastReply || '(空)'}`,
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

async function judge(goal: GoalCase, userMessages: string[], a: ArmResult, b: ArmResult): Promise<JudgeResult> {
  const shift = goal.id.length % 2;
  const order: Array<['A' | 'B', string]> = shift === 0 ? [['A', 'X'], ['B', 'Y']] : [['B', 'X'], ['A', 'Y']];
  const labelToArm: Record<string, 'A' | 'B'> = {};
  const blocks = order.map(([arm, label]) => {
    labelToArm[label] = arm;
    const result = arm === 'A' ? a : b;
    const lastReply = result.turns[result.turns.length - 1]?.reply || '';
    return `### 回复 ${label}\n${compact(result.finalUnderstanding, lastReply)}`;
  });
  const prompt = [
    '你是独立评审。下面是一个学习者的真实目标对话（用户发言按时间顺序），以及两个匿名系统给出的最终目标理解与最后一轮回复。',
    '只评内容质量，不评格式/长度/JSON 结构。按 1-5 打分（5 最好）：',
    '- understanding：是否抓住真实问题、约束、起点（尤其 current_baseline 是否有依据而不是默认 beginner）',
    '- needs_material：如果需要外部资料，是否给出了具体、可检索的对象（名称/地区/年份/文件类型）；如果不需要，是否明确没有乱加',
    '- grounding：外部事实是否可核验、有无编造；不确定的是否明说',
    '- scope：时间、范围、验收标准是否与用户约束一致',
    '- overall：综合',
    '最后选一个更好的（允许 tie）。只输出一个 JSON 对象，不要解释。',
    '格式：{"scores":{"X":{"understanding":0,"needs_material":0,"grounding":0,"scope":0,"overall":0},"Y":{...}},"best":"X|Y|tie","why":"一句话"}',
    '',
    '用户发言：',
    ...userMessages.map((message, index) => `${index + 1}. ${message}`),
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
  return {
    scores,
    best: labelToArm[bestKey] || bestKey || 'tie',
    why: String(parsed.why || ''),
  };
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

interface CaseResult {
  caseId: string;
  gold: GoalCase['gold'];
  userMessages: string[];
  A: ArmResult;
  B: ArmResult;
  judge: JudgeResult;
  error: string | null;
}

async function main() {
  const limit = Math.max(1, Number(arg('limit', '8')));
  const maxTurns = Math.max(2, Number(arg('max-turns', '6')));
  const goals = loadGoals(limit);
  fs.mkdirSync(OUT, { recursive: true });
  const outFile = path.join(OUT, 'results.jsonl');
  fs.writeFileSync(outFile, '', 'utf-8');
  console.log(`multiturn eval goals=${goals.length} maxTurns=${maxTurns} model=${LLM_MODEL} judge=${JUDGE_MODEL}`);

  for (const [index, goal] of goals.entries()) {
    const userMessages = selectTurns(goal.userMessages, maxTurns);
    console.log(`\n[${index + 1}/${goals.length}] ${goal.id} users=${userMessages.length} gold.nm=${goal.gold.needsMaterial} gold.q=${goal.gold.goldQueries.length}`);
    let result: CaseResult;
    try {
      const a = await runArm(goal, userMessages, false);
      const b = await runArm(goal, userMessages, true);
      const judged = await judge(goal, userMessages, a, b);
      result = {
        caseId: goal.id,
        gold: goal.gold,
        userMessages,
        A: a,
        B: b,
        judge: judged,
        error: null,
      };
      console.log(
        `  final nm: A=${a.finalNeedsMaterial} B=${b.finalNeedsMaterial} gold=${goal.gold.needsMaterial} | overall A=${judged.scores.A?.overall ?? 'n/a'} B=${judged.scores.B?.overall ?? 'n/a'} best=${judged.best}`
      );
      console.log(`  B research: q=${b.research.queries.length} sources=${b.research.sources.length} | why: ${judged.why.slice(0, 120)}`);
    } catch (error) {
      result = {
        caseId: goal.id,
        gold: goal.gold,
        userMessages,
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
  const metrics = ['understanding', 'needs_material', 'grounding', 'scope', 'overall'] as const;
  const avg = (arm: 'A' | 'B', metric: (typeof metrics)[number]) => {
    const values = valid.map((item) => Number(item.judge.scores[arm]?.[metric])).filter(Number.isFinite);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const best = { A: 0, B: 0, tie: 0 };
  for (const item of valid) {
    if (item.judge.best === 'A') best.A += 1;
    else if (item.judge.best === 'B') best.B += 1;
    else best.tie += 1;
  }
  const nm = {
    A: valid.filter((item) => item.A.finalNeedsMaterial === true).length,
    B: valid.filter((item) => item.B.finalNeedsMaterial === true).length,
    gold: valid.filter((item) => item.gold.needsMaterial === true).length,
    n: valid.length,
  };
  const queryStats = {
    A: { total: valid.reduce((sum, item) => sum + item.A.turns.reduce((s, t) => s + t.queries.length, 0), 0) },
    B: { total: valid.reduce((sum, item) => sum + item.B.research.queries.length, 0) },
    sourceTotal: valid.reduce((sum, item) => sum + item.B.research.sources.length, 0),
  };
  const summary = {
    n: valid.length,
    errors: results.length - valid.length,
    averages: Object.fromEntries(['A', 'B'].map((arm) => [arm, Object.fromEntries(metrics.map((m) => [m, avg(arm as any, m)]))])),
    best,
    needsMaterial: nm,
    queryStats,
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  const lines = [
    '# goal 阶段「联网 vs 不联网」多回合真实回放 — 2026-10-20',
    '',
    `样本：${valid.length} 段真实目标对话（真实用户发言逐轮驱动）；生成 ${LLM_MODEL}，裁判 ${JUDGE_MODEL}。`,
    `B 臂：模型自己产出 needsMaterial.queries 后，用平台 searchWeb + fetchWeb 检索，结果注入下一轮。`,
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
    `查询数：A 模型自发 ${queryStats.A.total} 条，B 实际检索 ${queryStats.B.total} 条；B 来源 ${queryStats.sourceTotal} 条`,
    '',
    '## 逐例',
    '',
    ...valid.map((item, index) => {
      const score = (arm: 'A' | 'B') => {
        const s = item.judge.scores[arm];
        return `overall ${s?.overall ?? 'n/a'} / nm=${item[arm].finalNeedsMaterial === null ? '未给' : item[arm].finalNeedsMaterial}`;
      };
      return [
        `### ${index + 1}. ${item.caseId}`,
        `- 金标：nm=${item.gold.needsMaterial}，block=${item.gold.block}，queries=${item.gold.goldQueries.length}`,
        `- 用户轮数：${item.userMessages.length}`,
        `- A：${score('A')}；最终 stage=${item.A.finalStage}`,
        `- B：${score('B')}；最终 stage=${item.B.finalStage}；检索 q=${item.B.research.queries.length}，来源 ${item.B.research.sources.length}`,
        `- 裁判首选：${item.judge.best}；理由：${item.judge.why}`,
        '',
      ].join('\n');
    }),
  ];
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), lines.join('\n'), 'utf-8');
  console.log(`\nDONE ${path.join(OUT, 'REPORT.md')}`);
}

main().catch((error) => {
  console.error('[multiturn] failed:', error);
  process.exitCode = 1;
});
