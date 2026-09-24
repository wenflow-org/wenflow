/* eslint-disable no-console -- 一次性评测 CLI：面向人读的输出，不需要 logger */
/**
 * 评测 SystemOne（`jev-1.13-free`，经 OpenCode Zen 免费层）在**分诊双字段**上的表现（离线、不落库）。
 *
 * 为什么测这两个字段：
 *  - `primary_block_type`(5 类) 是 `response-triage.ts` 里 `triageByBlockType` 的**唯一开关**，
 *    单独翻它就能把结果在 learning_path / combination / emotional_support / referral 之间移动。
 *  - `recurrence`(once|recurring) 是**现有 LLM 已实证失败**的字段：`prompts/manifests/triage-judge.yaml`
 *    记录判据 v1 在 60 例上弃权率 32%、once 召回≈0。
 *
 * 公平性：与 `eval-triage-judge.ts` 完全对齐 —— 只给**用户可见文本**
 * （visibleOpening / triggerEvent+domain / background），不给 primaryBlockType / recurrence /
 * hiddenDetails 标注，因此两者可比。
 *
 * ⚠️ 金标是生成虚拟学员案例时一并写出的（非真人标注）。此处度量的是「与案例生成器是否一致」，
 * 不是「是否正确」——它封死了结论强度，读数字时请带着这一条。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/eval-systemone-triage.ts             # 全 60 例
 *   npx ts-node --transpile-only src/scripts/eval-systemone-triage.ts --limit=5   # 先跑通链路
 *   npx ts-node --transpile-only src/scripts/eval-systemone-triage.ts --delay=1500
 *
 * 外部端点与凭证走环境变量，**凭证不写进代码**：
 *   SYSTEMONE_BASE_URL  默认 https://opencode.ai/zen/v1/systemone
 *   SYSTEMONE_API_KEY   默认 public（OpenCode Zen 匿名凭证）
 *   SYSTEMONE_MODEL     默认 jev-1.13-free
 *
 * 注意：该免费层是无文档的共享额度，随时可能变化。本脚本只作离线评测，**不要**接到生产链路
 * （实测延迟 1.8–4s 且由队列抖动主导，不适合同步路径）。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PRIMARY_BLOCK_TYPES, type PrimaryBlockType } from '../services/learning/response-triage';

const CASE_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'vl-persona-mixed-2026-09-21', 'cases');
const BASE_URL = process.env.SYSTEMONE_BASE_URL || 'https://opencode.ai/zen/v1/systemone';
const API_KEY = process.env.SYSTEMONE_API_KEY || 'public';
const MODEL = process.env.SYSTEMONE_MODEL || 'jev-1.13-free';

/** 直接沿用 response-triage.ts 头部对五类阻塞的权威定义，避免口径漂移。 */
const BLOCK_CRITERIA: Record<PrimaryBlockType, { description: string }> = {
  capability: { description: '存在可迁移的概念/技能缺口，需要建认知结构 + 多步练习（换个场景还会再遇到）' },
  oneoff_operation: { description: '一次性具体操作或工具用法，学会点哪里即可' },
  environment_tooling: { description: '设备/软件/网络/配置/环境阻塞，修好系统即可' },
  permission_process: { description: '账号/权限/审批/流程/交接/他人配合阻塞' },
  emotion_relationship: { description: '情绪调节/恐惧/面子/焦虑/人际冲突是主要阻塞' },
};

const RECURRENCE_CRITERIA = {
  once: { description: '这件事只发生过一次，是孤立事件，处理掉就不会再遇到' },
  recurring: { description: '这件事反复发生、会再来（有"每次/又/还是/一直/反复"等线索，或情境本身就必然重复）' },
};

const BLOCK_SET = new Set<string>(PRIMARY_BLOCK_TYPES);

/**
 * 两套 block_type 指令，用来分离「模型不会判」与「我的指令把模型带偏了」。
 *  - biased：我原先写的版本，含"字面在问操作、但背后是能力缺口时判 capability"——
 *    而本批语料的原话大量是"我是不是太笨/基础太差/我哪会啊"这种自我归因，该句可能放大 capability。
 *  - neutral：只要求按根因判、不按学员自己的描述判，不指向任何一类。
 */
const BLOCK_INSTRUCTIONS: Record<string, string> = {
  biased:
    '按根因判，不要按字面话题判。字面在问某个操作、但背后是反复遇到的能力缺口时判 capability；' +
    '只有在"别人不给权限/要走流程/需要他人配合"时才判 permission_process；' +
    '只有在"设备或软件环境坏了、修好就行"时才判 environment_tooling。',
  neutral: '判断这一困难真正的来源是根因，而不是学员自己把它归因成了什么。',
};

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface CaseRow {
  file: string;
  name: string;
  request: string;
  context: string;
  background: string;
  labelBlock: string;
  labelRecurrence: string;
}

/** 与 eval-triage-judge.ts 取同一批字段，保证两套判据可比。 */
function loadCases(limit: number): CaseRow[] {
  const files = fs.readdirSync(CASE_DIR).filter((f) => f.endsWith('.json')).sort();
  const rows: CaseRow[] = [];
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(CASE_DIR, file), 'utf-8'));
    const spec = raw.spec || {};
    const story = (raw.record || {}).story || {};
    rows.push({
      file,
      name: spec.name || file,
      request: String(story.visibleOpening || spec.goalHint || '').trim(),
      context: [story.triggerEvent, spec.domain].filter(Boolean).join(' / '),
      background: String(spec.background || '').trim(),
      labelBlock: String(story.primaryBlockType || '?'),
      labelRecurrence: String(story.recurrence || '?'),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}
interface NoulAnswer {
  type: 'noul';
  noul: number;
}
type Answer = ChoiceAnswer | NoulAnswer;

interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
  cost?: string;
}

function buildRequest(row: CaseRow, variant: string) {
  return {
    // SystemOne 的槽位是「一个 state × 若干并行问题」；问题 id 不下发模型，语义必须写进 question。
    state: { 学员原话: row.request, 情境: row.context, 背景: row.background },
    questions: {
      block_type: {
        type: 'choice',
        question: '这位学员陈述的困难，根因属于哪一类？',
        criteria: BLOCK_CRITERIA,
        instructions: BLOCK_INSTRUCTIONS[variant] ?? BLOCK_INSTRUCTIONS.neutral,
      },
      recurrence: {
        type: 'choice',
        question: '这个困难对这位学员来说是反复发生的，还是只此一次？',
        criteria: RECURRENCE_CRITERIA,
        instructions: '注意有的情境天生会重复（每天都要做的事），即使原话没说"每次"。',
      },
      recurrence_noul: {
        type: 'noul',
        question: '这位学员的困难是否属于"反复发生、会再来"的情形？',
        instructions: '反复发生、会再来给高概率；孤立的一次性事件给低概率。',
      },
      freq_cue: {
        type: 'noul',
        question: '原话里是否出现了明确的复现或频次措辞（例如 每次、又、还是、一直、老、反复、第几次、X 周了）？',
        instructions: '只要字面上有这类词就给高概率；纯叙述单次事件给低概率。',
      },
    },
  };
}

async function callSystemOne(body: unknown): Promise<SystemOneResponse> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, ...(body as object) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text) as SystemOneResponse;
}

interface Scored {
  name: string;
  goldBlock: string;
  predBlock: string;
  blockConf: number;
  goldOnce: boolean;
  predOnce: boolean;
  noulRecurring: number;
  freqCue: number;
  ms: number;
  tokens: { input_tokens: number; output_tokens: number } | null;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`;
}

/** 五类混淆矩阵：行=金标，列=模型。 */
function confusionMatrix(rows: Scored[]): Record<string, Record<string, number>> {
  const table: Record<string, Record<string, number>> = {};
  for (const gold of [...PRIMARY_BLOCK_TYPES, '?']) {
    const line: Record<string, number> = {};
    for (const pred of [...PRIMARY_BLOCK_TYPES, 'other']) line[pred] = 0;
    table[gold] = line;
  }
  for (const r of rows) {
    const pred = BLOCK_SET.has(r.predBlock) ? r.predBlock : 'other';
    const gold = table[r.goldBlock] ? r.goldBlock : '?';
    table[gold][pred] += 1;
  }
  return table;
}

function perClass(rows: Scored[]) {
  return PRIMARY_BLOCK_TYPES.map((label) => {
    const tp = rows.filter((r) => r.goldBlock === label && r.predBlock === label).length;
    const fp = rows.filter((r) => r.goldBlock !== label && r.predBlock === label).length;
    const fn = rows.filter((r) => r.goldBlock === label && r.predBlock !== label).length;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return {
      类别: label,
      金标数: tp + fn,
      正确: tp,
      精确率: pct(tp, tp + fp),
      召回率: pct(tp, tp + fn),
      F1: f1.toFixed(2),
    };
  });
}

async function main(): Promise<void> {
  const limit = Number(arg('limit', '60')) || 60;
  const delayMs = Number(arg('delay', '1000'));
  const variant = arg('variant', 'biased');
  const rows = loadCases(limit);

  console.log(`[systemone-eval] ${rows.length} 例 | model=${MODEL} | variant=${variant} | ${BASE_URL}`);
  console.log('[systemone-eval] 只喂用户可见文本（与 eval-triage-judge 对齐）；金标=case 自带标注，非真人标注\n');

  const scored: Scored[] = [];
  const failures: Array<{ name: string; error: string }> = [];

  for (const [index, row] of rows.entries()) {
    const started = Date.now();
    try {
      const response = await callSystemOne(buildRequest(row, variant));
      const ms = Date.now() - started;
      const answers = response.answers || {};
      const block = answers.block_type as ChoiceAnswer | undefined;
      const recurrence = answers.recurrence as ChoiceAnswer | undefined;
      const noul = answers.recurrence_noul as NoulAnswer | undefined;
      const cue = answers.freq_cue as NoulAnswer | undefined;

      scored.push({
        name: row.name,
        goldBlock: row.labelBlock,
        predBlock: String(block?.choice ?? 'other'),
        blockConf: Number(block?.confidence ?? 0),
        goldOnce: row.labelRecurrence === 'once',
        predOnce: String(recurrence?.choice ?? 'recurring') === 'once',
        noulRecurring: Number(noul?.noul ?? 0),
        freqCue: Number(cue?.noul ?? 0),
        ms,
        tokens: response.usage ?? null,
      });
      const mark = block?.choice === row.labelBlock ? '✓' : '✗';
      console.log(
        `  [${index + 1}/${rows.length}] ${mark} ${row.name.padEnd(5)} ` +
          `金标[${row.labelBlock}·${row.labelRecurrence}] → ` +
          `${String(block?.choice)}(${Number(block?.confidence ?? 0).toFixed(2)}) ` +
          `rec=${String(recurrence?.choice)} noul=${Number(noul?.noul ?? 0).toFixed(2)} ${ms}ms`
      );
    } catch (error) {
      failures.push({ name: row.name, error: String((error as Error)?.message || error).slice(0, 120) });
      console.log(`  [${index + 1}/${rows.length}] ✗ ${row.name}：${String((error as Error)?.message || error).slice(0, 90)}`);
    }
    if (index < rows.length - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  const n = scored.length;
  if (n === 0) {
    console.error('\n[systemone-eval] 没有一例成功，无法计分');
    process.exitCode = 1;
    return;
  }

  // ---------- primary_block_type ----------
  const blockHit = scored.filter((s) => s.goldBlock === s.predBlock).length;
  console.log(`\n=== primary_block_type（${n} 例）===`);
  console.log(
    JSON.stringify(
      {
        准确率: `${blockHit}/${n} = ${pct(blockHit, n)}`,
        多数类基线: `${pct(Math.max(...PRIMARY_BLOCK_TYPES.map((l) => scored.filter((s) => s.goldBlock === l).length)), n)}（全判 emotion_relationship）`,
        解析失败: failures.length,
        平均置信度: (scored.reduce((a, s) => a + s.blockConf, 0) / n).toFixed(2),
      },
      null,
      1
    )
  );
  console.table(confusionMatrix(scored));
  console.table(perClass(scored));

  // ---------- recurrence ----------
  const goldOnce = scored.filter((s) => s.goldOnce).length;
  const choiceOnceHit = scored.filter((s) => s.goldOnce === s.predOnce).length;
  const predOnceCount = scored.filter((s) => s.predOnce).length;
  const noulPredOnce = (s: Scored) => s.noulRecurring < 0.5;
  const noulOnceHit = scored.filter((s) => s.goldOnce === noulPredOnce(s)).length;
  const cueOnceHit = scored.filter((s) => s.goldOnce === s.freqCue < 0.5).length;
  const onceRecall = (pred: (s: Scored) => boolean) => {
    const tp = scored.filter((s) => s.goldOnce && pred(s)).length;
    return `${tp}/${goldOnce} = ${pct(tp, goldOnce)}`;
  };

  console.log(`\n=== recurrence（金标 once ${goldOnce} / recurring ${n - goldOnce}）===`);
  console.table([
    {
      判据: '多数类基线（全判 recurring）',
      准确率: pct(n - goldOnce, n),
      'once 召回': '0/' + goldOnce + ' = 0%',
    },
    {
      判据: 'SystemOne choice',
      准确率: `${choiceOnceHit}/${n} = ${pct(choiceOnceHit, n)}`,
      'once 召回': onceRecall((s) => s.predOnce),
      判出once数: predOnceCount,
    },
    {
      判据: 'SystemOne noul<0.5',
      准确率: `${noulOnceHit}/${n} = ${pct(noulOnceHit, n)}`,
      'once 召回': onceRecall(noulPredOnce),
      判出once数: scored.filter(noulPredOnce).length,
    },
    {
      判据: 'freq_cue noul<0.5（仅表面措辞）',
      准确率: `${cueOnceHit}/${n} = ${pct(cueOnceHit, n)}`,
      'once 召回': onceRecall((s) => s.freqCue < 0.5),
      判出once数: scored.filter((s) => s.freqCue < 0.5).length,
    },
  ]);

  // ---------- 延迟 / 用量 ----------
  const latencies = scored.map((s) => s.ms);
  const tokens = scored.reduce(
    (a, s) => ({ input: a.input + (s.tokens?.input_tokens ?? 0), output: a.output + (s.tokens?.output_tokens ?? 0) }),
    { input: 0, output: 0 }
  );
  console.log('\n=== 延迟与用量 ===');
  console.log(
    JSON.stringify(
      {
        延迟ms: { p50: percentile(latencies, 50), p90: percentile(latencies, 90), max: Math.max(...latencies) },
        tokens: { ...tokens, 每例: Math.round(tokens.input / n) },
        cost: '0（免费层）',
      },
      null,
      1
    )
  );

  // ---------- 分歧清单（人工判读用）----------
  const blockMiss = scored.filter((s) => s.goldBlock !== s.predBlock);
  console.log(`\n=== primary_block_type 分歧 ${blockMiss.length} 例（含模型自陈置信度，需人工判读是模型错还是金标可疑）===`);
  for (const s of blockMiss) {
    console.log(`  ${s.name.padEnd(5)} 金标[${s.goldBlock}] → 模型[${s.predBlock}] conf=${s.blockConf.toFixed(2)}`);
  }

  const recMiss = scored.filter((s) => s.goldOnce !== s.predOnce);
  console.log(`\n=== recurrence 分歧 ${recMiss.length} 例（choice 判错；附 noul 与表面措辞探针）===`);
  for (const s of recMiss) {
    console.log(
      `  ${s.name.padEnd(5)} 金标[${s.goldOnce ? 'once' : 'recurring'}] → choice[${s.predOnce ? 'once' : 'recurring'}] ` +
        `noul=${s.noulRecurring.toFixed(2)} freqCue=${s.freqCue.toFixed(2)}`
    );
  }
}

void main().catch((error) => {
  console.error('[systemone-eval] 失败', error);
  process.exitCode = 1;
});
