/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性只读探针 */
/**
 * 教学策略「死板机械」实测探针 —— 目标对话段（真调 LLM，不 mock）。
 *
 * 为什么另起一个：`probe-goal-chip-vs-confirm.ts` 只判「快选与确认同屏」，本探针判的是
 * 用户走查里真正让人难受的四件事，且用**本案真实的 7 轮用户原话**复现：
 *
 *   1. 复读：同一套「时间轴 / 角色地图 / 骨架」方案在多个 AI 回合里被重讲
 *      （本案实测 6 个 AI 回合里 6 次）。
 *   2. 意图改写：用户 surface_goal 写的是「学习最新的 AI 教育知识」，提案却写成「不追新闻热点」，
 *      路径随即全给老黄历 → 用户触发重排「没有最新的资讯啊」。
 *   3. 手段当目的：first_deliverable 强制「一份自己讲得出来的骨架 / 讲述稿 / 复述」，
 *      对纯兴趣用户是劝退项。
 *   4. 确认割裂：用户说「可以，就按这个方向走」，AI 回「我这边不能替你按」。

 * 用法：
 *   npx ts-node --transpile-only src/scripts/probe-teaching-strategy-deslop.ts
 *   REPEATS=2 npx ts-node --transpile-only src/scripts/probe-teaching-strategy-deslop.ts
 *   ONLY=interest npx ts-node --transpile-only src/scripts/probe-teaching-strategy-deslop.ts
 *
 * 输出末尾一行机器可读摘要（供 before/after 对比）：
 *   RESULT scenario=... repeats=... skeletonTurns=..  intentOverride=../..  artifactDeliverable=../..  confirmRefusalTurns=../..  readyReached=../..
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { executeSkill } from '../skills';
import { goalConversationAgentDefinition } from '../skills/goal-conversation';

interface Scenario {
  id: string;
  name: string;
  /** 用户逐轮原话（interest 组取自 lp_1793957582347_jm6v754 的真实目标会话） */
  turns: string[];
  /** 最后一轮是否模拟界面确认按钮 */
  finalConfirm: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'interest',
    name: '兴趣通识 · 本案原话复现',
    turns: [
      '学习最新的ai教育知识',
      '纯兴趣，想搞明白 AI 和教育到底怎么回事',
      '看过一些文章、听过一些说法，但不成体系，也想系统知道发展演变脉络',
      '说不好，有空就看',
      '想连教育理论一起铺',
      '可以，就按这个方向走',
      '可以',
    ],
    finalConfirm: true,
  },
  {
    id: 'exam',
    name: '应试型 · 防回归对照',
    turns: [
      '我要考 CPA 会计 审计 税法三科，今年 8 月考',
      '零基础，在职，每天能学一个半小时，周末能多些',
      '之前没考过，今年第一次',
      '可以，就按这个方向走',
    ],
    finalConfirm: true,
  },
  {
    id: 'confirm-nl',
    name: '兴趣通识 · 白名单外的自然语言确认（决定白名单是否已冗余）',
    // 末句刻意落在 CONFIRM_SEGMENT_PATTERNS 全部 pattern 之外、且不带 UI 标志（finalConfirm=false）：
    // 若模型仍能把会话推进到 ready，说明白名单对正确性已冗余（只剩省一次模型回合的价值），可退成极窄几项或删除；
    // 若卡住/出现「我按不了」类话术，说明必须先让模型判意图，白名单才能退。
    turns: [
      '学习最新的ai教育知识',
      '纯兴趣，想搞明白 AI 和教育到底怎么回事',
      '看过一些文章、听过一些说法，但不成体系，也想系统知道发展演变脉络',
      '说不好，有空就看',
      '想连教育理论一起铺',
      '行，就照你说的办',
    ],
    finalConfirm: false,
  },
];

/** 「骨架三件套」关键词：命中 ≥2 个即视为本轮在重讲方案 */
const SKELETON_KEYWORDS = ['时间轴', '角色地图', '骨架', '教育理论', '分类图', '发展演变'];
const INTENT_OVERRIDE = /(不追|先不追|别追)(新闻|热点|资讯|时事)|不追新闻热点|以理解为主线/;
const ARTIFACT_DELIVERABLE = /(讲得出|讲述稿|一张|一份(能|自己)?(讲|画|写)|画图|画一张|复述|写一份)/;
const CONFIRM_REFUSAL = /不能替你按|替你按不了|我这边.{0,6}按不了|界面上.{0,8}点一下|麻烦你.{0,10}确认按钮/;

interface TurnObs {
  turn: number;
  stage: string;
  reply: string;
  endsWithQuestion: boolean;
  chips: string[];
  skeletonHits: string[];
  restates: boolean;
  confirmRefusal: boolean;
}

interface RunObs {
  scenario: string;
  turns: TurnObs[];
  /** 提到过骨架关键词的回合数（≥1 个即算） */
  skeletonTurns: number;
  /** 与上一轮重合 ≥1 个骨架关键词的回合数 —— 软信号（提到同一概念不算复读） */
  restateTurns: number;
  /** 单轮命中 ≥2 个骨架关键词的回合数 —— 「整段重讲方案」的硬信号 */
  strongRepeatTurns: number;
  /** 以问句结尾的回合数 / 总回合：proposing 之后每轮都追问 = 绕圈体感 */
  questionEndedTurns: number;
  /** 提案里出现的最大「小时」体量（兴趣型过重的证据） */
  proposalHours: number | null;
  intentOverride: boolean;
  artifactDeliverable: boolean;
  confirmRefusalTurns: number;
  readyReached: boolean;
  firstDeliverable: string;
  learningDirection: string;
}

function skeletonHits(text: string): string[] {
  return SKELETON_KEYWORDS.filter((k) => text.includes(k));
}

async function runOnce(sc: Scenario, repeat: number): Promise<RunObs> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let previousState: any = undefined;
  const turns: TurnObs[] = [];
  let lastResult: any = null;

  for (let i = 0; i < sc.turns.length; i += 1) {
    const userInput = sc.turns[i];
    const isLast = i === sc.turns.length - 1;
    const result: any = await executeSkill(goalConversationAgentDefinition, {
      input: userInput,
      userId: `probe-deslop-${sc.id}-${repeat}`,
      conversationHistory: history.slice(),
      previousUnderstanding: previousState?.understanding || undefined,
      previousStage: previousState?.stage,
      previousState,
      maxFormatRetries: 2,
      confirmProposal: isLast && sc.finalConfirm,
      uploadedMaterials: [],
    } as any);

    const core = result?.internal?.core || {};
    const gc = result?.internal?.ext?.goalConversation || {};
    const reply = String(result?.userVisible || '').trim();
    const prevHits = turns.length ? turns[turns.length - 1].skeletonHits : [];
    const hits = skeletonHits(reply);
    const obs: TurnObs = {
      turn: i + 1,
      stage: String(core.stage || ''),
      reply,
      endsWithQuestion: /[?？]\s*$/.test(reply),
      chips: (gc.quickReplies || []).map((q: any) => String(q?.text ?? q)),
      skeletonHits: hits,
      restates: turns.length > 0 && hits.length > 0 && hits.some((h) => prevHits.includes(h)),
      confirmRefusal: CONFIRM_REFUSAL.test(reply),
    };
    turns.push(obs);

    history.push({ role: 'user', content: userInput });
    history.push({ role: 'assistant', content: reply });
    previousState = {
      stage: core.stage,
      confidence: core.confidence,
      understanding: gc.understanding,
      collected: gc.collected,
      confirmedProposal: gc.confirmedProposal,
      confidenceScores: gc.confidenceScores,
    };
    lastResult = { result, gc };
  }

  const gc = lastResult?.gc || {};
  const proposal = gc.confirmedProposal || {};
  const skeletonTurns = turns.filter((t) => t.skeletonHits.length >= 1).length;
  const restateTurns = turns.filter((t) => t.restates).length;
  const strongRepeatTurns = turns.filter((t) => t.skeletonHits.length >= 2).length;
  const questionEndedTurns = turns.filter((t) => t.endsWithQuestion).length;
  const hoursCandidates = [...turns.map((t) => t.reply), String(proposal.first_deliverable || '')]
    .flatMap((text) => Array.from(String(text).matchAll(/(\d+(?:\.\d+)?)\s*小时/g)).map((m) => Number(m[1])))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 500);

  return {
    scenario: sc.id,
    turns,
    skeletonTurns,
    restateTurns,
    strongRepeatTurns,
    questionEndedTurns,
    proposalHours: hoursCandidates.length ? Math.max(...hoursCandidates) : null,
    intentOverride:
      INTENT_OVERRIDE.test(String(proposal.learning_direction || '')) ||
      turns.some((t) => INTENT_OVERRIDE.test(t.reply)),
    artifactDeliverable: ARTIFACT_DELIVERABLE.test(String(proposal.first_deliverable || '')),
    confirmRefusalTurns: turns.filter((t) => t.confirmRefusal).length,
    readyReached: turns.some((t) => t.stage === 'ready'),
    firstDeliverable: String(proposal.first_deliverable || ''),
    learningDirection: String(proposal.learning_direction || ''),
  };
}

async function main() {
  const repeats = Math.max(1, Number(process.env.REPEATS || 1));
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  const list = only ? SCENARIOS.filter((s) => only.has(s.id)) : SCENARIOS;
  const all: RunObs[] = [];

  for (const sc of list) {
    for (let r = 1; r <= repeats; r += 1) {
      console.log(`\n===== ${sc.id} ${sc.name} · run ${r}/${repeats} =====`);
      let run: RunObs;
      try {
        run = await runOnce(sc, r);
      } catch (error) {
        console.log(`[probe] 执行失败: ${(error as Error).message}`);
        continue;
      }
      all.push(run);
      for (const t of run.turns) {
        const flags = [
          t.restates ? 'RESTATE' : '',
          t.confirmRefusal ? 'CONFIRM-REFUSAL' : '',
          t.endsWithQuestion ? 'ENDS-Q' : '',
        ].filter(Boolean).join(',');
        console.log(`  turn${t.turn} stage=${t.stage.padEnd(13)} ${flags}`);
        console.log(`    hits=${JSON.stringify(t.skeletonHits)} chips=${JSON.stringify(t.chips)}`);
        console.log(`    ${t.reply.replace(/\s+/g, ' ').slice(0, 220)}`);
      }
      console.log(`  → learning_direction: ${run.learningDirection.slice(0, 200)}`);
      console.log(`  → first_deliverable : ${run.firstDeliverable.slice(0, 200)}`);
      console.log(`  → skeletonTurns=${run.skeletonTurns} strongRepeatTurns=${run.strongRepeatTurns} restateTurns=${run.restateTurns} questionEndedTurns=${run.questionEndedTurns}/${run.turns.length} hours=${run.proposalHours} intentOverride=${run.intentOverride} artifactDeliverable=${run.artifactDeliverable} confirmRefusalTurns=${run.confirmRefusalTurns} ready=${run.readyReached}`);
    }
  }

  console.log('\n===== 汇总（每场景取最差值，便于看退化） =====');
  for (const sc of list) {
    const runs = all.filter((a) => a.scenario === sc.id);
    if (!runs.length) continue;
    const worst = (f: (r: RunObs) => number) => Math.max(...runs.map(f));
    const anyTrue = (f: (r: RunObs) => boolean) => runs.some(f);
    console.log(
      `RESULT scenario=${sc.id} repeats=${runs.length}` +
      ` skeletonTurns=${worst((r) => r.skeletonTurns)}/${sc.turns.length}` +
      ` strongRepeatTurns=${worst((r) => r.strongRepeatTurns)}` +
      ` restateTurns=${worst((r) => r.restateTurns)}` +
      ` questionEndedTurns=${worst((r) => r.questionEndedTurns)}/${sc.turns.length}` +
      ` hours=${runs.map((r) => r.proposalHours ?? '-').join('/')}` +
      ` intentOverride=${runs.filter((r) => r.intentOverride).length}/${runs.length}` +
      ` artifactDeliverable=${runs.filter((r) => r.artifactDeliverable).length}/${runs.length}` +
      ` confirmRefusalTurns=${worst((r) => r.confirmRefusalTurns)}` +
      ` readyReached=${runs.filter((r) => r.readyReached).length}/${runs.length}` +
      ` anyQuestionAfterAuth=${anyTrue((r) => r.turns.some((t) => t.endsWithQuestion && t.turn >= sc.turns.length - 1))}`,
    );
  }

  const outDir = path.resolve(__dirname, '../../../qa-reports/2026-11-07-teaching-strategy');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(outDir, `probe-goal-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ repeats, runs: all }, null, 1), 'utf8');
    console.log(`\n[probe] 明细已落盘：${file}`);
  } catch (error) {
    console.log(`[probe] 明细落盘失败（不影响结论）：${(error as Error).message}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
