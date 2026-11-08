/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收探针 */
/**
 * 验收探针：proposing 回合里「快选」与「确认方案」是不是被模型同时推给用户。
 *
 * 背景（2026-10-31 用户走查）：截图上同屏既有三条快选（可多选、填进输入框），
 * 又有「查看方案并确认」入口条 —— 用户不知道到底该回答还是该确认。
 *
 * 本探针只看**模型真实产出**（真调 LLM，不 mock），对每个场景跑 1-3 轮对话，
 * 在第一个 proposing 回合判定：
 *   A. reply 结尾是否在提问（把决定权交回用户的问题）
 *   B. quickReplies 是否同时含「确认类」与「调整类」两种语义
 *   C. 是否产出 confirmedProposal（方案本体）
 *   D. proposalQuality（提示词要求的 SMART 自评）是否真的出现
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/probe-goal-chip-vs-confirm.ts
 *   SCENARIOS=1 npx ts-node --transpile-only src/scripts/probe-goal-chip-vs-confirm.ts
 */
import 'dotenv/config';
import { executeSkill } from '../skills';
import { goalConversationAgentDefinition, isProposalConfirmChip } from '../skills/goal-conversation';
import { loadPromptFile } from '../composers/prompt-files/loader';

/**
 * 只验证「改了提示词真源之后模型是否不再产出确认类快选」用：把编译产物当 override 喂进去。
 * 不开这个开关时走运行时正常读取顺序（DB ACTIVE → 编译产物），与线上同源。
 */
const PROMPT_OVERRIDE = process.env.PROMPT_OVERRIDE === '1'
  ? (loadPromptFile('skill:goal-conversation')?.systemPrompt || undefined)
  : undefined;

interface Scenario {
  id: string;
  name: string;
  /** 用户逐轮发言：第一句是首轮目标，后面是对方回答 */
  turns: string[];
}

/** 覆盖三类 goal 形态：短目标（需要澄清）/ 信息齐全（可直出方案）/ 单点问题（易过度扩写） */
const SCENARIOS: Scenario[] = [
  {
    id: 'S1',
    name: '短目标·需澄清',
    turns: [
      '我想学会用 Excel 做数据透视表',
      '平时只用 Excel 简单表格，透视表完全没用过。下周前要做出一份销售汇总报告，每天能学半小时。',
    ],
  },
  {
    id: 'S2',
    name: '信息齐全·应直出方案',
    turns: [
      '我是做电商运营的，每周要手工把三个平台的订单表合成一张周报，一次要两个多小时还容易错。我想学会用 Python 自动合并。我已经会基本语法（循环、函数），每天能投入 1 小时，希望一个月内能自己独立跑通。',
      '要按商品、日期这类维度汇总出销售额和单量，不是单纯上下拼。',
    ],
  },
  {
    id: 'S3',
    name: '单点问题·易扩写',
    turns: [
      'CPA 考试成绩五年有效期是怎么算的？我今年报了三科，想知道这么报对不对。',
      '我就是想搞清楚有效期规则，顺便确认一下今年的报法。',
      '之前没考过，今年第一次考。会计、审计、税法这三科。',
    ],
  },
];

/** 判定用线上同一个判据（isProposalConfirmChip），探针不另维护一份正则以免误报 */
const ADJUST_CHIP = /(调整|改|精简|压缩|补点|提前|拆细|换|不要|少一点|多一点)/;

interface TurnObservation {
  turn: number;
  stage: string;
  replyTail: string;
  endsWithQuestion: boolean;
  chipTexts: string[];
  hasProposal: boolean;
  hasProposalQuality: boolean;
  qualityOverall: number | null;
}

function observe(round: number, result: any): TurnObservation {
  const core = result?.internal?.core || {};
  const gc = result?.internal?.ext?.goalConversation || {};
  const reply = String(result?.userVisible || '').trim();
  const chips = (gc.quickReplies || []).map((q: any) => String(q?.text ?? q));
  const pq = result?.proposalQuality || gc.proposalQuality || null;
  return {
    turn: round,
    stage: String(core.stage || ''),
    replyTail: reply.slice(-60),
    endsWithQuestion: /[?？]\s*$/.test(reply),
    chipTexts: chips,
    hasProposal: !!gc.confirmedProposal,
    hasProposalQuality: !!pq,
    qualityOverall: pq && Number.isFinite(Number(pq.overall)) ? Number(pq.overall) : null,
  };
}

async function runScenario(sc: Scenario) {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let previousState: any = undefined;
  const observations: TurnObservation[] = [];

  for (let i = 0; i < sc.turns.length; i += 1) {
    const userInput = sc.turns[i];
    const result: any = await executeSkill(goalConversationAgentDefinition, {
      input: userInput,
      userId: 'probe-goal-chip',
      conversationHistory: history.slice(),
      previousUnderstanding: previousState?.understanding || undefined,
      previousStage: previousState?.stage,
      previousState,
      maxFormatRetries: 2,
      confirmProposal: false,
      uploadedMaterials: [],
      ...(PROMPT_OVERRIDE ? { systemPromptOverride: PROMPT_OVERRIDE } : {}),
    } as any);

    if (result?.debug?.structuredOutputValid === false) {
      console.log(`[probe] ${sc.id} 第${i + 1}轮 结构化校验未通过: ${JSON.stringify(result.debug?.violations)}`);
    }
    const obs = observe(i + 1, result);
    observations.push(obs);

    history.push({ role: 'user', content: userInput });
    history.push({ role: 'assistant', content: String(result?.userVisible || '') });
    const gc = result?.internal?.ext?.goalConversation || {};
    previousState = {
      stage: result?.internal?.core?.stage,
      confidence: result?.internal?.core?.confidence,
      understanding: gc.understanding,
      collected: gc.collected,
      confirmedProposal: gc.confirmedProposal,
      confidenceScores: gc.confidenceScores,
    };
    // 已经到 proposing 且产出方案就不必再往下问（我们要观察的正是这一轮）
    if (obs.stage === 'proposing' && obs.hasProposal) break;
  }

  return { scenario: sc, observations };
}

async function main() {
  const only = process.env.SCENARIOS ? process.env.SCENARIOS.split(',') : null;
  const list = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;

  let conflictCount = 0;
  let proposingCount = 0;
  let qualityCount = 0;

  for (const sc of list) {
    console.log(`\n===== ${sc.id} ${sc.name} =====`);
    let run;
    try {
      run = await runScenario(sc);
    } catch (error) {
      console.log(`[probe] ${sc.id} 执行失败: ${(error as Error).message}`);
      continue;
    }
    for (const o of run.observations) {
      console.log(`  turn${o.turn} stage=${o.stage} 结尾提问=${o.endsWithQuestion ? 'YES' : 'NO'} 方案=${o.hasProposal ? 'YES' : 'NO'} 自评=${o.hasProposalQuality ? `YES(${o.qualityOverall ?? '-'})` : 'NO'}`);
      console.log(`    chips(${o.chipTexts.length}) = ${JSON.stringify(o.chipTexts)}`);
      console.log(`    tail = …${o.replyTail}`);
    }
    const proposing = run.observations.filter((o) => o.stage === 'proposing' && o.hasProposal);
    if (proposing.length) {
      proposingCount += 1;
      const last = proposing[proposing.length - 1];
      const confirmChips = last.chipTexts.filter((t) => isProposalConfirmChip(t));
      const adjustChips = last.chipTexts.filter((t) => ADJUST_CHIP.test(t));
      const conflict = last.endsWithQuestion && confirmChips.length > 0;
      if (conflict) conflictCount += 1;
      if (last.hasProposalQuality) qualityCount += 1;
      console.log(`  → 判定: 结尾提问=${last.endsWithQuestion} 确认类chip=${confirmChips.length} 调整类chip=${adjustChips.length} ⇒ 二合一冲突=${conflict ? 'YES' : 'NO'}`);
    } else {
      console.log('  → 未在给定轮次内进入「proposing + 有方案」');
    }
  }

  console.log('\n===== 汇总 =====');
  console.log(JSON.stringify({
    scenarios: list.length,
    reachedProposingWithProposal: proposingCount,
    /** 同轮既在提问又在给确认入口 —— 用户走查截图里的那个状态 */
    conflictTurns: conflictCount,
    /** 提示词要求、但实际没落地的自评字段 */
    proposalQualityEmitted: qualityCount,
  }, null, 1));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
