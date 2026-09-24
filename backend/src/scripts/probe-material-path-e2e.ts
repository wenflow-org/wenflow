/* eslint-disable no-console -- 一次性验收 CLI：面向人读的输出 */
/**
 * 「附件 → 生产 path」端到端验收探针。
 *
 * 与生产的同源性：不另写一条组装路径，而是直接走**生产入口**
 *   ① 上传解析：`services/materials`（与前端上传接口同一函数）
 *   ② 输入装配：`pathOrchestrator.previewNormalizedGoalInput`（= 生产 generateFromGoal 用的同一装配）
 *   ③ 真生成：`pathOrchestrator.generateFromGoal`（= `goal-conversation.service` 确认方案后调的那个）
 *
 * 用法：
 *   # 只验接线（不落路径库）：上传真件 + 打印 framed materials
 *   npx ts-node --transpile-only src/scripts/probe-material-path-e2e.ts \
 *       --material=../text/指南-抽取.txt --goal="我想系统学习《3-6岁儿童学习与发展指南》…"
 *
 *   # 真生成一条路径（落库）并核对里程碑是否引用了资料条目
 *   npx ts-node --transpile-only src/scripts/probe-material-path-e2e.ts --generate --user=auto ...
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { saveUploadedMaterial } from '../services/materials/material-upload.service';
import { resolveMaterialsRoot } from '../services/materials/material-store';
import pathOrchestrator from '../coordinators/path.coordinator';

const DB_PATH = path.resolve(__dirname, '..', '..', 'prisma', 'dev.db');

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function argAll(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const MATERIALS = argAll('material');
const GOAL = arg('goal') || '我想系统学习《3-6岁儿童学习与发展指南》，弄懂它对3-6岁孩子在各领域的发展要求，能用来判断身边孩子的发展情况';
const GENERATE = hasFlag('generate');
const USER_ARG = arg('user') || 'auto';

/** 只读取一个已存在的用户 id（learning_paths.userId 是外键，探针需要一个真实用户）。 */
function pickUserId(): Promise<string> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
    db.get('SELECT id, name FROM users ORDER BY updatedAt DESC LIMIT 1', (error: Error | null, row: any) => {
      db.close();
      if (error || !row?.id) return reject(error || new Error('users 表为空，找不到可用于探针的用户'));
      console.log(`[probe] 使用已有用户：${row.name || ''}（${row.id}）`);
      resolve(String(row.id));
    });
  });
}

/**
 * 读取**生产真实输入快照**（`path_generation_runs.inputSnapshot`，由生产链路落库）。
 *
 * 为什么需要它：探针自造的瘦输入（只有 rawGoal + 少量 visibleSummary）与生产分布差异大，
 * 会放大模型对输出契约的跑偏（实测：hub 缺失率远高于生产）。用真实快照当基座，
 * 变更点只剩"用户上传的附件"，符合单变量对照。
 */
function loadLatestSnapshot(): Promise<any | null> {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
    db.get(
      "SELECT inputSnapshot FROM path_generation_runs WHERE phase='core' AND status='succeeded' AND inputSnapshot IS NOT NULL ORDER BY createdAt DESC LIMIT 1",
      (error: Error | null, row: any) => {
        db.close();
        if (error || !row?.inputSnapshot) return resolve(null);
        try {
          resolve(JSON.parse(row.inputSnapshot));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

/** 与生产同源的 visibleSummary（字段名取自 GoalPathVisibleSummary）。 */
function buildVisibleSummary(goal: string) {
  const shortGoal = goal.replace(/\s+/g, ' ').slice(0, 40);
  return {
    surfaceGoal: goal,
    realProblem: `想真正拿下「${shortGoal}」，但缺少可操作的判断依据`,
    painPoints: ['学过但记不住', '不知道怎样落到具体判断'],
    constraintsAndBoundaries: [],
    currentBaseline: { level: 'beginner', evidence: null },
    resources: {
      timeBudget: '每周 3 小时',
      timeBudgetCadence: 'per_week',
      timePerWeek: '每周 3 小时',
      timePerSession: '45 分钟',
      timeHorizon: '1 个月',
      deadlineText: null,
    },
    successCriteria: { observableResult: `能独立完成「${shortGoal}」相关的判断`, acceptanceCheck: null },
    confirmedProposal: {
      learningDirection: `围绕「${shortGoal}」建立判断框架`,
      firstDeliverable: '一份自己的判断清单',
      keyStages: ['建立结构', '把目标读成可观察表现', '对照具体对象判断'],
      outOfScope: [],
      scopeSize: null,
    },
  };
}

/** 里程碑是否引用了资料条目（可核对）：命中 section 标题或与某条引文有足够长的公共片段。 */
function countMaterialReferences(milestones: any[], sections: string[], cites: string[]): { hit: number; detail: string[] } {
  let hit = 0;
  const detail: string[] = [];
  for (const milestone of milestones) {
    const text = [milestone?.title, milestone?.goal, milestone?.description].filter(Boolean).join(' ');
    const sectionHit = sections.find((title) => title && text.includes(title));
    const citeHit = sectionHit ? null : cites.find((cite) => {
      for (let len = Math.min(14, cite.length); len >= 8; len -= 2) {
        if (text.includes(cite.slice(0, len))) return true;
      }
      return false;
    });
    if (sectionHit || citeHit) {
      hit += 1;
      detail.push(`段${milestone?.stageNumber ?? '?'} ← ${sectionHit ? `章节「${sectionHit}」` : '资料原文片段'}`);
    }
  }
  return { hit, detail };
}

async function main(): Promise<void> {
  console.log(`[probe] 资料库根目录：${resolveMaterialsRoot()}`);
  const userId = USER_ARG === 'auto' ? await pickUserId() : USER_ARG;

  // --reset：先清空该用户已上传资料，保证"本次只注入这几份"（干净对照）
  if (hasFlag('reset')) {
    const { listMaterials, deleteMaterial } = await import('../services/materials/material-store');
    let removed = 0;
    for (const record of listMaterials(userId)) {
      if (deleteMaterial(userId, record.id)) removed += 1;
    }
    console.log(`[probe] 已清空历史资料 ${removed} 份`);
  }

  // ---- ① 上传（与前端接口同一函数：解析 + 文本层闸门 + 落盘）----
  if (MATERIALS.length) {
    for (const file of MATERIALS) {
      const buffer = fs.readFileSync(path.resolve(file));
      const saved = await saveUploadedMaterial({ userId, originalName: path.basename(file), buffer });
      if (saved.ok) {
        console.log(`  ⇢ 上传成功：${saved.record!.name}｜${saved.record!.charCount} 字｜章节锚点 ${saved.record!.anchors.length}`);
      } else {
        console.log(`  ⇢ 已拒收：${path.basename(file)} → [${saved.reason}] ${saved.message}`);
      }
    }
  }

  // ---- ② 生产输入装配（同一函数被 generateFromGoal 使用）----
  // 基座优先用生产真实快照（单变量：只变"有没有附件"），拿不到时退回自造输入。
  let request: any = {
    userId,
    rawGoal: GOAL,
    visibleSummary: buildVisibleSummary(GOAL),
  };
  if (hasFlag('from-snapshot')) {
    const snapshot = await loadLatestSnapshot();
    const goalPayload = snapshot?.userProfile?.goalFinalPayload || {};
    if (snapshot && goalPayload.rawGoal) {
      request = {
        userId,
        rawGoal: arg('goal') || goalPayload.rawGoal,
        visibleSummary: goalPayload.visibleSummary || null,
        conversationHistory: goalPayload.conversationHistory || [],
        goalHandoffFields: goalPayload.goalHandoffFields || undefined,
        structuredData: snapshot.userProfile?.structuredData || null,
        sourceConversationId: goalPayload.sourceConversationId || undefined,
      };
      console.log(`[probe] 基座=生产快照｜rawGoal：${String(request.rawGoal).slice(0, 60)}…`);
    } else {
      console.log('[probe] 未找到可用生产快照，退回自造输入');
    }
  }
  // --needs[=《资料名》]：goal 声明 needsMaterial（visibleSummary 白名单透传）→ 触发联网采集。
  // 纯联网对照实验用：配一个无上传附件的 user，即得「不走文档、只联网」的路径。
  const needsEnabled = hasFlag('needs') || !!arg('needs');
  if (needsEnabled) {
    const needTitle = arg('needs') || '《3-6岁儿童学习与发展指南》';
    request.visibleSummary.needsMaterial = [{
      kind: arg('need-kind') || '指南',
      title: needTitle,
      why: '目标指定的对照文本，路径内容依赖它',
      queries: [needTitle.replace(/[《》]/g, ''), `${needTitle.replace(/[《》]/g, '')} 全文`].slice(0, 2),
    }];
    console.log(`[probe] 声明 needsMaterial（触发联网采集）：${needTitle}`);
  }
  const normalized = await pathOrchestrator.previewNormalizedGoalInput(request);
  console.log(`[probe] 诉求（rawGoal）：${String(request.rawGoal || '').slice(0, 70)}`);

  const materials = normalized.userProfile.normalizedInput.resources.materials as any[] | undefined;
  console.log(`\n[probe] framed.resources.materials = ${Array.isArray(materials) ? `${materials.length} 包` : 'MISSING（未送达 path）'}`);
  const sections: string[] = [];
  const cites: string[] = [];
  for (const item of materials || []) {
    const pack = item?.pack;
    console.log(`   · ${item?.status}｜${pack?.title ?? '(无包)'}｜${pack?.sourceUrl ?? '-'}｜章节 ${pack?.sections?.length ?? 0}｜要点 ${pack?.keyPoints?.length ?? 0}`);
    if (pack?.sections?.length) {
      console.log(`     章节示例：${pack.sections.slice(0, 6).map((s: any) => s.title).join(' / ')}`);
    }
    if (item?.notes?.length) console.log(`     备注：${String(item.notes[0]).slice(0, 90)}`);
    for (const section of pack?.sections || []) sections.push(String(section.title));
    for (const point of pack?.keyPoints || []) cites.push(String(point.cite));
  }
  if (materials?.length) {
    console.log(`     首条要点引文（逐字）：${String(cites[0] || '').slice(0, 70)}`);
  }

  if (!GENERATE) {
    console.log('\n[probe] 未加 --generate：只验接线（未落路径库）。');
    return;
  }

  // ---- ③ 真生成路径（生产入口）----
  console.log('\n[probe] 调用 generateFromGoal（生产入口，会落库）…');
  const startedAt = Date.now();
  const result: any = await pathOrchestrator.generateFromGoal(request);
  const payload = result?.path || result?.data?.path || result;
  const milestones = Array.isArray(payload?.milestones) ? payload.milestones : [];
  console.log(`  ⇢ 生成完成 ${Date.now() - startedAt}ms｜pathId=${payload?.id ?? result?.id ?? '-'}`);
  console.log(`  ⇢ 名称：${payload?.name ?? '-'}`);
  console.log(`  ⇢ 段数 ${milestones.length}｜学时 ${payload?.estimatedHours ?? '-'}｜周 ${payload?.estimatedWeeks ?? '-'}`);

  const reference = countMaterialReferences(milestones, sections, cites);
  console.log(`  ⇢ 里程碑文本命中资料章节（粗筛，权威口径见 probe-material-learn-wiring.ts 的 materialRefs）：${reference.hit}/${milestones.length}`);
  for (const line of reference.detail) console.log(`     ${line}`);
  for (const milestone of milestones) {
    console.log(`     【${milestone?.stageNumber ?? ''}】${milestone?.title ?? ''}`);
  }

  // ---- ④ 下游 learn 验收：资料是否也能被"学习者可见"与"课堂"拿到 ----
  const pathId = payload?.id ?? result?.id;
  if (pathId) {
    try {
      const { getLearningPath } = await import('../services/learning/queries/path-views.queries');
      const detail: any = await getLearningPath(String(pathId));
      const learnerMaterials = detail?.materials;
      console.log(`  ⇢ 学习者侧（路径详情顶层 materials）：${Array.isArray(learnerMaterials) ? `${learnerMaterials.length} 包` : 'null'}`);
      if (Array.isArray(learnerMaterials) && learnerMaterials[0]) {
        console.log(`     首包：${learnerMaterials[0].title}｜章节 ${learnerMaterials[0].sections?.length ?? 0}｜要点 ${learnerMaterials[0].keyPoints?.length ?? 0}`);
      }
    } catch (error) {
      console.log(`  ⇢ 学习者侧检查失败：${String((error as Error)?.message || error).slice(0, 80)}`);
    }

    try {
      const { prisma } = await import('../config/database');
      const row: any = await (prisma as any).learning_paths.findUnique({
        where: { id: String(pathId) },
        select: { aiPromptTemplate: true },
      });
      const { resolvePathMaterialsForTeaching } = await import('../services/ai-teaching/TeachingContextBuilder');
      const teachingMaterials = resolvePathMaterialsForTeaching(row?.aiPromptTemplate || null);
      console.log(`  ⇢ 课堂侧（teaching-turn scenario.materials）：${Array.isArray(teachingMaterials) ? `${teachingMaterials.length} 包` : 'null'}`);
    } catch (error) {
      console.log(`  ⇢ 课堂侧检查失败：${String((error as Error)?.message || error).slice(0, 80)}`);
    }
  }
}

void main().catch((error) => {
  console.error('[probe] 失败', error);
  process.exitCode = 1;
});
