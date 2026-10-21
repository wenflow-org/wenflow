/* eslint-disable no-console -- 一次性离线评测 CLI：面向人读的输出，不需要 logger */
/* eslint-disable @typescript-eslint/no-explicit-any -- 一次性离线评测器：sqlite 行与上游 JSON 载荷形状动态（对齐 bare-review / eval 系列先例） */
/* eslint-disable @typescript-eslint/no-require-imports -- node:sqlite 目前只有 CommonJS require 形态的类型入口 */
/**
 * 全流程决策点离线评测器。
 *
 * 目的：不看「哪个模型在自建分诊题集上更高分」，而是拿**平台真实落库状态**，
 * 逐个业务环节问「这里换成/扩一个决策模型，会不会改变下游动作」。
 *
 * 三个环节（对应全流程盘点的 TOP1 / TOP5 / TOP7）：
 *   signals  —— 教学回合四信号（understanding / cognitiveLevel / emotionalState / loadIndex / 困惑点数）
 *               金标 = 生产 LLM 写进 teaching_session_messages.analysis 的值（银标，非人工标注）
 *               核心指标 = **下游阶段判定翻转率**（把两套信号喂给同一个 determineNextStage 口径）
 *   goal     —— 目标理解分诊（primary_block_type / recurrence / support_need / needsMaterial）
 *               金标 = goal LLM 自己写进 collectedData.understanding 的值
 *   advisory —— 课后重规划建议（shouldSuggest / recommendation / priority）
 *               金标 = 规则写进 teaching_sessions.advisory 的值（已知 shouldSuggest 恒 true）
 *
 * 所有输入只读 `prisma/dev.db`（readOnly），不写库、不改生产链路。
 *
 * 用法：
 *   # 通道由 SYSTEMONE_* 决定（与 eval-systemone-triage-v2.ts 同一套）
 *   SYSTEMONE_BASE_URL=http://101.43.146.102:30001/v1/systemone \
 *   SYSTEMONE_MODEL=jev-1.14.0 SYSTEMONE_API_KEY=... \
 *   npx ts-node --transpile-only src/scripts/eval-decision-wholeflow.ts --task=signals --limit=40
 *
 *   # 离线重放（不发请求）
 *   npx ts-node --transpile-only src/scripts/eval-decision-wholeflow.ts --analyze --out=...
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };

const DB_PATH = path.resolve(__dirname, '..', '..', 'prisma', 'dev.db');
const OUT_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'doc',
  'local',
  'DECISION-MODEL-STUDY-2026-10-18',
  'wholeflow'
);

const BASE_URL = process.env.SYSTEMONE_BASE_URL || 'http://101.43.146.102:30001/v1/systemone';
const API_KEY = process.env.SYSTEMONE_API_KEY || 'public';
const MODEL = process.env.SYSTEMONE_MODEL || 'jev-1.14.0';
const AUTH_HEADER = process.env.SYSTEMONE_AUTH_STYLE === 'raw' ? API_KEY : `Bearer ${API_KEY}`;

type TaskName = 'signals' | 'goal' | 'advisory' | 'mastery';

interface Args {
  task: TaskName | 'all';
  limit: number;
  out: string;
  concurrency: number;
  delay: number;
  retries: number;
  analyze: boolean;
  dryRun: boolean;
  sample: 'biased' | 'random';
}

function parseArgs(): Args {
  const arg = (name: string, fallback: string): string => {
    const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const task = arg('task', 'all') as TaskName | 'all';
  const channelTag = String(process.env.SYSTEMONE_TAG || MODEL).replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    task,
    limit: Number(arg('limit', '40')),
    out: path.resolve(arg('out', path.join(OUT_ROOT, channelTag))),
    concurrency: Math.max(1, Number(arg('concurrency', '1'))),
    delay: Math.max(0, Number(arg('delay', '300'))),
    retries: Math.max(0, Number(arg('retries', '6'))),
    analyze: process.argv.includes('--analyze'),
    dryRun: process.argv.includes('--dry-run'),
    sample: arg('sample', 'biased') === 'random' ? 'random' : 'biased',
  };
}

// --------------------------------------------------------------------------
// 通用工具
// --------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function truncate(text: string, max: number): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pct(hit: number, total: number): string {
  return total ? `${((100 * hit) / total).toFixed(1)}%` : 'n/a';
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let nume = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    nume += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? nume / Math.sqrt(dx * dy) : null;
}

/** 多数类基线：所有样本都猜金标里出现最多的那一类，能拿到多少。 */
function majorityBaseline(golds: string[]): { label: string | null; hit: number; total: number; rate: number | null } {
  const counts = new Map<string, number>();
  for (const gold of golds) if (gold) counts.set(gold, (counts.get(gold) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const label = sorted[0]?.[0] ?? null;
  const hit = sorted[0]?.[1] ?? 0;
  return { label, hit, total: golds.filter(Boolean).length, rate: golds.filter(Boolean).length ? hit / golds.filter(Boolean).length : null };
}

/** 连续值基线：所有样本都猜金标均值，MAE 是多少。 */
function meanBaseline(pairs: Array<[number, number]>): number | null {
  if (pairs.length === 0) return null;
  const goldMean = mean(pairs.map(([gold]) => gold))!;
  return mean(pairs.map(([gold]) => Math.abs(gold - goldMean)));
}

/** 并发上限 + 请求起始最小间隔：jev 通道要求慢，默认并发 1。 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  gapMs: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  let lastStart = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const wait = lastStart + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

interface CallOutcome {
  httpStatus: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 原始响应体原样落盘，供离线复盘
  response: any | null;
  error: string | null;
  attempts: number;
  ms: number;
}

async function callSystemOne(body: Record<string, unknown>, retries: number): Promise<CallOutcome> {
  const started = Date.now();
  let attempts = 0;
  let lastError = '';
  let lastStatus: number | null = null;
  while (attempts <= retries) {
    attempts += 1;
    try {
      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, ...body }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      lastStatus = res.status;
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${text.slice(0, 180)}`;
      } else {
        return { httpStatus: res.status, response: JSON.parse(text), error: null, attempts, ms: Date.now() - started };
      }
    } catch (error) {
      lastError = truncate(String((error as Error)?.message || error), 200);
    }
    if (attempts <= retries) await sleep(1200);
  }
  return { httpStatus: lastStatus, response: null, error: lastError, attempts, ms: Date.now() - started };
}

// --------------------------------------------------------------------------
// 读取真实状态
// --------------------------------------------------------------------------

function openDb(): any {
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

interface ParsedMessage {
  role: string;
  content: string;
  payload: Record<string, any>;
}

function parseMessages(rows: Array<{ payload: string }>): ParsedMessage[] {
  const out: ParsedMessage[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload);
      out.push({ role: String(payload.role || ''), content: String(payload.content || ''), payload });
    } catch {
      // 脏行跳过，不参与评测
    }
  }
  return out;
}

interface SignalItem {
  key: string;
  sessionId: string;
  state: Record<string, unknown>;
  gold: {
    cognitive: string | null;
    understanding: number | null;
    emotional: string | null;
    load: number | null;
    confusionCount: number | null;
    engagement: number | null;
  };
}

const QUALIFYING_ANALYSIS = (payload: Record<string, any>): boolean => {
  const analysis = payload?.analysis;
  if (!analysis || typeof analysis !== 'object') return false;
  if (analysis.openingMode) return false; // 开场没有学员发言，信号不具可比性
  return num(analysis.understanding) !== null || typeof analysis.cognitiveLevel === 'string';
};

/** 每个会话最多取 2 个回合（前段/后段各一个），避免长会话刷爆样本。 */
function loadSignalItems(limit: number): SignalItem[] {
  const db = openDb();
  const sessions = db
    .prepare('SELECT id, subject, topic, taskType, teachingState, createdAt FROM teaching_sessions ORDER BY createdAt DESC')
    .all() as Array<Record<string, any>>;
  const msgStmt = db.prepare(
    'SELECT payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY createdAt, id'
  );
  const items: SignalItem[] = [];

  for (const session of sessions) {
    if (items.length >= limit) break;
    const messages = parseMessages(msgStmt.all(session.id) as Array<{ payload: string }>);
    if (messages.length < 5) continue;

    let teachingState: any = null;
    try {
      teachingState = session.teachingState ? JSON.parse(session.teachingState) : null;
    } catch {
      teachingState = null;
    }
    const intent = teachingState?.sessionArtifacts?.pathBackgroundContext?.taskIntent || {};

    const candidates: number[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      if (messages[i].role !== 'assistant') continue;
      if (!QUALIFYING_ANALYSIS(messages[i].payload)) continue;
      const priorUser = messages.slice(Math.max(0, i - 3), i).some((m) => m.role === 'user');
      if (!priorUser) continue;
      candidates.push(i);
    }
    if (candidates.length === 0) continue;

    const picks = [candidates[Math.floor(candidates.length / 2)]];
    const last = candidates[candidates.length - 1];
    if (last !== picks[0]) picks.push(last);

    for (const index of picks) {
      if (items.length >= limit) break;
      const target = messages[index];
      const analysis = target.payload.analysis || {};
      const prior = messages.slice(Math.max(0, index - 6), index);
      const previousKnowledgePoint =
        [...prior].reverse().find((m) => m.payload?.knowledgePoint)?.payload.knowledgePoint || '';
      const conversation = prior
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => `${m.role === 'user' ? '学员' : '教师'}：${truncate(m.content, 320)}`)
        .join('\n');

      const confusion = Array.isArray(analysis.confusionPoints) ? analysis.confusionPoints.length : null;
      items.push({
        key: `${session.id}#${index}`,
        sessionId: session.id,
        state: {
          任务: truncate(intent.taskTitle || session.topic || '', 200),
          任务说明: truncate(intent.taskDescription || '', 450),
          学科: session.subject,
          主题: session.topic,
          当前知识点: truncate(previousKnowledgePoint, 120),
          最近对话: conversation,
        },
        gold: {
          cognitive: typeof analysis.cognitiveLevel === 'string' ? analysis.cognitiveLevel : null,
          understanding: num(analysis.understanding),
          emotional: typeof analysis.emotionalState === 'string' ? analysis.emotionalState : null,
          load: num(analysis.loadIndex),
          confusionCount: confusion,
          engagement: num(analysis.engagement),
        },
      });
    }
  }
  db.close();
  return items;
}

interface GoalItem {
  key: string;
  state: Record<string, unknown>;
  gold: {
    block: string | null;
    recurrence: string | null;
    supportNeed: string | null;
    needsMaterial: boolean | null;
  };
}

function normalizeNeedsMaterial(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return null;
}

function loadGoalItems(limit: number): GoalItem[] {
  const db = openDb();
  const rows = db
    .prepare('SELECT id, collectedData, createdAt FROM goal_conversations WHERE collectedData IS NOT NULL ORDER BY createdAt DESC')
    .all() as Array<Record<string, any>>;
  const items: GoalItem[] = [];
  for (const row of rows) {
    if (items.length >= limit) break;
    let collected: any;
    try {
      collected = JSON.parse(row.collectedData);
    } catch {
      continue;
    }
    const messages = Array.isArray(collected?.messages) ? collected.messages : [];
    if (messages.length < 3) continue;
    const understanding = collected?.understanding || {};
    const conversation = messages
      .filter((m: any) => m && (m.role === 'user' || m.role === 'ai' || m.role === 'assistant'))
      .map(
        (m: any) =>
          `${m.role === 'user' ? '学员' : '顾问'}：${truncate(String(m.content || ''), 420)}`
      )
      .join('\n');
    items.push({
      key: row.id,
      state: {
        目标对话: conversation,
      },
      gold: {
        block: understanding.primary_block_type || understanding.primaryBlockType || null,
        recurrence: understanding.recurrence || null,
        supportNeed: understanding.support_need || understanding.supportNeed || null,
        needsMaterial: normalizeNeedsMaterial(understanding.needsMaterial),
      },
    });
  }
  db.close();
  return items;
}

interface MasteryItem {
  key: string;
  state: Record<string, unknown>;
  gold: {
    status: string | null;
    progress: number | null;
  };
}

/**
 * 课末知识点掌握判定：拿课堂记录（不含 wrapup 总结，避免金标泄漏）判每个知识点状态。
 * 这是 FSRS 排程与重规划的上游信号，输出有界（4 状态 + 进度档）。
 */
function loadMasteryItems(limit: number, sample: 'biased' | 'random' = 'biased'): MasteryItem[] {
  const db = openDb();
  const sessions = db
    .prepare(
      'SELECT id, subject, topic, wrapup, teachingState, createdAt FROM teaching_sessions ' +
        'WHERE wrapup IS NOT NULL ORDER BY createdAt DESC'
    )
    .all() as Array<Record<string, any>>;
  const msgStmt = db.prepare(
    'SELECT payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY createdAt, id'
  );
  const all: Array<MasteryItem & { sessionId: string }> = [];

  for (const session of sessions) {
    if (sample === 'biased' && all.length >= limit) break;
    let wrapup: any;
    let teachingState: any;
    try {
      wrapup = JSON.parse(session.wrapup);
      teachingState = session.teachingState ? JSON.parse(session.teachingState) : null;
    } catch {
      continue;
    }
    const knowledgeItems: any[] = Array.isArray(wrapup?.summary?.knowledgeItems)
      ? wrapup.summary.knowledgeItems
      : [];
    if (knowledgeItems.length === 0) continue;

    const messages = parseMessages(msgStmt.all(session.id) as Array<{ payload: string }>);
    const transcript = messages.filter((message) => message.role === 'user' || message.role === 'assistant');
    if (transcript.length < 3) continue;
    // 只取到最后一个学员发言为止：教师收尾句常直接复述“你已经掌握了…”，会泄漏金标。
    const lastUserIndex = transcript.map((message) => message.role).lastIndexOf('user');
    const evidence = transcript.slice(0, lastUserIndex + 1).slice(-14);
    const conversation = evidence
      .map((message) => `${message.role === 'user' ? '学员' : '教师'}：${truncate(message.content, 300)}`)
      .join('\n');

    const intent = teachingState?.sessionArtifacts?.pathBackgroundContext?.taskIntent || {};
    // 每个会话最多取 2 个知识点，避免同一堂课刷爆样本；优先取非 mastered 的（更有判别价值）。
    // biased 抽样（默认）：每个会话优先取非 mastered 的 2 条，专测“会不会把 learning 误升成 mastered”；
    // random 抽样：全量候选按哈希打散，每个会话最多 1 条，得到能代表 647 条真实分布的样本。
    const ordered =
      sample === 'random'
        ? [...knowledgeItems]
        : [...knowledgeItems].sort((a, b) => Number(a.status === 'mastered') - Number(b.status === 'mastered'));
    for (const item of sample === 'random' ? ordered : ordered.slice(0, 2)) {
      if (sample === 'biased' && all.length >= limit) break;
      if (!item?.name) continue;
      all.push({
        sessionId: session.id,
        key: `${session.id}#${String(item.name).slice(0, 40)}`,
        state: {
          任务: truncate(intent.taskTitle || session.topic || '', 200),
          任务说明: truncate(intent.taskDescription || '', 500),
          验收标准: truncate(intent.acceptanceCriteria || '', 350),
          知识点: truncate(String(item.name), 120),
          课堂记录: conversation,
        },
        gold: {
          status: typeof item.status === 'string' ? item.status : null,
          progress: num(item.progress),
        },
      });
    }
  }
  db.close();

  if (sample === 'biased') return all.slice(0, limit);

  const hash = (text: string): number => {
    let value = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  };
  const shuffled = [...all].sort((a, b) => hash(a.key) - hash(b.key));
  const picked: MasteryItem[] = [];
  const seen = new Set<string>();
  for (const item of shuffled) {
    if (picked.length >= limit) break;
    if (seen.has(item.sessionId)) continue;
    seen.add(item.sessionId);
    picked.push(item);
  }
  return picked;
}

interface AdvisoryItem {
  key: string;
  state: Record<string, unknown>;
  gold: {
    shouldSuggest: boolean | null;
    recommendation: string | null;
    priority: string | null;
    reasonCodes: string[];
  };
}

function loadAdvisoryItems(limit: number): AdvisoryItem[] {
  const db = openDb();
  const rows = db
    .prepare(
      'SELECT id, subject, topic, wrapup, advisory, teachingState, createdAt FROM teaching_sessions ' +
        'WHERE advisory IS NOT NULL AND wrapup IS NOT NULL ORDER BY createdAt DESC'
    )
    .all() as Array<Record<string, any>>;
  const items: AdvisoryItem[] = [];
  for (const row of rows) {
    if (items.length >= limit) break;
    let wrapup: any;
    let advisory: any;
    let teachingState: any;
    try {
      wrapup = JSON.parse(row.wrapup);
      advisory = JSON.parse(row.advisory);
      teachingState = row.teachingState ? JSON.parse(row.teachingState) : null;
    } catch {
      continue;
    }
    const summary = wrapup?.summary || {};
    const knowledgeItems = Array.isArray(wrapup?.knowledgeItems) ? wrapup.knowledgeItems : [];
    const learner = teachingState?.learnerStateContext || {};
    const intent = teachingState?.sessionArtifacts?.pathBackgroundContext?.taskIntent || {};
    const knowledgeLine =
      knowledgeItems.length > 0
        ? knowledgeItems
            .slice(0, 8)
            .map((item: any) => `${item.name}(${item.status},${item.progress})`)
            .join('；')
        : '';
    const confusion = Array.isArray(learner.currentConfusionPoints)
      ? learner.currentConfusionPoints.slice(0, 6).join('；')
      : '';
    items.push({
      key: row.id,
      state: {
        学科: row.subject,
        主题: row.topic,
        任务: truncate(intent.taskTitle || row.topic || '', 200),
        本课知识点: knowledgeLine,
        本课总结: truncate(String(summary.knowledgeSummary || ''), 900),
        练习建议: truncate(String(summary.practiceAdvice || ''), 450),
        学习评估: truncate(String(summary.learningEvaluation || ''), 450),
        学习负荷: {
          理解度: learner.currentUnderstanding,
          情绪: learner.emotionalState,
          参与度: learner.engagement,
          困惑点: confusion,
          连续受挫: learner.frustratedStreak,
          lss: teachingState?.lss,
          ktl: teachingState?.ktl,
          lf: teachingState?.lf,
        },
      },
      gold: {
        shouldSuggest: typeof advisory?.shouldSuggest === 'boolean' ? advisory.shouldSuggest : null,
        recommendation: advisory?.recommendation || null,
        priority: advisory?.priority || null,
        reasonCodes: Array.isArray(advisory?.reasonCodes) ? advisory.reasonCodes : [],
      },
    });
  }
  db.close();
  return items;
}

// --------------------------------------------------------------------------
// 问题构造
// --------------------------------------------------------------------------

const COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;

const SIGNAL_QUESTIONS = (): Record<string, unknown> => ({
  understanding: {
    type: 'score',
    instructions: '最近一次学员发言表明，这位学员对当前知识点的理解程度如何？',
    criteria: ['完全没理解', '大部分没理解', '理解了一半', '基本理解', '理解透彻'],
  },
  cognitive_level: {
    type: 'choice',
    instructions: '最近一次学员发言体现的认知层级是什么？按发言里实际发生的思维活动判，不按任务标题判。',
    criteria: {
      remember: '记忆/复述：只重复事实、定义、步骤，没有加工',
      understand: '理解/解释：用自己的话说清含义、举例、翻译',
      apply: '应用/操作：把已学规则用到具体题目或操作上',
      analyze: '分析/归因：比较、区分、找差异、指出原因或条件',
      evaluate: '评价/判断：判断对错好坏并给依据，或做取舍',
      create: '创造/设计：提出新方案、自己构造例子或结构',
    },
  },
  emotional_state: {
    type: 'choice',
    instructions: '最近一次学员发言体现的情绪状态是什么？只按发言里的语气与措辞判。',
    criteria: {
      positive: '积极/有信心/有成就感',
      neutral: '平静/中性，没有明显情绪色彩',
      frustrated: '受挫/烦躁/沮丧/想放弃',
      confused: '困惑/迷茫/不知道从哪下手',
      bored: '无聊/走神/敷衍',
    },
  },
  load_index: {
    type: 'score',
    instructions: '这位学员当前的认知负荷有多高（信息量、步骤数、同时要考虑的条件）？',
    criteria: ['很轻松', '比较轻松', '适中', '有点吃力', '非常吃力'],
  },
  confusion_count: {
    type: 'score',
    instructions: '最近一次学员发言里，明确表达出的不同困惑点或误解有几个？',
    criteria: ['没有', '一个', '两个及以上'],
  },
});

const GOAL_QUESTIONS = (): Record<string, unknown> => ({
  primary_block_type: {
    type: 'choice',
    instructions: '这位学员真正的困难根因属于哪一类？按根因判，不按学员自己的归因或话题字面判。',
    criteria: {
      capability: '可迁移的概念或技能缺口：换个场景还会再遇到，需要建立新概念并多步练习',
      oneoff_operation: '一次性的具体操作或工具用法：学会点哪里、走哪一步就够，不会反复考',
      environment_tooling: '设备/软件/网络/配置本身有问题：把系统修好就解决，与会不会无关',
      permission_process: '账号/权限/审批/流程/交接/需要他人先行动：卡点在别人或制度上',
      emotion_relationship: '情绪/恐惧/面子/焦虑/人际冲突本身是主要阻塞：其实会做但不敢/不想',
    },
  },
  recurrence: {
    type: 'choice',
    instructions: '这个困难对这位学员来说是反复发生的，还是只此一次？',
    criteria: {
      once: '只发生过一次或明显是一次性事件，处理掉就不会再遇到',
      recurring: '反复发生、会再来（有每次/又/还是/一直/反复等线索，或情境本身必然重复）',
    },
  },
  support_need: {
    type: 'choice',
    instructions: '除了学习内容本身，这位学员是否还需要情绪支持或现实转介？',
    criteria: {
      none: '只需要学习路径与教学内容，不需要额外支持',
      emotional: '情绪调节、信心、焦虑本身需要先被处理，否则学不下去',
      referral: '需要现实世界的外部资源/专业帮助（法律、医疗、心理咨询、机构等），平台教不了',
    },
  },
  needs_material: {
    type: 'noul',
    instructions:
      '要真正达成这个学习目标，是否需要平台去网上检索/采集具体的外部资料（文章、教程、文档、题库）来组织课程？' +
      '需要具体、可引用、学员手上没有的材料给高概率；仅凭通用知识或学员自备资料就能组织课程给低概率。',
    criteria: {
      true: '需要具体外部资料才能组织课程',
      false: '通用知识与学员自备资料已经够用',
    },
  },
});

const MASTERY_QUESTIONS = (): Record<string, unknown> => ({
  status: {
    type: 'choice',
    instructions:
      '根据这节课堂的记录，这个知识点对这位学员处于什么状态？' +
      '判据只看记录里可观察到的表现，不按任务标题或教师评价的措辞抬档。',
    criteria: {
      mastered: '已掌握：学员独立、正确完成了该知识点的核心动作，且记录里有具体证据（答对/做出/说出依据）',
      learning: '学习中：接触并练习过，但仍有错误、需要提示，或只完成了部分要求',
      review: '需复习：以前学过或曾掌握，但本课未检核，或表现出遗忘/不稳定迹象',
      pending: '未开始/证据不足：本课没有涉及这个知识点，或记录不足以判断',
    },
  },
  progress: {
    type: 'score',
    instructions: '这个知识点目前的学习进度大概在哪个区间？',
    criteria: ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'],
  },
  observable_evidence: {
    type: 'noul',
    instructions:
      '课堂记录里是否有可观察的证据表明学员独立完成了这个知识点的核心动作？' +
      '有具体作答/产出/依据给高概率；只有教师讲解、学员附和或没有涉及给低概率。',
    criteria: {
      true: '有学员独立完成的具体证据',
      false: '没有可观察证据，或本课未涉及',
    },
  },
});

const ADVISORY_QUESTIONS = (): Record<string, unknown> => ({
  should_suggest: {
    type: 'noul',
    instructions:
      '基于这节真实课堂的表现，是否应该建议学习者调整后续路径安排（补强、重排、加速或减速）？' +
      '存在至少一个具体、可执行的调整理由，且不调整会影响后续推进，给高概率；' +
      '本课表现平稳、按原计划推进即可，给低概率。',
    criteria: {
      true: '有具体调整理由且不调整会影响后续',
      false: '表现平稳，按原计划推进即可',
    },
  },
  recommendation: {
    type: 'choice',
    instructions: '如果建议调整，最合适的动作是哪一种？',
    criteria: {
      keep: '保持原计划，不调整',
      reinforce: '补强：进入下一阶段前先补关键基础',
      resequence: '重排：保留目标，调整后续内容顺序',
      accelerate: '加速：减少重复，更快进入重点',
      slow_down: '减速：降低推进速度，先稳住当前内容',
    },
  },
  priority: {
    type: 'choice',
    instructions: '这条调整建议的优先级是什么？',
    criteria: {
      low: '可选，晚点处理也不影响',
      medium: '应该处理，但不紧急',
      high: '需要尽快处理，否则后续风险明显',
    },
  },
});

// --------------------------------------------------------------------------
// 单条运行
// --------------------------------------------------------------------------

interface RawRecord {
  channel: string;
  task: TaskName;
  key: string;
  ts: string;
  ms: number;
  attempts: number;
  httpStatus: number | null;
  error: string | null;
  gold: Record<string, unknown>;
  /** 落盘输入快照，便于离线复盘「是模型判错还是我们喂错了」。旧记录可能没有该字段。 */
  state?: Record<string, unknown>;
  config: { url: string; model: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 原始响应全量落盘
  response: any | null;
}

function appendRecord(file: string, record: RawRecord): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf-8');
}

function readRecords(file: string): RawRecord[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as RawRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is RawRecord => Boolean(record));
}

function answerOf(record: RawRecord, id: string): any {
  return record.response?.answers?.[id] || null;
}

function scoreOf(answer: any, levels: number): number | null {
  const raw = num(answer?.score);
  if (raw === null) return null;
  // 规范是 0..len-1 的期望分（jev/阿里云都是）。若通道的概率档位只有 0/1 而题目有更多档，
  // 说明它直接回了 0..1 归一化值，此时不再除。
  const keys = Object.keys(answer?.probabilities || {})
    .map(Number)
    .filter(Number.isFinite);
  const maxKey = keys.length ? Math.max(...keys) : null;
  if (maxKey !== null && maxKey <= 1 && levels > 2) return clamp01(raw);
  return clamp01(raw / Math.max(1, levels - 1));
}

function choiceOf(answer: any): string | null {
  return typeof answer?.choice === 'string' ? answer.choice : null;
}

function noulOf(answer: any): number | null {
  return num(answer?.noul);
}

// --------------------------------------------------------------------------
// 分析
// --------------------------------------------------------------------------

function analyzeSignals(records: RawRecord[]): Record<string, unknown> {
  const ok = records.filter((record) => record.response);
  const cognitiveOrder = new Map<string, number>(COGNITIVE_LEVELS.map((level, index) => [level, index]));

  let cognitiveExact = 0;
  let cognitiveAdjacent = 0;
  let cognitiveN = 0;
  let emotionalExact = 0;
  let emotionalN = 0;
  let understandingBucket = 0;
  let understandingN = 0;
  let loadBucket = 0;
  let loadN = 0;
  let confusionExact = 0;
  let confusionN = 0;
  const understandingPairs: Array<[number, number]> = [];
  const loadPairs: Array<[number, number]> = [];
  const cognitiveConfusion: Record<string, Record<string, number>> = {};
  const goldCognitive: string[] = [];
  const goldEmotional: string[] = [];
  const predCognitiveList: string[] = [];
  const predEmotionalList: string[] = [];
  let goldIntervention = 0;
  let predIntervention = 0;
  let stageFlips = 0;
  let stageN = 0;
  const flipDrivers: Record<string, number> = {};

  for (const record of ok) {
    const gold = record.gold as any;
    const predUnderstanding = scoreOf(answerOf(record, 'understanding'), 5);
    const predCognitive = choiceOf(answerOf(record, 'cognitive_level'));
    const predEmotional = choiceOf(answerOf(record, 'emotional_state'));
    const predLoad = scoreOf(answerOf(record, 'load_index'), 5);
    const predConfusion = scoreOf(answerOf(record, 'confusion_count'), 3);

    if (gold.cognitive && predCognitive) {
      cognitiveN += 1;
      goldCognitive.push(gold.cognitive);
      predCognitiveList.push(predCognitive);
      if (gold.cognitive === predCognitive) cognitiveExact += 1;
      const goldIndex = cognitiveOrder.get(gold.cognitive);
      const predIndex = cognitiveOrder.get(predCognitive);
      if (goldIndex !== undefined && predIndex !== undefined && Math.abs(goldIndex - predIndex) <= 1) {
        cognitiveAdjacent += 1;
      }
      cognitiveConfusion[gold.cognitive] = cognitiveConfusion[gold.cognitive] || {};
      cognitiveConfusion[gold.cognitive][predCognitive] =
        (cognitiveConfusion[gold.cognitive][predCognitive] || 0) + 1;
    }
    if (gold.emotional && predEmotional) {
      emotionalN += 1;
      goldEmotional.push(gold.emotional);
      predEmotionalList.push(predEmotional);
      if (gold.emotional === predEmotional) emotionalExact += 1;
    }
    if (gold.understanding !== null && predUnderstanding !== null) {
      understandingN += 1;
      understandingPairs.push([gold.understanding, predUnderstanding]);
      const goldBucket = Math.min(4, Math.round(gold.understanding * 4));
      const predBucket = Math.min(4, Math.round(predUnderstanding * 4));
      if (goldBucket === predBucket) understandingBucket += 1;
    }
    if (gold.load !== null && predLoad !== null) {
      loadN += 1;
      loadPairs.push([gold.load, predLoad]);
      const goldBucket = Math.min(4, Math.round(gold.load * 4));
      const predBucket = Math.min(4, Math.round(predLoad * 4));
      if (goldBucket === predBucket) loadBucket += 1;
    }
    if (gold.confusionCount !== null && predConfusion !== null) {
      confusionN += 1;
      // 金标 count>=2 归为 2 档
      const goldLevel = Math.min(2, gold.confusionCount);
      const predLevel = Math.min(2, Math.round(predConfusion * 2));
      if (goldLevel === predLevel) confusionExact += 1;
    }

    // 下游动作：把两套信号喂给同一个 determineNextStage 口径（简化版，去掉需要历史的 opening 分支）
    if (
      gold.understanding !== null &&
      predUnderstanding !== null &&
      gold.emotional &&
      predEmotional &&
      gold.load !== null &&
      predLoad !== null &&
      gold.confusionCount !== null &&
      predConfusion !== null
    ) {
      const predLevel = Math.min(2, Math.round(predConfusion * 2));
      const goldNeedsIntervention =
        gold.understanding < 0.35 ||
        gold.emotional === 'frustrated' ||
        gold.confusionCount >= 2 ||
        (gold.load > 0.85 && gold.understanding < 0.6);
      const predNeedsIntervention =
        predUnderstanding < 0.35 ||
        predEmotional === 'frustrated' ||
        predLevel >= 2 ||
        (predLoad > 0.85 && predUnderstanding < 0.6);
      if (goldNeedsIntervention) goldIntervention += 1;
      if (predNeedsIntervention) predIntervention += 1;
      stageN += 1;
      if (goldNeedsIntervention !== predNeedsIntervention) {
        stageFlips += 1;
        const driver =
          goldNeedsIntervention && !predNeedsIntervention
            ? `漏判:${gold.understanding < 0.35 ? 'understanding' : gold.emotional === 'frustrated' ? 'emotion' : gold.confusionCount >= 2 ? 'confusion' : 'load'}`
            : `误判:${predUnderstanding < 0.35 ? 'understanding' : predEmotional === 'frustrated' ? 'emotion' : predLevel >= 2 ? 'confusion' : 'load'}`;
        flipDrivers[driver] = (flipDrivers[driver] || 0) + 1;
      }
    }
  }

  return {
    n: records.length,
    ok: ok.length,
    failed: records.length - ok.length,
    latencyMs: mean(ok.map((record) => record.ms)),
    cognitive: {
      n: cognitiveN,
      exact: pct(cognitiveExact, cognitiveN),
      adjacent: pct(cognitiveAdjacent, cognitiveN),
      majority: majorityBaseline(goldCognitive),
      goldDistribution: Object.fromEntries(
        [...new Set(goldCognitive)].map((label) => [label, goldCognitive.filter((item) => item === label).length])
      ),
      predDistribution: Object.fromEntries(
        [...new Set(predCognitiveList)].map((label) => [label, predCognitiveList.filter((item) => item === label).length])
      ),
      confusion: cognitiveConfusion,
    },
    emotional: {
      n: emotionalN,
      exact: pct(emotionalExact, emotionalN),
      majority: majorityBaseline(goldEmotional),
      goldDistribution: Object.fromEntries(
        [...new Set(goldEmotional)].map((label) => [label, goldEmotional.filter((item) => item === label).length])
      ),
      predDistribution: Object.fromEntries(
        [...new Set(predEmotionalList)].map((label) => [label, predEmotionalList.filter((item) => item === label).length])
      ),
    },
    understanding: {
      n: understandingN,
      bucketExact: pct(understandingBucket, understandingN),
      majorityBucket: majorityBaseline(
        understandingPairs.map(([gold]) => String(Math.min(4, Math.round(gold * 4))))
      ),
      mae: mean(understandingPairs.map(([gold, pred]) => Math.abs(gold - pred))),
      meanBaselineMae: meanBaseline(understandingPairs),
      pearson: pearson(
        understandingPairs.map((pair) => pair[0]),
        understandingPairs.map((pair) => pair[1])
      ),
    },
    load: {
      n: loadN,
      bucketExact: pct(loadBucket, loadN),
      majorityBucket: majorityBaseline(loadPairs.map(([gold]) => String(Math.min(4, Math.round(gold * 4))))),
      mae: mean(loadPairs.map(([gold, pred]) => Math.abs(gold - pred))),
      meanBaselineMae: meanBaseline(loadPairs),
      pearson: pearson(
        loadPairs.map((pair) => pair[0]),
        loadPairs.map((pair) => pair[1])
      ),
    },
    confusion: { n: confusionN, exact: pct(confusionExact, confusionN) },
    downstreamStage: {
      n: stageN,
      goldInterventionRate: pct(goldIntervention, stageN),
      predInterventionRate: pct(predIntervention, stageN),
      flipRate: pct(stageFlips, stageN),
      flips: stageFlips,
      drivers: flipDrivers,
    },
  };
}

function analyzeGoal(records: RawRecord[]): Record<string, unknown> {
  const ok = records.filter((record) => record.response);
  let blockN = 0;
  let blockHit = 0;
  let recurrenceN = 0;
  let recurrenceHit = 0;
  let supportN = 0;
  let supportHit = 0;
  let materialN = 0;
  let materialHit = 0;
  const blockConfusion: Record<string, Record<string, number>> = {};
  const blockPred: Record<string, number> = {};
  const materialPred: Record<string, number> = {};
  const goldBlocks: string[] = [];
  const goldRecurrences: string[] = [];
  const goldSupports: string[] = [];
  const goldMaterials: string[] = [];

  for (const record of ok) {
    const gold = record.gold as any;
    const predBlock = choiceOf(answerOf(record, 'primary_block_type'));
    const predRecurrence = choiceOf(answerOf(record, 'recurrence'));
    const predSupport = choiceOf(answerOf(record, 'support_need'));
    const predMaterial = noulOf(answerOf(record, 'needs_material'));

    if (gold.block && predBlock) {
      blockN += 1;
      goldBlocks.push(gold.block);
      if (gold.block === predBlock) blockHit += 1;
      blockConfusion[gold.block] = blockConfusion[gold.block] || {};
      blockConfusion[gold.block][predBlock] = (blockConfusion[gold.block][predBlock] || 0) + 1;
      blockPred[predBlock] = (blockPred[predBlock] || 0) + 1;
    }
    if (gold.recurrence && predRecurrence) {
      recurrenceN += 1;
      goldRecurrences.push(gold.recurrence);
      if (gold.recurrence === predRecurrence) recurrenceHit += 1;
    }
    if (gold.supportNeed && predSupport) {
      supportN += 1;
      goldSupports.push(gold.supportNeed);
      if (gold.supportNeed === predSupport) supportHit += 1;
    }
    if (gold.needsMaterial !== null && predMaterial !== null) {
      materialN += 1;
      const predBoolean = predMaterial >= 0.5;
      goldMaterials.push(String(gold.needsMaterial));
      materialPred[String(predBoolean)] = (materialPred[String(predBoolean)] || 0) + 1;
      if (gold.needsMaterial === predBoolean) materialHit += 1;
    }
  }

  return {
    n: records.length,
    ok: ok.length,
    failed: records.length - ok.length,
    latencyMs: mean(ok.map((record) => record.ms)),
    block: {
      n: blockN,
      agreement: pct(blockHit, blockN),
      majority: majorityBaseline(goldBlocks),
      predDistribution: blockPred,
      confusion: blockConfusion,
    },
    recurrence: { n: recurrenceN, agreement: pct(recurrenceHit, recurrenceN), majority: majorityBaseline(goldRecurrences) },
    supportNeed: { n: supportN, agreement: pct(supportHit, supportN), majority: majorityBaseline(goldSupports) },
    needsMaterial: {
      n: materialN,
      agreement: pct(materialHit, materialN),
      majority: majorityBaseline(goldMaterials),
      predDistribution: materialPred,
    },
  };
}

function analyzeMastery(records: RawRecord[]): Record<string, unknown> {
  const ok = records.filter((record) => record.response);
  let statusN = 0;
  let statusHit = 0;
  let overClaim = 0;
  let underClaim = 0;
  let progressN = 0;
  const progressPairs: Array<[number, number]> = [];
  const confusion: Record<string, Record<string, number>> = {};
  const goldStatuses: string[] = [];
  const predDistribution: Record<string, number> = {};
  let evidenceN = 0;
  let evidenceTrue = 0;

  for (const record of ok) {
    const gold = record.gold as any;
    const predStatus = choiceOf(answerOf(record, 'status'));
    const predProgress = scoreOf(answerOf(record, 'progress'), 5);
    const evidence = noulOf(answerOf(record, 'observable_evidence'));

    if (gold.status && predStatus) {
      statusN += 1;
      goldStatuses.push(gold.status);
      if (gold.status === predStatus) statusHit += 1;
      if (predStatus === 'mastered' && gold.status !== 'mastered') overClaim += 1;
      if (gold.status === 'mastered' && predStatus !== 'mastered') underClaim += 1;
      confusion[gold.status] = confusion[gold.status] || {};
      confusion[gold.status][predStatus] = (confusion[gold.status][predStatus] || 0) + 1;
      predDistribution[predStatus] = (predDistribution[predStatus] || 0) + 1;
    }
    if (gold.progress !== null && predProgress !== null) {
      progressN += 1;
      progressPairs.push([gold.progress, predProgress * 100]);
    }
    if (evidence !== null) {
      evidenceN += 1;
      if (evidence >= 0.5) evidenceTrue += 1;
    }
  }

  return {
    n: records.length,
    ok: ok.length,
    failed: records.length - ok.length,
    latencyMs: mean(ok.map((record) => record.ms)),
    status: {
      n: statusN,
      agreement: pct(statusHit, statusN),
      majority: majorityBaseline(goldStatuses),
      predDistribution,
      overClaim: statusN ? pct(overClaim, statusN) : 'n/a',
      underClaim: statusN ? pct(underClaim, statusN) : 'n/a',
      confusion,
    },
    progress: {
      n: progressN,
      mae: mean(progressPairs.map(([gold, pred]) => Math.abs(gold - pred))),
      meanBaselineMae: meanBaseline(progressPairs),
      pearson: pearson(
        progressPairs.map((pair) => pair[0]),
        progressPairs.map((pair) => pair[1])
      ),
    },
    observableEvidence: { n: evidenceN, rate: pct(evidenceTrue, evidenceN) },
  };
}

function analyzeAdvisory(records: RawRecord[]): Record<string, unknown> {
  const ok = records.filter((record) => record.response);
  let shouldN = 0;
  let shouldTrue = 0;
  let recommendationN = 0;
  let recommendationHit = 0;
  let priorityN = 0;
  let priorityHit = 0;
  const recommendationConfusion: Record<string, Record<string, number>> = {};
  const predDistribution: Record<string, number> = {};
  const goldRecommendations: string[] = [];
  const goldPriorities: string[] = [];
  const abstainExamples: Array<{ key: string; should: number; gold: string | null; pred: string | null }> = [];

  for (const record of ok) {
    const gold = record.gold as any;
    const should = noulOf(answerOf(record, 'should_suggest'));
    const predRecommendation = choiceOf(answerOf(record, 'recommendation'));
    const predPriority = choiceOf(answerOf(record, 'priority'));
    if (should !== null) {
      shouldN += 1;
      if (should >= 0.5) shouldTrue += 1;
      else {
        abstainExamples.push({
          key: record.key,
          should,
          gold: gold.recommendation,
          pred: predRecommendation,
        });
      }
    }
    if (gold.recommendation && predRecommendation) {
      recommendationN += 1;
      goldRecommendations.push(gold.recommendation);
      if (gold.recommendation === predRecommendation) recommendationHit += 1;
      recommendationConfusion[gold.recommendation] = recommendationConfusion[gold.recommendation] || {};
      recommendationConfusion[gold.recommendation][predRecommendation] =
        (recommendationConfusion[gold.recommendation][predRecommendation] || 0) + 1;
      predDistribution[predRecommendation] = (predDistribution[predRecommendation] || 0) + 1;
    }
    if (gold.priority && predPriority) {
      priorityN += 1;
      goldPriorities.push(gold.priority);
      if (gold.priority === predPriority) priorityHit += 1;
    }
  }

  return {
    n: records.length,
    ok: ok.length,
    failed: records.length - ok.length,
    latencyMs: mean(ok.map((record) => record.ms)),
    shouldSuggest: {
      n: shouldN,
      modelSuggestRate: pct(shouldTrue, shouldN),
      goldSuggestRate: pct(
        ok.filter((record) => (record.gold as any).shouldSuggest === true).length,
        ok.filter((record) => typeof (record.gold as any).shouldSuggest === 'boolean').length
      ),
      abstainExamples: abstainExamples.slice(0, 12),
    },
    recommendation: {
      n: recommendationN,
      agreement: pct(recommendationHit, recommendationN),
      majority: majorityBaseline(goldRecommendations),
      predDistribution,
      confusion: recommendationConfusion,
    },
    priority: { n: priorityN, agreement: pct(priorityHit, priorityN), majority: majorityBaseline(goldPriorities) },
  };
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

async function runTask(task: TaskName, args: Args): Promise<void> {
  const file = path.join(args.out, `${task}.jsonl`);
  fs.mkdirSync(args.out, { recursive: true });
  const existing = new Set(readRecords(file).map((record) => record.key));

  const items: Array<{ key: string; state: Record<string, unknown>; gold: Record<string, unknown> }> =
    task === 'signals'
      ? loadSignalItems(args.limit)
      : task === 'goal'
        ? loadGoalItems(args.limit)
        : task === 'mastery'
          ? loadMasteryItems(args.limit, args.sample)
          : loadAdvisoryItems(args.limit);
  const pending = items.filter((item) => !existing.has(item.key));

  console.log(
    `[${task}] items=${items.length} pending=${pending.length} channel=${MODEL} url=${BASE_URL} out=${file}`
  );
  if (args.dryRun) {
    if (pending[0]) {
      const questions =
        task === 'signals'
          ? SIGNAL_QUESTIONS()
          : task === 'goal'
            ? GOAL_QUESTIONS()
            : task === 'mastery'
              ? MASTERY_QUESTIONS()
              : ADVISORY_QUESTIONS();
      console.log(JSON.stringify({ state: pending[0].state, questions }, null, 2).slice(0, 4000));
    }
    return;
  }

  let done = 0;
  await runPool(pending, args.concurrency, args.delay, async (item) => {
    const questions =
      task === 'signals'
        ? SIGNAL_QUESTIONS()
        : task === 'goal'
          ? GOAL_QUESTIONS()
          : task === 'mastery'
            ? MASTERY_QUESTIONS()
            : ADVISORY_QUESTIONS();
    const outcome = await callSystemOne({ state: item.state, questions }, args.retries);
    appendRecord(file, {
      channel: MODEL,
      task,
      key: item.key,
      ts: new Date().toISOString(),
      ms: outcome.ms,
      attempts: outcome.attempts,
      httpStatus: outcome.httpStatus,
      error: outcome.error,
      gold: item.gold,
      state: item.state,
      config: { url: BASE_URL, model: MODEL },
      response: outcome.response,
    });
    done += 1;
    if (done % 10 === 0 || done === pending.length) {
      console.log(`[${task}] ${done}/${pending.length}`);
    }
  });
}

function analyzeAll(args: Args): void {
  const files = fs.readdirSync(args.out, { withFileTypes: true }).filter((entry) => entry.isFile());
  for (const entry of files) {
    if (!entry.name.endsWith('.jsonl')) continue;
    const task = entry.name.replace('.jsonl', '') as TaskName;
    const records = readRecords(path.join(args.out, entry.name));
    if (records.length === 0) continue;
    const summary =
      task === 'signals'
        ? analyzeSignals(records)
        : task === 'goal'
          ? analyzeGoal(records)
          : task === 'mastery'
            ? analyzeMastery(records)
            : analyzeAdvisory(records);
    fs.writeFileSync(path.join(args.out, `summary-${task}.json`), JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`\n===== ${task} (${records.length} records) =====`);
    console.log(JSON.stringify(summary, null, 2));
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.analyze) {
    analyzeAll(args);
    return;
  }
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`数据库不存在：${DB_PATH}`);
  }
  const tasks: TaskName[] =
    args.task === 'all' ? ['signals', 'goal', 'mastery', 'advisory'] : [args.task];
  for (const task of tasks) {
    await runTask(task, args);
  }
}

main().catch((error) => {
  console.error('[wholeflow] 运行失败:', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
