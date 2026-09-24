/* eslint-disable no-console -- 一次性评测 CLI：面向人读的输出，不需要 logger */
/**
 * 评测 SystemOne（`jev-1.13-free`，经 OpenCode Zen 免费层）在教学回合的**学生认知评估**三字段上
 * 与生产管线的一致性（离线、不落库、不写 DB）。
 *
 * 判断对象 = 仓库真实 teaching_session_messages 里的（老师上一句 → 学员本轮发言）对，
 * 金标 = 生产 teaching-turn 调用在同一轮写入的 analysis 字段：
 *   - cognitiveLevel        （48% 六层布鲁姆：remember|understand|apply|analyze|evaluate|create）
 *   - selfAssessmentSignal  （high|medium|low，生产 prompt 明确"只从学生自然语言中静默提取"）
 *   - emotionalState        （positive|neutral|frustrated|confused|bored）
 *
 * 注意口径：金标是"生产模型自己的判断"，不是真值。对 selfAssessmentSignal / emotionalState
 * 这类以发言本身为输入的字段，一致性近似可比；cognitiveLevel 生产侧见过完整上下文，一致性会被低估。
 *
 * 第二个工况（--mode=checkpoint）：26 条生产库里真实回收的**简答型理解检查**（问题+学员作答+
 * 期望要点），生产侧用关键词包含判定（已知对措辞敏感、系统性低估，见 teaching-checkpoint.ts:188-196
 * 与 independent-success-band.service.ts:14），金标 = 生产判定（全部 failed）。测 SystemOne
 * 语义判分是否给出不同结论，分歧由人判读。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/eval-systemone-cognition.ts --mode=sample
 *   npx ts-node --transpile-only src/scripts/eval-systemone-cognition.ts --mode=checkpoint
 *
 * 样本文件（--sample / --checkpoint）默认取 os.tmpdir() 下的 json，由另一个只读抽取步骤生成；
 * 端点与凭证走环境变量，凭证不写进代码：
 *   SYSTEMONE_BASE_URL  默认 https://opencode.ai/zen/v1/systemone
 *   SYSTEMONE_API_KEY   默认 public
 *   SYSTEMONE_MODEL     默认 jev-1.13-free
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE_URL = process.env.SYSTEMONE_BASE_URL || 'https://opencode.ai/zen/v1/systemone';
const API_KEY = process.env.SYSTEMONE_API_KEY || 'public';
const MODEL = process.env.SYSTEMONE_MODEL || 'jev-1.13-free';

const COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;
const SELF_SIGNALS = ['high', 'medium', 'low'] as const;
const EMOTION_STATES = ['positive', 'neutral', 'frustrated', 'confused', 'bored'] as const;

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface SampleEntry {
  id: string;
  teacher: string;
  learner: string;
  gold: {
    cognitiveLevel?: string;
    selfAssessmentSignal?: string | null;
    emotionalState?: string;
  };
}

interface CheckpointEntry {
  id: string;
  question: string;
  answer: string;
  expectedKeywords: string[];
}

interface ChoiceAnswer { type: 'choice'; choice: string; confidence?: number }
type Answer = ChoiceAnswer | { type: 'noul'; noul: number };

async function callSystemOne(body: unknown): Promise<{ answers: Record<string, Answer> }> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, ...(body as object) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text) as { answers: Record<string, Answer> };
}

/** 中性指令：只给定义、不加许可性从句、不用例子引导到某一类（吸取调参教训）。 */
function buildSampleRequest(e: SampleEntry) {
  return {
    state: { 老师刚才的问题: (e.teacher || '').slice(0, 300), 学员本轮发言: (e.learner || '').slice(0, 300) },
    questions: {
      cognitive_level: {
        type: 'choice',
        question: '学员在本轮发言里实际展现的是哪个认知层级？',
        criteria: {
          remember: '复述、回忆事实、定义或已有结论',
          understand: '用自己的话解释、总结、举例，说明弄懂了含义',
          apply: '把方法或规则用到具体题目、事例上',
          analyze: '拆解结构、定位关系、找出因果或组成部分',
          evaluate: '对说法或方案作判断、权衡利弊、给出评价依据',
          create: '提出新方案、新表述，或重构框架',
        },
        instructions: '依据学员本轮发言本身判断其实际展现的思维深度，不因任务类型预设层级。',
      },
      self_signal: {
        type: 'choice',
        question: '学员这句话里流露的自我评估信号是哪一个？',
        criteria: {
          high: '明确表达自信、懂了、会了（例如"这个简单""我懂了""原来如此"）',
          medium: '没有明确的自信或挫败信号',
          low: '明确表达不会、听不懂、没思路、卡住了',
        },
        instructions: '只从学员这句话里找信号；没有明确信号时选 medium。',
      },
      emotion: {
        type: 'choice',
        question: '学员这句话的情绪状态是哪一个？',
        criteria: {
          positive: '积极、有获得感',
          neutral: '平淡、无明显情绪',
          frustrated: '挫败、烦躁、受打击',
          confused: '困惑、迷糊、理不清',
          bored: '无聊、厌倦、应付',
        },
        instructions: '依据措辞与语气线索判断；没有线索时选 neutral。',
      },
    },
  };
}

function buildCheckpointRequest(c: CheckpointEntry) {
  return {
    state: {
      问题: (c.question || '').slice(0, 300),
      学员作答: (c.answer || '').slice(0, 300),
      期望要点: c.expectedKeywords.join('、'),
    },
    questions: {
      grade: {
        type: 'choice',
        question: '学员的作答是否已经达到这道理解检查的全部要点？',
        criteria: {
          passed: '作答在语义上覆盖了全部要点（不要求逐字出现）',
          failed: '明确缺失至少一个要点',
          uncertain: '作答太短或无法判断',
        },
        instructions: '要点没有逐字出现但语义等价也算达到；不要因为措辞不同而判失败；只要缺失任何一个要点就判 failed。',
      },
    },
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function runSample(entries: SampleEntry[], delayMs: number): Promise<void> {
  const scored: Array<SampleEntry['gold'] & { id: string; pred: Record<string, string>; ms: number; conf: number }> = [];
  const failures: string[] = [];

  for (const [index, e] of entries.entries()) {
    const started = Date.now();
    try {
      const { answers } = await callSystemOne(buildSampleRequest(e));
      const ms = Date.now() - started;
      const grade = answers.cognitive_level as ChoiceAnswer;
      const conf = Number(grade.confidence ?? 0);
      scored.push({
        id: e.id,
        cognitiveLevel: e.gold.cognitiveLevel, selfAssessmentSignal: e.gold.selfAssessmentSignal ?? '',
        emotionalState: e.gold.emotionalState,
        pred: {
          cognitive_level: String(grade?.choice ?? ''),
          self_signal: String((answers.self_signal as ChoiceAnswer)?.choice ?? ''),
          emotion: String((answers.emotion as ChoiceAnswer)?.choice ?? ''),
        },
        ms, conf,
      });
      const mark = grade?.choice === e.gold.cognitiveLevel ? '✓' : '✗';
      console.log(`  [${index + 1}/${entries.length}] ${mark} ${e.id} 金标[${e.gold.cognitiveLevel}/${e.gold.selfAssessmentSignal ?? '-'}/${e.gold.emotionalState}] → [${grade?.choice}/${(answers.self_signal as ChoiceAnswer)?.choice}/${(answers.emotion as ChoiceAnswer)?.choice}] ${ms}ms`);
    } catch (error) {
      failures.push(`${e.id}: ${String((error as Error)?.message || error).slice(0, 80)}`);
    }
    if (index < entries.length - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  const n = scored.length;
  const agree = (field: string, predKey: string, goldKey: string) => {
    const hit = scored.filter((s) => (s as unknown as Record<string, string>)[goldKey] &&
      (s as unknown as Record<string, string>)[goldKey] === s.pred[predKey]).length;
    return `${hit}/${scored.filter((s) => (s as unknown as Record<string, string>)[goldKey]).length} = ${pct(hit, scored.filter((s) => (s as unknown as Record<string, string>)[goldKey]).length)}`;
  };

  console.log(`\n=== 三字段与生产管线一致性（${n} 例真实师生回合）===`);
  console.log(JSON.stringify({
    cognitiveLevel: agree('cognitiveLevel', 'cognitive_level', 'cognitiveLevel'),
    selfAssessmentSignal: agree('selfAssessmentSignal', 'self_signal', 'selfAssessmentSignal'),
    emotionalState: agree('emotionalState', 'emotion', 'emotionalState'),
    请求失败: failures.length,
  }, null, 1));

  // cognitiveLevel 混淆矩阵
  const table: Record<string, Record<string, number>> = {};
  for (const g of [...COGNITIVE_LEVELS, '?']) { table[g] = {}; for (const p of [...COGNITIVE_LEVELS, 'other']) table[g][p] = 0; }
  for (const s of scored) {
    const g = table[s.cognitiveLevel || '?'] ? (s.cognitiveLevel || '?') : '?';
    const p = COGNITIVE_LEVELS.includes((s.pred.cognitive_level || '') as never) ? s.pred.cognitive_level : 'other';
    table[g][p] += 1;
  }
  console.log('\n=== cognitiveLevel 混淆（行=生产管线的判断，列=SystemOne）===');
  console.table(table);

  const sigTable: Record<string, Record<string, number>> = {};
  for (const g of [...SELF_SIGNALS, '?']) { sigTable[g] = {}; for (const p of [...SELF_SIGNALS, 'other']) sigTable[g][p] = 0; }
  const emoTable: Record<string, Record<string, number>> = {};
  for (const g of [...EMOTION_STATES, '?']) { emoTable[g] = {}; for (const p of [...EMOTION_STATES, 'other']) emoTable[g][p] = 0; }
  for (const s of scored) {
    const sg = s.selfAssessmentSignal && sigTable[s.selfAssessmentSignal] ? s.selfAssessmentSignal : '?';
    const sp = SELF_SIGNALS.includes((s.pred.self_signal || '') as never) ? s.pred.self_signal : 'other';
    sigTable[sg][sp] += 1;
    const eg = s.emotionalState && emoTable[s.emotionalState] ? s.emotionalState : '?';
    const ep = EMOTION_STATES.includes((s.pred.emotion || '') as never) ? s.pred.emotion : 'other';
    emoTable[eg][ep] += 1;
  }
  console.log('\n=== selfAssessmentSignal 混淆（行=生产，列=SystemOne）===');
  console.table(sigTable);
  console.log('\n=== emotionalState 混淆（行=生产，列=SystemOne）===');
  console.table(emoTable);

  const lat = scored.map((s) => s.ms);
  console.log(JSON.stringify({ 延迟ms: { p50: percentile(lat, 50), p90: percentile(lat, 90), max: Math.max(...lat) } }));

  const miss = scored.filter((s) => s.cognitiveLevel && s.cognitiveLevel !== s.pred.cognitive_level);
  console.log(`\n=== cognitiveLevel 分歧 ${miss.length} 例（供人工判读：是 SystemOne 错、生产错、还是两者都有理）===`);
  for (const s of miss) {
    const e = entries.find((x) => x.id === s.id);
    console.log(`\n  ${s.id} 生产[${s.cognitiveLevel}] → SystemOne[${s.pred.cognitive_level}] conf=${s.conf.toFixed(2)}`);
    console.log(`    老师: ${(e?.teacher || '').slice(0, 90)}`);
    console.log(`    学员: ${(e?.learner || '').slice(0, 90)}`);
  }
}

async function runCheckpoint(entries: CheckpointEntry[], delayMs: number): Promise<void> {
  const results: Array<{ id: string; pred: string; conf: number }> = [];
  for (const [index, c] of entries.entries()) {
    try {
      const { answers } = await callSystemOne(buildCheckpointRequest(c));
      const grade = answers.grade as ChoiceAnswer;
      results.push({
        id: c.id,
        pred: String(grade?.choice ?? ''),
        conf: Number(grade?.confidence ?? 0),
      });
      console.log(`  [${index + 1}/${entries.length}] ${String(grade?.choice)} conf=${Number(grade?.confidence ?? 0).toFixed(2)} | ${c.id} | ${(c.answer || '').slice(0, 50)}`);
    } catch (error) {
      console.log(`  [${index + 1}/${entries.length}] ✗ ${c.id}: ${String((error as Error)?.message || error).slice(0, 80)}`);
    }
    if (index < entries.length - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  const valid = results.filter((r) => r.pred === 'passed' || r.pred === 'failed');
  const passed = valid.filter((r) => r.pred === 'passed').length;
  console.log(`\n=== 简答型理解检查：SystemOne 语义判分 vs 生产关键词判定 ===`);
  console.log(JSON.stringify({
    样本: valid.length,
    生产判定: `全部 failed（关键词包含，13 条证据全部未过）`,
    SystemOne: `passed ${passed} / failed ${valid.length - passed}（uncertain ${results.length - valid.length} 条除外）`,
  }, null, 1));
  console.log('（分歧逐条见上，需人工判读谁对；预期里面含"变简单了/重新核对/沿用旧符号"等语义等价回答）');
}

function loadJson<T>(file: string): T[] {
  if (!fs.existsSync(file)) {
    console.error(`找不到样本文件: ${file}（先跑生成步骤）`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T[];
}

async function main(): Promise<void> {
  const mode = arg('mode', 'sample');
  const delayMs = Number(arg('delay', '300'));
  const tmp = os.tmpdir();
  const sampleFile = arg('sample', path.join(tmp, 'cognition-sample.json'));
  const checkpointFile = arg('checkpoint', path.join(tmp, 'checkpoint-sa.json'));

  console.log(`[systemone-cognition] model=${MODEL} | ${BASE_URL}`);
  if (mode === 'sample' || mode === 'all') await runSample(loadJson<SampleEntry>(sampleFile), delayMs);
  if (mode === 'checkpoint' || mode === 'all') await runCheckpoint(loadJson<CheckpointEntry>(checkpointFile), delayMs);
}

void main().catch((error) => {
  console.error('[systemone-cognition] 失败', error);
  process.exitCode = 1;
});