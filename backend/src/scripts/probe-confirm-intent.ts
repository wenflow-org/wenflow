/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性只读探针 */
/**
 * 模型结构化确认意图（confirmIntent）实测探针 —— 真调 LLM，不 mock。
 *
 * 目的：验证「自然语言确认改由模型判意图」切片在真机上的行为：
 *   - 兴趣型前 5 轮（复现 lp_1793957582347_jm6v754 的真实目标会话）逐步收敛到 proposing；
 *   - 最后一轮用「行，就照你说的办」这类**不出现「确认/按这个来」字样、且白名单易漏召**的语义确认，
 *     模型应在 internal.core.confirmIntent 输出 true、stage 维持 proposing（模型不得自报 ready），
 *     由服务端据该信号推进（本探针只观测模型输出，不替服务端决策）。
 *
 * 对照：若模型在末轮 confirmIntent 仍为 false/缺省，说明提示词口径未生效，需回看
 * prompts/core/goal-conversation.yaml 的「确认意图判定（confirmIntent）」规则。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/probe-confirm-intent.ts
 *   REPEATS=2 npx ts-node --transpile-only src/scripts/probe-confirm-intent.ts
 *   ONLY=interest-confirm npx ts-node --transpile-only src/scripts/probe-confirm-intent.ts
 *   USE_COMPILED_PROMPT=1 npx ts-node --transpile-only src/scripts/probe-confirm-intent.ts
 *
 * 读取口径说明（2026-11-07 实测）：运行时提示词读取顺序为
 *   systemPromptOverride → DB ACTIVE prompt → 编译产物 .md（见 prompt-composer.ts:316 / loader.ts 文件头）。
 * 本切片只改真源 core.yaml + 编译产物 .md，**未**发布到 DB ACTIVE，故默认运行时模型看不到
 * confirmIntent 规则，逐轮都会是 absent——这是「真机待发布」的真实读数，不是缺陷。
 * 想在发布前验证新契约是否生效，用 USE_COMPILED_PROMPT=1 把刚编译的 .md 作为
 * systemPromptOverride 注入（最高优先级，不写 DB），再观察末轮 confirmIntent 是否出现 true。
 *
 * 输出：逐轮打印 confirmIntent 与 stage；末尾一行 RESULT 摘要（confirmIntentTrueAtLast 等）。
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { executeSkill } from '../skills';
import { goalConversationAgentDefinition } from '../skills/goal-conversation';
import { loadPromptFile } from '../composers/prompt-files/loader';

interface Scenario {
  id: string;
  name: string;
  /** 用户逐轮原话；末句为白名单外的语义确认「行，就照你说的办」 */
  turns: string[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'interest-confirm',
    name: '兴趣通识 · 末轮白名单外语义确认（行，就照你说的办）',
    turns: [
      '学习最新的ai教育知识',
      '纯兴趣，想搞明白 AI 和教育到底怎么回事',
      '看过一些文章、听过一些说法，但不成体系，也想系统知道发展演变脉络',
      '说不好，有空就看',
      '想连教育理论一起铺',
      '行，就照你说的办',
    ],
  },
  {
    id: 'interest-confirm-alt',
    name: '兴趣通识 · 另一语义确认措辞（明白了，那就这么干）',
    turns: [
      '学习最新的ai教育知识',
      '纯兴趣，想搞明白 AI 和教育到底怎么回事',
      '看过一些文章、听过一些说法，但不成体系，也想系统知道发展演变脉络',
      '说不好，有空就看',
      '想连教育理论一起铺',
      '明白了，那就这么干',
    ],
  },
];

interface TurnObs {
  turn: number;
  stage: string;
  confirmIntent: boolean | 'absent';
  reply: string;
}

interface RunObs {
  scenario: string;
  turns: TurnObs[];
  /** 末轮 confirmIntent 是否为显式 true（切片成功的标志） */
  confirmIntentTrueAtLast: boolean;
  /** 任一非末轮（用户未确认时）出现 confirmIntent=true 的轮次（误报信号） */
  falsePositiveTurns: number[];
}

async function runOnce(sc: Scenario, repeat: number, systemPromptOverride: string | null): Promise<RunObs> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let previousState: any = undefined;
  const turns: TurnObs[] = [];

  for (let i = 0; i < sc.turns.length; i += 1) {
    const userInput = sc.turns[i];
    const result: any = await executeSkill(goalConversationAgentDefinition, {
      input: userInput,
      userId: `probe-confirm-intent-${sc.id}-${repeat}`,
      conversationHistory: history.slice(),
      previousUnderstanding: previousState?.understanding || undefined,
      previousStage: previousState?.stage,
      previousState,
      maxFormatRetries: 2,
      // 刻意不传 confirmProposal：纯靠模型 confirmIntent 信号，验证切片本身
      ...(systemPromptOverride ? { systemPromptOverride } : {}),
      uploadedMaterials: [],
    } as any);

    const core = result?.internal?.core || {};
    const gc = result?.internal?.ext?.goalConversation || {};
    const reply = String(result?.userVisible || '').trim();
    const confirmIntent: boolean | 'absent' =
      typeof core.confirmIntent === 'boolean' ? core.confirmIntent : 'absent';

    turns.push({
      turn: i + 1,
      stage: String(core.stage || ''),
      confirmIntent,
      reply,
    });

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
  }

  const last = turns[turns.length - 1];
  const falsePositiveTurns = turns
    .slice(0, -1)
    .filter((t) => t.confirmIntent === true)
    .map((t) => t.turn);

  return {
    scenario: sc.id,
    turns,
    confirmIntentTrueAtLast: last.confirmIntent === true,
    falsePositiveTurns,
  };
}

async function main() {
  const repeats = Math.max(1, Number(process.env.REPEATS || 1));
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  const list = only ? SCENARIOS.filter((s) => only.has(s.id)) : SCENARIOS;
  const all: RunObs[] = [];

  // 发布前验证开关：把刚编译的 .md（含 confirmIntent 新规则）作为 systemPromptOverride 注入，
  // 绕开尚未更新的 DB ACTIVE prompt；不写 DB，纯只读探针。
  const compiledOverride = process.env.USE_COMPILED_PROMPT === '1'
    ? loadPromptFile('skill:goal-conversation')?.systemPrompt || null
    : null;
  if (process.env.USE_COMPILED_PROMPT === '1') {
    console.log(`[probe] USE_COMPILED_PROMPT=1：注入编译产物 systemPromptOverride（${compiledOverride?.length ?? 0} 字符，含 confirmIntent=${compiledOverride?.includes('confirmIntent')}）`);
  }

  for (const sc of list) {
    for (let r = 1; r <= repeats; r += 1) {
      console.log(`\n===== ${sc.id} ${sc.name} · run ${r}/${repeats} =====`);
      let run: RunObs;
      try {
        run = await runOnce(sc, r, compiledOverride);
      } catch (error) {
        console.log(`[probe] 执行失败: ${(error as Error).message}`);
        continue;
      }
      all.push(run);
      for (const t of run.turns) {
        console.log(
          `  turn${t.turn} stage=${t.stage.padEnd(13)} confirmIntent=${String(t.confirmIntent).padEnd(7)} | ${t.reply.replace(/\s+/g, ' ').slice(0, 160)}`,
        );
      }
      console.log(
        `  → confirmIntentTrueAtLast=${run.confirmIntentTrueAtLast} falsePositiveTurns=[${run.falsePositiveTurns.join(',')}]`,
      );
    }
  }

  console.log('\n===== 汇总 =====');
  for (const sc of list) {
    const runs = all.filter((a) => a.scenario === sc.id);
    if (!runs.length) continue;
    const lastTrue = runs.filter((r) => r.confirmIntentTrueAtLast).length;
    const anyFalsePositive = runs.some((r) => r.falsePositiveTurns.length > 0);
    console.log(
      `RESULT scenario=${sc.id} repeats=${runs.length}` +
        ` confirmIntentTrueAtLast=${lastTrue}/${runs.length}` +
        ` falsePositiveOnNonConfirmTurn=${anyFalsePositive}`,
    );
  }

  const outDir = path.resolve(__dirname, '../../../qa-reports/2026-11-07-teaching-strategy');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(outDir, `probe-confirm-intent-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ repeats, runs: all }, null, 1), 'utf8');
    console.log(`\n[probe] 明细已落盘：${file}`);
  } catch (error) {
    console.log(`[probe] 明细落盘失败（不影响结论）：${(error as Error).message}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
