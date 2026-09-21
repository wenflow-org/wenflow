/* eslint-disable no-console -- 一次性诊断 CLI：面向人读的输出，不需要 logger */
/**
 * **只重放 path 一步**（复用历史 Goal 产出，跳过 Goal 对话）——只读、**不落库**。
 *
 * 为什么需要它：
 *   VL 全流程（Goal 对话 → Path）一轮要 3–5 分钟，且 Goal 对话段实测常以
 *   `fetch failed` 超时收场（2026-09-21：连续 3 位学习者都在 304s 前后失败）。
 *   而"路径名称/体量/结构"这类改动**只受 path-planning 影响**，重放这一步即可验收：
 *   单次 LLM 调用、秒到分钟级、零写入、且与历史输入**配对**（同输入同模型，单变量）。
 *
 * 输入来源：`path_generation_runs.inputSnapshot`（= 生成时的完整 GeneratePathData，
 *   由生产链路落库），其中 `userProfile.normalizedInput` 正是 path-planning 要的整份输入。
 *
 * 与生产的同源性：复用生产函数 `buildPathAgentInput` + `buildFramedNormalizedInput`
 *   （不做第二套组装），并走同一个 `executeSkill(pathAgentDefinition)`。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/replay-path-planning.ts --latest=2
 *   npx ts-node --transpile-only src/scripts/replay-path-planning.ts --path=lp_xxx
 *   npx ts-node --transpile-only src/scripts/replay-path-planning.ts --latest=2 --keyword=入门
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { executeSkill } from '../skills';
import { pathAgentDefinition } from '../skills/path-planning';
import { normalizeAgentOutput } from '../agents/output-normalizer';
import { buildFramedNormalizedInput } from '../services/learning/path-planning-hints';
import { buildPathAgentInput } from '../services/learning/generation/path-generation.core';
import { stripDeliveryLevelWords } from '../services/learning/path-naming';

const DB_PATH = path.resolve(__dirname, '..', '..', 'prisma', 'dev.db');

/**
 * 从人设案例 JSON（`data/vl-persona-mixed-2026-09-21/cases/*.json`）**构造** path-planning 输入。
 * 用途：这批案例跑在远程，本地库没有它们的 inputSnapshot；但 case 里有完整的人设+故事，
 * 足以构造一份**同源输入**做改动前后的**配对 A/B**（同输入、单变量）。
 * ⚠️ 这是构造输入（非生产快照）：只用于**同一输入下的前后对比**，不能当作生产分布的样本。
 */
/** `--rich`：构造输入时额外灌入情绪/压力/抗拒材料（见 problemSpace 注释） */
const RICH = process.argv.includes('--rich');
/**
 * `--triage=once|recurring`：向构造输入注入 Goal 层的分流判定（`normalizedInput.triage`），
 * 用于验证「分流钳制 + 提示词规则」的效果。缺省不注入 ⇒ 与生产现状一致。
 */
const TRIAGE_ARG = ((): any => {
  const hit = process.argv.find((a) => a.startsWith('--triage='));
  if (!hit) return null;
  const value = hit.slice('--triage='.length);
  if (value === 'once') return { transferable: false, recurrence: 'once', evidence: 'replay 注入' };
  if (value === 'recurring') return { transferable: false, recurrence: 'recurring', evidence: 'replay 注入' };
  if (value === 'transferable') return { transferable: true, recurrence: 'recurring', evidence: 'replay 注入' };
  return null;
})();

function buildInputFromCaseFile(casePath: string, rich: boolean): { data: any; label: string } {
  const raw = JSON.parse(fs.readFileSync(casePath, 'utf-8'));
  const spec = raw.spec || {};
  const story = (raw.record || {}).story || {};
  const pk = story.problemKnowledge || {};
  const name = spec.name || path.basename(casePath);
  const normalizedInput = {
    version: '1.0',
    learnerProfile: {
      // 用户的**原始表述**（含情绪与自我误诊），不是澄清后的诊断
      surfaceGoal: story.visibleOpening || spec.goalHint || spec.domain || null,
      motivation: spec.motivationType || null,
      urgency: null,
      backgroundExperience: spec.background || null,
      painPoints: [
        ...(Array.isArray(spec.emotionalTriggers) ? spec.emotionalTriggers : []),
        ...(Array.isArray(spec.failurePatterns) ? spec.failurePatterns : []),
        ...(Array.isArray(story.pressurePoints) ? story.pressurePoints : []),
      ],
      learningSignal: story.misdiagnosis || null,
      constraintsAndBoundaries: [],
      currentBaseline: { level: spec.knowledgeLevel || null, evidence: pk.selfAssessment || spec.background || null },
    },
    problemSpace: {
      // 只给**叙事**（storyOutline），不给诊断结论——模拟"Goal 层澄清没做到底"的情形。
      // 刻意**不**传 hiddenDetails / goalSeed.realProblem：那是答案，会把路径直接变成操作型，
      // 从而掩盖"情绪材料被当作认知对象"这一病灶（本工具的第一版就踩了这个坑）。
      // `--rich`：额外灌入情绪/压力/抗拒材料（模拟生产里 Goal 层围绕故事展开后的输入），
      //   用于检验"情绪材料是不是通胀燃料"这一假设。
      realProblem: [
        story.storyOutline,
        ...(RICH ? [
          ...(Array.isArray(story.pressurePoints) ? [`压力点：${story.pressurePoints.join('、')}`] : []),
          ...(Array.isArray((story.disclosurePlan || {}).resistancePoints) ? [`抗拒点：${(story.disclosurePlan || {}).resistancePoints.join('、')}`] : []),
        ] : []),
      ].filter(Boolean).join(' ') || null,
      scenario: story.triggerEvent || story.title || spec.domain || null,
      currentPainPoint: story.visibleOpening || story.triggerEvent || null,
    },
    resources: { timeBudget: null, timeBudgetCadence: null, timePerWeek: null, timePerSession: null, timeHorizon: null },
    successCriteria: { observableResult: null, acceptanceCheck: null, firstDeliverable: null },
    confirmedProposal: { keyStages: [], firstDeliverable: null },
    learnerLoadProfile: { availableTime: spec.availableTime || null, loadTolerance: null },
    ...(TRIAGE_ARG ? { triage: TRIAGE_ARG } : {}),
  };
  return {
    label: `${name}（构造输入${rich ? ' · rich' : ''} · ${story.primaryBlockType || '?'} · recurrence=${story.recurrence || '?'}）`,
    data: {
      source: 'replay-case',
      mode: 'create',
      userId: 'replay-case-user',
      description: story.visibleOpening || spec.goalHint || spec.domain || name,
      userProfile: {
        skillLevel: spec.knowledgeLevel,
        timePerDay: null,
        structuredData: null,
        confirmedProposal: { keyStages: [], firstDeliverable: null },
        normalizedInput,
      },
    },
  };
}

function arg(name: string, fallback: string | null = null): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface SnapshotRow {
  learningPathId: string;
  inputSnapshot: string;
  createdAt: number;
}

async function pickSnapshots(limit: number, onlyPathId: string | null): Promise<SnapshotRow[]> {
  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
  const all = (sql: string, params: unknown[] = []): Promise<any[]> => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows as any[])));
  });
  try {
    const base = `
      SELECT r.learningPathId, r.inputSnapshot, r.createdAt, u.name AS owner
        FROM path_generation_runs r
        JOIN learning_paths lp ON lp.id = r.learningPathId
        JOIN users u ON u.id = lp.userId
       WHERE r.phase = 'core' AND r.status = 'succeeded' AND r.inputSnapshot IS NOT NULL
    `;
    const rows = onlyPathId
      ? await all(`${base} AND r.learningPathId = ? ORDER BY r.createdAt DESC LIMIT 1`, [onlyPathId])
      : await all(`${base} ORDER BY r.createdAt DESC LIMIT 40`);
    // 同一学习者只取最新一条，保证样本多样（否则会被同一个人的多次重跑占满）
    const seen = new Set<string>();
    const picked: Array<SnapshotRow & { owner: string }> = [];
    for (const row of rows as any[]) {
      const key = String(row.owner);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(row);
      if (picked.length >= limit) break;
    }
    return picked as any;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const limit = Number(arg('latest', '2')) || 2;
  const onlyPathId = arg('path');
  const caseArg = arg('case');            // 人设案例 JSON（可逗号分隔多个）→ 构造输入
  const expectKeyword = arg('keyword');   // 可选：断言旧口径关键词（如"入门"）是否已被消除

  type Item = { owner: string; data: any };
  let items: Item[];
  if (caseArg) {
    items = String(caseArg).split(',').map((s) => s.trim()).filter(Boolean).map((p) => {
      const built = buildInputFromCaseFile(path.resolve(p), RICH);
      return { owner: built.label, data: built.data };
    });
  } else {
    const rows = await pickSnapshots(limit, onlyPathId);
    items = rows.map((row: any) => ({ owner: row.owner, data: JSON.parse(row.inputSnapshot) }));
  }
  if (items.length === 0) {
    console.error('[replay] 没找到可重放的输入');
    process.exitCode = 1;
    return;
  }
  console.log(`[replay] 重放 ${items.length} 例（同输入、单变量、不落库）\n`);

  for (const item of items) {
    const data = item.data;
    const agentInput = buildPathAgentInput(data);
    const framedRaw = data.userProfile?.normalizedInput || null;
    const framed = buildFramedNormalizedInput(framedRaw);
    agentInput.metadata = { ...(agentInput.metadata || {}), normalizedInput: framed };

    const goalText = String(agentInput.goal || '').replace(/\s+/g, ' ').slice(0, 56);
    const startedAt = Date.now();
    const result = await executeSkill(pathAgentDefinition, {
      input: agentInput,
      context: { userId: data.userId },
    });
    const normalized = normalizeAgentOutput('skill:path-planning', result);
    const payload = (normalized as any)?.internal?.ext?.path?.path
      || (normalized as any)?.internal?.path
      || (result as any)?.path;
    const ms = Date.now() - startedAt;

    if (!payload?.name) {
      console.log(`✗ ${item.owner} | ${ms}ms | 无输出：${JSON.stringify(normalized?.error || result).slice(0, 160)}\n`);
      continue;
    }
    const strip = stripDeliveryLevelWords(String(payload.name));
    const ms2 = Array.isArray(payload.milestones) ? payload.milestones : [];
    const flag = strip.stripped.length ? `⚠ 仍含水平词（剔除层兜住：${strip.stripped.join('/')}）` : '✓ 无水平词';
    console.log(`【${item.owner}】${ms}ms  输入目标：${goalText}…`);
    console.log(`  原始 name : ${payload.name}`);
    console.log(`  落库后 name: ${strip.title}   ${flag}`);
    console.log(`  段数 ${ms2.length} | 学时 ${payload.estimatedHours ?? '-'} | 周 ${payload.estimatedWeeks ?? '-'}`);
    for (const m of ms2) {
      const concept = m.coreConcept || m.coreConceptName || '';
      console.log(`    【${m.stageNumber ?? ''}】${m.title}   (概念:${String(concept).slice(0, 26)})`);
    }
    if (expectKeyword) {
      const hit = String(payload.name).includes(expectKeyword);
      console.log(`  断言「原始 name 含 ${expectKeyword}」: ${hit ? '仍含 ✗' : '已消除 ✓'}`);
    }
    console.log();
  }
}

void main().catch((error) => {
  console.error('[replay] 失败', error);
  process.exitCode = 1;
});
