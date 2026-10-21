/* eslint-disable no-console -- 一次性 demo CLI */
/* eslint-disable @typescript-eslint/no-explicit-any -- 上游 JSON/HTML 形状动态 */
/* eslint-disable @typescript-eslint/no-require-imports -- node:sqlite 只有 require 形态 */
/**
 * goal 阶段「联网 vs 纯 LLM」对照 demo。
 *
 * 三个臂（同一批真实目标的第一轮用户原话）：
 *   A 平台 goal 脚手架，不联网（= 当前纯 LLM 平台）
 *   B 平台 goal 脚手架 + 平台式联网检索笔记（Bing CN 检索 + 抓正文）
 *   C 通用学习顾问（无 goal 脚手架、不联网）= 纯 LLM 平台基线
 *
 * 评测：匿名三选一，由独立模型裁判按内容质量打分；同时统计 needsMaterial 预测与外部事实密度。
 * 只读 prisma/dev.db；外部搜索走 Bing CN（平台自带 TinyFish/Tavily 上游当晚不可用）。
 *
 * 跑法：
 *   DEMO_LLM_KEY=... npx ts-node --transpile-only src/scripts/demo-goal-web-research.ts --limit=8
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { loadPromptFile } from '../composers/prompt-files/loader';
import { buildGoalConversationUserPayload } from '../skills/goal-conversation';
import { extractStructuredPayload } from '../skills/goal-conversation/structured-validator';

const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };

const OUT = path.resolve(__dirname, '..', '..', '..', 'doc', 'local', 'GOAL-WEB-DEMO-2026-10-19');
const LLM_URL = process.env.DEMO_LLM_URL || 'http://101.43.146.102:30001/v1/chat/completions';
const LLM_KEY = process.env.DEMO_LLM_KEY || process.env.SYSTEMONE_API_KEY || '';
const LLM_MODEL = process.env.DEMO_LLM_MODEL || 'deepseek-v4.1-flash';
const JUDGE_MODEL = process.env.DEMO_JUDGE_MODEL || 'agnes-3.0-flash';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const GOAL_SYSTEM_PROMPT = loadPromptFile('skill:goal-conversation')?.systemPrompt || '';
if (!GOAL_SYSTEM_PROMPT) throw new Error('goal system prompt 未加载');

// --------------------------------------------------------------------------
// 基础工具
// --------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNeedsMaterial(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return null;
}

async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
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
        max_tokens: attempt === 0 ? (options.maxTokens ?? 2400) : Math.max(options.maxTokens ?? 2400, 8000),
        // goal 长提示下模型可能把预算全花在 reasoning 上、content 为空；这两条是网关可接受的关闭写法。
        enable_thinking: false,
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(180000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    const content = String(json.choices?.[0]?.message?.content || '');
    if (content.trim()) return content;
    const finish = json.choices?.[0]?.finish_reason;
    const reasoning = String(json.choices?.[0]?.message?.reasoning_content || '');
    lastMeta = `finish=${finish}, reasoning_chars=${reasoning.length}, usage=${JSON.stringify(json.usage || {})}`;
    // 空 content 常见于模型把内容全放进 reasoning 或被 max_tokens 截断；加预算重试一次。
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
// 真实目标
// --------------------------------------------------------------------------

interface GoalCase {
  id: string;
  firstUser: string;
  /** goal LLM 自己在真实对话里产出的资料查询（生产链路本来就用它去检索） */
  materialQueries: string[];
  gold: {
    needsMaterial: boolean | null;
    block: string | null;
    realProblem: string | null;
  };
}

function loadGoals(limit: number): GoalCase[] {
  const db = new DatabaseSync('prisma/dev.db', { readOnly: true });
  const rows = db
    .prepare('SELECT id, collectedData FROM goal_conversations WHERE collectedData IS NOT NULL ORDER BY createdAt DESC')
    .all() as Array<{ id: string; collectedData: string }>;
  const withMaterial: GoalCase[] = [];
  const withoutMaterial: GoalCase[] = [];
  for (const row of rows) {
    let collected: any;
    try {
      collected = JSON.parse(row.collectedData);
    } catch {
      continue;
    }
    const messages = Array.isArray(collected.messages) ? collected.messages : [];
    const firstUser = messages.find((m: any) => m.role === 'user')?.content;
    if (!firstUser || String(firstUser).length < 20) continue;
    const understanding = collected.understanding || {};
    const needsMaterial = normalizeNeedsMaterial(understanding.needsMaterial);
    const materialQueries = Array.isArray(understanding.needsMaterial?.queries)
      ? understanding.needsMaterial.queries
          .map((query: unknown) => String(query || '').trim())
          .filter((query: string) => query.length >= 3)
          .slice(0, 3)
      : [];
    const item: GoalCase = {
      id: row.id,
      firstUser: String(firstUser),
      materialQueries,
      gold: {
        needsMaterial,
        block: understanding.primary_block_type || null,
        realProblem: understanding.real_problem || null,
      },
    };
    if (needsMaterial === true) withMaterial.push(item);
    else if (needsMaterial === false) withoutMaterial.push(item);
  }
  db.close();
  const controlCount = Math.max(1, Math.min(2, Math.floor(limit / 4)));
  return [...withMaterial.slice(0, limit - controlCount), ...withoutMaterial.slice(0, controlCount)];
}

// --------------------------------------------------------------------------
// 联网检索（Bing CN + 抓正文）
// --------------------------------------------------------------------------

interface Source {
  title: string;
  url: string;
  snippet: string;
  text?: string;
}

function decodeBingUrl(href: string): string {
  const match = href.match(/[?&]u=a1([^&]+)/);
  if (!match) return href;
  try {
    const base64 = decodeURIComponent(match[1]).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return href;
  }
}

async function searchBaidu(query: string): Promise<Source[]> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=10`;
  const html = await fetchText(url, 15000);
  const starts = [...html.matchAll(/<div[^>]+class="[^"]*result[^"]*c-container[^"]*"[^>]*>/g)].map(
    (match) => match.index || 0
  );
  const blocks: string[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    blocks.push(html.slice(starts[index], starts[index + 1] ?? starts[index] + 9000));
  }
  const sources: Source[] = [];
  for (const block of blocks.slice(0, 8)) {
    if (block.includes('广告') && !block.includes('c-container')) continue;
    const title = stripHtml((block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '');
    const href = (block.match(/href="([^"]+)"/) || [])[1] || '';
    if (!title || !href) continue;
    if (/实时智能回复|精选笔记|相关搜索/.test(title)) continue;
    const snippet = stripHtml(block.replace(/<h3[\s\S]*?<\/h3>/, '')).slice(0, 300);
    sources.push({
      title,
      url: href.startsWith('http') ? href : `https://www.baidu.com${href}`,
      snippet,
    });
  }
  return sources;
}

async function searchBing(query: string): Promise<Source[]> {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans&cc=cn&count=6`;
  const html = await fetchText(url, 15000);
  const blocks = [...html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)].map((match) => match[0]).slice(0, 5);
  const sources: Source[] = [];
  for (const block of blocks) {
    const title = stripHtml((block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || '');
    const href = decodeBingUrl((block.match(/<a[^>]+href="([^"]+)"/) || [])[1] || '');
    const snippet = stripHtml(block.replace(/<h2[\s\S]*?<\/h2>/, '')).slice(0, 260);
    if (title && href.startsWith('http')) sources.push({ title, url: href, snippet });
  }
  return sources;
}

async function buildResearchNotes(goal: GoalCase): Promise<{ notes: string | null; queries: string[]; sources: Source[] }> {
  let queries: string[] = [...goal.materialQueries];
  if (queries.length === 0) {
    const queryPrompt =
      '你在为一位学习者的目标做外部资料检索。只输出 2 条中文搜索查询，每行一条，不要编号、不要解释。' +
      '每条查询必须包含用户原话里的核心名词（考试名/疾病名/地区/软件名），不要只取泛词。\n' +
      `学习者原话：${goal.firstUser}`;
    try {
      const raw = await chat([{ role: 'user', content: queryPrompt }], { temperature: 0.2, maxTokens: 120 });
      queries = raw
        .split('\n')
        .map((line) => line.replace(/^[-*\d.、\s]+/, '').trim())
        .filter((line) => line.length >= 4 && !line.includes('查询'))
        .slice(0, 2);
    } catch {
      queries = [];
    }
  }
  if (queries.length === 0) queries = [goal.firstUser.slice(0, 40)];

  const sources: Source[] = [];
  for (const query of queries) {
    try {
      const baidu = await searchBaidu(query);
      if (baidu.length > 0) {
        sources.push(...baidu.slice(0, 4));
        continue;
      }
    } catch {
      // 百度失败再试 Bing
    }
    try {
      sources.push(...(await searchBing(query)).slice(0, 4));
    } catch {
      // 单条查询失败不阻断
    }
  }
  const unique = new Map<string, Source>();
  for (const source of sources) if (!unique.has(source.url)) unique.set(source.url, source);
  const top = [...unique.values()].slice(0, 4);

  // 抓前两条正文；失败就用搜索摘要
  for (const source of top.slice(0, 2)) {
    try {
      source.text = stripHtml(await fetchText(source.url, 15000)).slice(0, 1400);
    } catch {
      source.text = '';
    }
  }
  if (top.length === 0) return { notes: null, queries, sources: [] };

  const lines = [
    '【平台联网检索结果 · 2026-10-20】',
    '以下是从公开网页检索到的外部资料。它们是事实依据，不是用户提供的信息；引用时注明来源编号。',
    '未覆盖的内容不要编造；如果检索结果与用户原话冲突，以用户原话为准。',
    '',
  ];
  top.forEach((source, index) => {
    lines.push(`[${index + 1}] ${source.title} — ${source.url}`);
    const body = source.text || source.snippet;
    if (body) lines.push(`摘录：${body.slice(0, 900)}`);
    lines.push('');
  });
  return { notes: lines.join('\n'), queries, sources: top };
}

// --------------------------------------------------------------------------
// 三个臂
// --------------------------------------------------------------------------

interface GoalOutput {
  reply: string;
  understanding: Record<string, unknown> | null;
  nextQuestions: string[] | null;
  raw: string;
  parseError: string | null;
}

async function runGoalArm(goal: GoalCase, notes: string | null): Promise<GoalOutput> {
  const payload = buildGoalConversationUserPayload({
    userInput: goal.firstUser,
    conversationHistory: [],
    previousStage: 'understanding',
    supplementText: notes,
  });
  const raw = await chat(
    [
      { role: 'system', content: GOAL_SYSTEM_PROMPT },
      { role: 'user', content: payload },
    ],
    { temperature: 0.3, maxTokens: 2600 }
  );
  const parsed = extractStructuredPayload(raw);
  const json: any = parsed.parsedJson;
  return {
    reply: String(json?.reply || parsed.dialogueText || '').trim(),
    understanding: json?.understanding || json?.state?.understanding || null,
    nextQuestions: Array.isArray(json?.nextQuestions) ? json.nextQuestions : null,
    raw,
    parseError: parsed.parseError || (json ? null : 'no_json'),
  };
}

const GENERIC_SYSTEM =
  '你是一位耐心的学习顾问。根据学习者原话，给出你真实会给出的第一轮回复：' +
  '先确认你理解的真实问题、约束和起点，再给一个具体、可执行的下一步。' +
  '不要编造外部事实；不确定就明说。不超过 300 字。';

async function runGenericArm(goal: GoalCase): Promise<GoalOutput> {
  const raw = await chat(
    [
      { role: 'system', content: GENERIC_SYSTEM },
      { role: 'user', content: goal.firstUser },
    ],
    { temperature: 0.3, maxTokens: 600 }
  );
  return { reply: raw.trim(), understanding: null, nextQuestions: null, raw, parseError: null };
}

// --------------------------------------------------------------------------
// 裁判
// --------------------------------------------------------------------------

interface JudgeResult {
  scores: Record<string, { specificity: number; grounding: number; understanding: number; question: number; overall: number }>;
  /** 哪一个最适合作为目标阶段的第一轮（允许只问一个问题） */
  bestGoalTurn: string;
  /** 哪一个对学习者最有帮助（允许给完整方案） */
  mostHelpful: string;
  why: string;
}

function compactResponse(output: GoalOutput): string {
  const reply = output.reply || '(空)';
  if (!output.understanding) return `回复：${reply}`;
  const u: any = output.understanding;
  return [
    `回复：${reply}`,
    `结构化理解：${JSON.stringify(
      {
        real_problem: u.real_problem,
        primary_block_type: u.primary_block_type,
        current_baseline: u.current_baseline,
        time_dimensions: u.time_dimensions,
        success_criteria: u.success_criteria,
        needsMaterial: u.needsMaterial,
      },
      null,
      0
    )}`,
  ].join('\n');
}

async function judge(goal: GoalCase, outputs: Record<'A' | 'B' | 'C', GoalOutput>): Promise<JudgeResult> {
  const labels = ['X', 'Y', 'Z'];
  const arms: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
  // 每个 case 固定轮换顺序，避免同一臂永远在同一位置
  const shift = goal.id.length % 3;
  const order = [...arms.slice(shift), ...arms.slice(0, shift)];
  const labelToArm: Record<string, 'A' | 'B' | 'C'> = {};
  const blocks = order.map((arm, index) => {
    labelToArm[labels[index]] = arm;
    return `### 回复 ${labels[index]}\n${compactResponse(outputs[arm])}`;
  });
  const prompt = [
    '你是独立评审。下面是一个学习者的目标原话，以及三个匿名回复（顺序已打乱）。',
    '只评内容质量，不评格式、长度或 JSON 结构。',
    '注意：有些回复是「目标澄清回合」，可能只问一个问题而不给完整方案——这是设计选择，不要因此判低；',
    '请评它问的是不是最关键的那个问题、以及它展现出的理解是否准确。',
    '按 1-5 打分（5 最好）：',
    '- specificity：是否给出具体、可核验的细节（条件/文件/时间/等级/地区），而不是泛泛而谈',
    '- grounding：外部事实是否可核验、有无编造；不确定的事情是否明说',
    '- understanding：是否抓住真实问题、约束和起点',
    '- question：作为下一步追问或行动指引，是否切中要害',
    '- overall：综合',
    '然后做两个选择（允许 tie）：',
    '- best_goal_turn：哪一个最适合作为「目标阶段的第一轮」（允许只问一个问题）',
    '- most_helpful：哪一个对学习者最有帮助（允许给完整方案）',
    '只输出一个 JSON 对象，不要解释。',
    '格式：{"scores":{"X":{"specificity":0,"grounding":0,"understanding":0,"question":0,"overall":0},"Y":{...},"Z":{...}},"best_goal_turn":"X|Y|Z|tie","most_helpful":"X|Y|Z|tie","why":"一句话"}',
    '',
    `学习者原话：${goal.firstUser}`,
    '',
    ...blocks,
  ].join('\n');
  const raw = await chat([{ role: 'user', content: prompt }], {
    model: JUDGE_MODEL,
    temperature: 0.1,
    maxTokens: 900,
  });
  const parsed = extractJson(raw) || {
    scores: {},
    best_goal_turn: 'tie',
    most_helpful: 'tie',
    why: raw.slice(0, 160),
  };
  const mappedScores: JudgeResult['scores'] = {};
  for (const [label, score] of Object.entries(parsed.scores || {})) {
    const arm = labelToArm[label];
    if (arm) mappedScores[arm] = score as any;
  }
  const mapChoice = (value: unknown): string => {
    const key = String(value || '').trim();
    return labelToArm[key] || key || 'tie';
  };
  return {
    scores: mappedScores,
    bestGoalTurn: mapChoice(parsed.best_goal_turn ?? parsed.best),
    mostHelpful: mapChoice(parsed.most_helpful ?? parsed.best),
    why: String(parsed.why || ''),
  };
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

interface CaseResult {
  caseId: string;
  firstUser: string;
  gold: GoalCase['gold'];
  queries: string[];
  sources: Array<{ title: string; url: string }>;
  outputs: Record<'A' | 'B' | 'C', GoalOutput>;
  judge: JudgeResult;
  error: string | null;
}

async function main() {
  const limit = Math.max(1, Number(arg('limit', '8')));
  const goals = loadGoals(limit);
  if (goals.length === 0) throw new Error('没有可用的真实目标');
  fs.mkdirSync(OUT, { recursive: true });
  const resultsFile = path.join(OUT, 'results.jsonl');
  fs.writeFileSync(resultsFile, '', 'utf-8');

  console.log(`demo goals=${goals.length} model=${LLM_MODEL} judge=${JUDGE_MODEL}`);
  for (const [index, goal] of goals.entries()) {
    console.log(`\n[${index + 1}/${goals.length}] ${goal.id} gold.needsMaterial=${goal.gold.needsMaterial}`);
    console.log(`  goal: ${goal.firstUser.slice(0, 90)}…`);
    let result: CaseResult;
    try {
      const research = await buildResearchNotes(goal);
      console.log(`  queries=${JSON.stringify(research.queries)} sources=${research.sources.length}`);
      const [a, b, c] = await Promise.all([
        runGoalArm(goal, null),
        runGoalArm(goal, research.notes),
        runGenericArm(goal),
      ]);
      const judged = await judge(goal, { A: a, B: b, C: c });
      result = {
        caseId: goal.id,
        firstUser: goal.firstUser,
        gold: goal.gold,
        queries: research.queries,
        sources: research.sources.map((source) => ({ title: source.title, url: source.url })),
        outputs: { A: a, B: b, C: c },
        judge: judged,
        error: null,
      };
    } catch (error) {
      result = {
        caseId: goal.id,
        firstUser: goal.firstUser,
        gold: goal.gold,
        queries: [],
        sources: [],
        outputs: { A: {} as any, B: {} as any, C: {} as any },
        judge: { scores: {}, bestGoalTurn: 'n/a', mostHelpful: 'n/a', why: '' },
        error: String((error as Error)?.message || error).slice(0, 300),
      };
      console.log(`  ERROR: ${result.error}`);
    }
    fs.appendFileSync(resultsFile, `${JSON.stringify(result)}\n`, 'utf-8');
    const scoreLine = ['A', 'B', 'C']
      .map((arm) => `${arm}:${(result.judge.scores as any)[arm]?.overall ?? 'n/a'}`)
      .join(' ');
    console.log(`  overall ${scoreLine} bestTurn=${result.judge.bestGoalTurn} helpful=${result.judge.mostHelpful}`);
    console.log(`  why: ${result.judge.why.slice(0, 120)}`);
  }

  // 汇总
  const results = fs
    .readFileSync(resultsFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CaseResult);
  const valid = results.filter((item) => !item.error);
  const metrics = ['specificity', 'grounding', 'understanding', 'question', 'overall'] as const;
  const avg = (arm: 'A' | 'B' | 'C', metric: (typeof metrics)[number]) => {
    const values = valid.map((item) => Number(item.judge.scores[arm]?.[metric])).filter(Number.isFinite);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const bestTurnCount: Record<string, number> = {};
  const helpfulCount: Record<string, number> = {};
  const bestTurnAB: Record<string, number> = { A: 0, B: 0, tie: 0 };
  for (const item of valid) {
    bestTurnCount[item.judge.bestGoalTurn] = (bestTurnCount[item.judge.bestGoalTurn] || 0) + 1;
    helpfulCount[item.judge.mostHelpful] = (helpfulCount[item.judge.mostHelpful] || 0) + 1;
    if (item.judge.bestGoalTurn === 'A' || item.judge.bestGoalTurn === 'B') {
      bestTurnAB[item.judge.bestGoalTurn] += 1;
    } else {
      bestTurnAB.tie += 1;
    }
  }
  const needsMaterial = {
    A: valid.filter((item) => normalizeNeedsMaterial((item.outputs.A.understanding as any)?.needsMaterial) === true).length,
    B: valid.filter((item) => normalizeNeedsMaterial((item.outputs.B.understanding as any)?.needsMaterial) === true).length,
    gold: valid.filter((item) => item.gold.needsMaterial === true).length,
    n: valid.length,
  };

  const summary = {
    n: valid.length,
    errors: results.length - valid.length,
    averages: Object.fromEntries(['A', 'B', 'C'].map((arm) => [arm, Object.fromEntries(metrics.map((m) => [m, avg(arm as any, m)]))])),
    bestTurnCount,
    bestTurnAB,
    helpfulCount,
    needsMaterial,
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  // 报告
  const lines = [
    '# goal 阶段联网 vs 纯 LLM 对照 demo — 2026-10-19',
    '',
    `样本：${valid.length} 个真实目标第一轮（其中金标 needsMaterial=true ${needsMaterial.gold}/${needsMaterial.n}）。`,
    `模型：生成 ${LLM_MODEL}；裁判 ${JUDGE_MODEL}。`,
    '',
    '## 三臂',
    '- **A**：平台 goal 脚手架，不联网（= 当前纯 LLM 平台）',
    '- **B**：平台 goal 脚手架 + 联网检索笔记（Bing CN 检索 + 抓正文）',
    '- **C**：通用学习顾问，无 goal 脚手架、不联网（= 纯 LLM 基线）',
    '',
    '## 汇总',
    '',
    '| 指标 | A（纯 LLM 平台） | B（+联网） | C（通用 LLM） |',
    '|---|---|---|---|',
    ...metrics.map((m) => {
      const row = ['A', 'B', 'C'].map((arm) => {
        const value = summary.averages[arm as 'A' | 'B' | 'C'][m];
        return value === null ? 'n/a' : value.toFixed(2);
      });
      return `| ${m} | ${row.join(' | ')} |`;
    }),
    '',
    `裁判首选（作为目标阶段第一轮）：${Object.entries(bestTurnCount).map(([key, count]) => `${key}=${count}`).join('，') || 'n/a'}；其中 A vs B：A ${bestTurnAB.A} / B ${bestTurnAB.B} / tie ${bestTurnAB.tie}`,
    `裁判首选（对学习者最有帮助）：${Object.entries(helpfulCount).map(([key, count]) => `${key}=${count}`).join('，') || 'n/a'}`,
    `needsMaterial=true：A ${needsMaterial.A}/${needsMaterial.n}，B ${needsMaterial.B}/${needsMaterial.n}，金标 ${needsMaterial.gold}/${needsMaterial.n}`,
    '',
    '## 逐例',
    '',
    ...valid.map((item, index) => {
      const format = (arm: 'A' | 'B' | 'C') => {
        const score = item.judge.scores[arm];
        const nm = normalizeNeedsMaterial((item.outputs[arm].understanding as any)?.needsMaterial);
        return `overall ${score?.overall ?? 'n/a'} / needsMaterial=${nm === null ? '未给' : nm}`;
      };
      return [
        `### ${index + 1}. ${item.firstUser.slice(0, 60)}…`,
        `- 金标 needsMaterial=${item.gold.needsMaterial}，block=${item.gold.block}`,
        `- 检索 queries：${item.queries.join(' / ') || '(无)'}；sources=${item.sources.length}`,
        `- A：${format('A')}`,
        `- B：${format('B')}`,
        `- C：${format('C')}`,
        `- 裁判首选（目标回合）：${item.judge.bestGoalTurn}；最有帮助：${item.judge.mostHelpful}；理由：${item.judge.why}`,
        '',
      ].join('\n');
    }),
  ];
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), lines.join('\n'), 'utf-8');
  console.log(`\nDONE ${path.join(OUT, 'REPORT.md')}`);
}

main().catch((error) => {
  console.error('[demo] failed:', error);
  process.exitCode = 1;
});
