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
import { auxSkillDefinitionMap, executeSkill, executeSkillWithResult } from '../skills';
import { pathAgentDefinition } from '../skills/path-planning';
import { stageDesignerDefinition } from '../skills/stage-designer';
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
/** `--estimate-lessons`：先调判官模拟 Goal 层"估课次"（totalSessions × sessionsLengthMin），
 *  注入构造输入的 timeDimensions——这是课次锚的输入，缺它就只能走兜底 */
const ESTIMATE_LESSONS = process.argv.includes('--estimate-lessons');

/** `--judge-only`：只调判官（估课次），不跑 path/stage —— 用于统计判官契约稳定性 */
const JUDGE_ONLY = process.argv.includes('--judge-only');

/** `--with-stage`：path 之后继续跑 stage-designer，汇总任务数与真实学时（定位注水点） */
const WITH_STAGE = process.argv.includes('--with-stage');

/** `--rich`：构造输入时额外灌入情绪/压力/抗拒材料（见 problemSpace 注释） */
const RICH = process.argv.includes('--rich');

/** `--goal=<text>`：覆盖构造输入的诉求（用于"同一诉求、不同资料条件"的对照实验） */
const GOAL_ARG = (() => {
  const hit = process.argv.find((a) => a.startsWith('--goal='));
  return hit ? hit.slice('--goal='.length) : null;
})();

/** `--material-file=<path>`：把本地文档作为"资料包"注入（模拟**有文档**） */
const MATERIAL_FILE = (() => {
  const hit = process.argv.find((a) => a.startsWith('--material-file='));
  return hit ? hit.slice('--material-file='.length) : null;
})();

/** `--material-search`：用 material-collector 联网采集（模拟**有网络搜索**） */
const MATERIAL_SEARCH = process.argv.includes('--material-search');

/** `--full`：打印完整路径结构（名称/摘要/每段的说明与概念），用于人眼审阅 */
const FULL_PATH = process.argv.includes('--full');
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
  if (GOAL_ARG) {
    // 首轮实验教训：只改 surfaceGoal 不够——案例故事字段（scenario/痛点/背景）与 availableTime(minimal)
    // 会盖过它（三条结果一模一样）。做"资料条件"对照时必须把故事痕迹与承受力档位一起清空。
    normalizedInput.learnerProfile.surfaceGoal = GOAL_ARG;
    normalizedInput.learnerProfile.backgroundExperience = null;
    normalizedInput.learnerProfile.learningSignal = null;
    normalizedInput.learnerProfile.painPoints = [];
    normalizedInput.learnerProfile.currentBaseline = { level: null, evidence: null };
    normalizedInput.problemSpace.realProblem = GOAL_ARG;
    normalizedInput.problemSpace.scenario = GOAL_ARG;
    normalizedInput.problemSpace.currentPainPoint = null;
    normalizedInput.learnerLoadProfile = { availableTime: null, loadTolerance: null };
    normalizedInput.successCriteria = { observableResult: null, acceptanceCheck: null, firstDeliverable: null };
  }
  return {
    label: `${name}（构造输入${rich ? ' · rich' : ''} · ${story.primaryBlockType || '?'} · recurrence=${story.recurrence || '?'}）`,
    data: {
      source: 'replay-case',
      mode: 'create',
      userId: 'replay-case-user',
      description: GOAL_ARG || story.visibleOpening || spec.goalHint || spec.domain || name,
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
    if (ESTIMATE_LESSONS) {
      // 模拟 Goal 层：用"用户原话 + 情境"估课次与一次时长（判官的主产物）
      const ni = data.userProfile?.normalizedInput || {};
      const request = String(ni?.learnerProfile?.surfaceGoal || data.description || '');
      const context = [
        ni?.problemSpace?.realProblem,
        ni?.problemSpace?.scenario,
        ni?.learnerLoadProfile?.availableTime ? `（自报可用时间档位：${ni.learnerLoadProfile.availableTime}）` : '',
      ].filter(Boolean).join(' / ');
      try {
        const est: any = await executeSkillWithResult(auxSkillDefinitionMap['triage-judge'], {
          request, context, background: ni?.learnerProfile?.backgroundExperience || '',
          __prompt: { requestPath: 'replay-estimate-lessons' },
        } as any);
        const out = est?.output || {};
        if (out.totalSessions > 0) {
          ni.timeDimensions = {
            totalSessions: out.totalSessions,
            sessionsLengthMin: out.sessionsLengthMin ?? null,
          };
          data.userProfile.normalizedInput = ni;
          const totalMin = out.sessionsLengthMin ? Math.round(out.totalSessions * out.sessionsLengthMin) : null;
          console.log(`  ⇢ 判官估课次: totalSessions=${out.totalSessions} · 一次=${out.sessionsLengthMin ?? '-'}分钟 · 合计≈${totalMin ?? '?'}分钟 | artifact=${out.artifact} | 依据：${String(out.evidence || '').slice(0, 50)}`);
        } else {
          console.log(`  ⇢ 判官未给出课次（${JSON.stringify(out).slice(0, 90)}）`);
        }
      } catch (error) {
        console.log(`  ⇢ 估课次失败：${String((error as Error)?.message || error).slice(0, 80)}`);
      }
    }
    if (JUDGE_ONLY) continue;

    // ---- 资料条件（对照实验变量）----
    if (MATERIAL_FILE || MATERIAL_SEARCH) {
      const ni: any = data.userProfile?.normalizedInput || {};
      const packs: any[] = [];
      if (MATERIAL_SEARCH) {
        const { collectMaterialPack } = await import('../skills/material-collector');
        const pack: any = await collectMaterialPack(
          { kind: 'standard', title: (GOAL_ARG || '资料').slice(0, 60), why: 'replay：联网补信息' } as never,
          { maxSources: 5 }
        );
        packs.push(pack);
        console.log(`  ⇢ 联网采集: status=${pack.status} 要点=${pack?.pack?.keyPoints?.length ?? 0} 来源=${pack?.pack?.sourceUrl ?? '-'}`);
      }
      if (MATERIAL_FILE) {
        const text = fs.readFileSync(MATERIAL_FILE as string, 'utf-8');
        const lines = text.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l.length > 12);
        packs.push({
          status: 'ok',
          pack: {
            title: path.basename(MATERIAL_FILE as string),
            publisher: null,
            sourceTier: 'official',
            sourceUrl: `attachment://${encodeURIComponent(path.basename(MATERIAL_FILE as string))}`,
            version: null,
            fetchedAt: new Date().toISOString(),
            license: null,
            tldr: text.slice(0, 4000),
            sections: lines.slice(0, 8).map((l, i) => ({ id: `s-${i + 1}`, title: l.slice(0, 40), summary: '' })),
            keyPoints: lines.slice(0, 16).map((l) => ({ text: l.slice(0, 120), cite: l.slice(0, 120), sourceUrl: 'attachment://local' })),
          },
          provenance: [],
          coverage: { covered: [], missing: [] },
          notes: ['来自本地附件（replay 注入）'],
        });
        console.log(`  ⇢ 注入附件资料: ${path.basename(MATERIAL_FILE as string)} · ${text.length} 字`);
      }
      ni.resources = { ...(ni.resources || {}), materials: packs };
      data.userProfile.normalizedInput = ni;
    }

    const agentInput = buildPathAgentInput(data);
    const framedRaw = data.userProfile?.normalizedInput || null;
    const framed = buildFramedNormalizedInput(framedRaw);
    agentInput.metadata = { ...(agentInput.metadata || {}), normalizedInput: framed };
    // 资料是否真的送达 path（framing 白名单可能把 materials 裁掉——上轮子代理就踩过）
    const sentMaterials = (framed as any)?.resources?.materials;
    console.log(`  ⇢ framed.resources.materials = ${Array.isArray(sentMaterials) ? sentMaterials.length + ' 包' : 'MISSING（被 framing 裁掉）'}`);

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
    if (FULL_PATH) {
      console.log('  ──── 完整路径 ────');
      console.log(JSON.stringify({ name: payload.name ?? null, summary: payload.summary ?? null, subject: payload.subject ?? null, estimatedHours: payload.estimatedHours ?? null, estimatedWeeks: payload.estimatedWeeks ?? null, milestones: ms2 }, null, 2));
    }
    for (const m of ms2) {
      const concept = m.coreConcept || m.coreConceptName || '';
      console.log(`    【${m.stageNumber ?? ''}】${m.title}   (概念:${String(concept).slice(0, 26)})`);
    }
    if (WITH_STAGE && ms2.length > 0) {
      // 定位注水点：path 只给段数与粗估学时；**真实学时 = 任务分钟之和**（stage-designer 产出）
      let totalTasks = 0;
      let totalMinutes = 0;
      const perStage: string[] = [];
      for (const [i, m] of ms2.entries()) {
        const prev = i > 0 ? ms2[i - 1] : null;
        const stageInput = {
          milestone: {
            stageNumber: m.stageNumber,
            title: m.title,
            coreConcept: m.coreConceptId || m.coreConcept || null,
            description: m.description || null,
            goal: m.goal || null,
            estimatedHours: m.estimatedHours || null,
          },
          ...(prev ? { previousMilestone: { stageNumber: prev.stageNumber, title: prev.title, coreConcept: prev.coreConceptId || prev.coreConcept || null } } : {}),
          cognitiveCore: (payload as any).cognitiveCore || (payload as any).cognitiveDesign || null,
          normalizedInput: framed,
          repairHints: null,
        };
        // 生产里（stage-enrichment）就是**裸输入**直接传，不是 { input, context }
        const stageResult: any = await executeSkill(stageDesignerDefinition, stageInput as any);
        const subs = Array.isArray(stageResult?.subtasks) ? stageResult.subtasks : [];
        const minutes = subs.reduce((sum: number, x: any) => sum + (Number(x?.estimatedMinutes) || 0), 0);
        totalTasks += subs.length;
        totalMinutes += minutes;
        perStage.push(`段${m.stageNumber}: ${subs.length}任务/${minutes}分钟`);
      }
      console.log(`  ▶ stage-design 后（真实产出）: **${totalTasks} 任务 / ${totalMinutes} 分钟 = ${(totalMinutes / 60).toFixed(1)}h**`);
      console.log(`     ${perStage.join('  |  ')}`);
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
