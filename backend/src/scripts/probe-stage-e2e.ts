/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * stage 节点端到端探针（审计 P0 §1.4 / P1 §2.3a / §2.3b / §2.3c）。
 *
 * 与生产的同源性：
 *   ① 真生成一条路径（真 LLM）→ 读回**真实落库**的 aiPromptTemplate
 *   ② 用生产的 `parsePathCognitiveDesign` 解析它（§2.3a 的修复点：loadProfile 是否还在）
 *   ③ 把结果按 `stage-enrichment` 的形状喂给**真实 stage-designer skill**（真 LLM），
 *      再读回真实下发的 userPayload 核对：loadTarget 是否注入（§2.3a）、
 *      normalizedInput.resources.materials 是否已被剥离（§2.3c）、顶层 materials 是否在（§1.4 声明的通道）
 *   ④ 无资料再跑一次，核对模型编造的 materialRefs 是否被删（§2.3b）
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-stage-e2e.ts [--user=<userId>] [--keep]
 */
import 'dotenv/config';
import prisma from '../config/database';
import pathOrchestrator from '../coordinators/path.coordinator';
import { executeSkill } from '../skills';
import { stageDesignerDefinition } from '../skills/stage-designer';
import { parsePathCognitiveDesign } from '../services/learning/learning.helpers';
import goalConversationService from '../services/learning/goal-conversation.service';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const MATERIALS = [{
  title: '汇报结构讲义',
  sourceUrl: null,
  materialId: 'mat-e2e',
  publisher: null,
  sourceTier: null,
  tldr: '汇报结构：结论—依据—请求。先把结论放最前面，再给依据。',
  sections: [{ id: 's-1', title: '第一章 结论先行' }],
  keyPoints: [{ cite: '先给结论，再给依据', text: '汇报要先给结论，再给依据，最后给请求。' }],
}];

async function pickUserId(): Promise<string> {
  const explicit = arg('user');
  if (explicit) return explicit;
  const vl = await prisma.users.findFirst({
    where: { isVirtualLearner: true } as any, select: { id: true, name: true }, orderBy: { createdAt: 'asc' },
  });
  if (!vl) throw new Error('库里没有虚拟学习者；请用 --user=<userId> 指定');
  console.log(`[probe] 使用虚拟学习者 ${vl.id} (${vl.name})`);
  return vl.id;
}

async function main() {
  const userId = await pickUserId();
  const understanding = { realProblem: '汇报时被追问逻辑就乱，缺问题框架', surfaceGoal: '想学会向上汇报' };
  const conversation = {
    id: `probe-conv-${Date.now()}`, userId, description: '想学会向上汇报', learningPathId: null,
    collectedData: JSON.stringify({ messages: [], understanding, collected: {}, confirmedProposal: null }),
  };
  const aiResponse = {
    userVisible: '好的。',
    internal: { core: { stage: 'completed', confidence: 0.95, isCompleted: true }, ext: { goalConversation: { understanding, nextQuestions: [], collected: {} } } },
  };

  // ① 真生成路径
  const request: any = await (goalConversationService as any).buildGoalPathRequest(conversation, aiResponse);
  const generated: any = await pathOrchestrator.generateFromGoal(request);
  const pathId = generated?.id || generated?.path?.id || null;
  console.log('[probe] ① pathId =', pathId, '| milestones =', generated?.milestones?.length ?? 'n/a');

  // ② 真实落库模板 → 生产解析（§2.3a 修复点）
  const row = pathId
    ? await prisma.learning_paths.findUnique({ where: { id: pathId }, select: { aiPromptTemplate: true, milestones: { orderBy: { stageNumber: 'asc' }, select: { stageNumber: true, title: true, coreConceptId: true } } } })
    : null;
  const design: any = parsePathCognitiveDesign(row?.aiPromptTemplate || null);
  const dist = design?.loadProfile?.stageLoadDistribution;
  console.log('[probe] ② parsePathCognitiveDesign：cognitiveDomain =', design?.cognitiveDomain ?? '(null)',
    '| loadProfile.stageLoadDistribution =', Array.isArray(dist) ? `${dist.length} 项` : '(缺失)');
  if (!Array.isArray(dist) || dist.length === 0) {
    console.log('[probe] ⚠ 真实路径的 cognitiveDesign 里没有 loadProfile（模型未产出）——loadTarget 无输入可挂，本步无法观测');
  }

  const firstMilestone = row?.milestones?.[0];
  const milestone = {
    stageNumber: firstMilestone?.stageNumber ?? 1,
    title: firstMilestone?.title ?? '识别问题结构',
    coreConcept: firstMilestone?.coreConceptId ?? 'concept-1',
  };
  const normalizedInput = {
    version: '1.0',
    learnerProfile: { surfaceGoal: '想学会向上汇报' },
    problemSpace: { realProblem: '汇报被追问逻辑就乱' },
    resources: { timeBudget: '每周5小时', materials: MATERIALS },
  };

  // ③ 有资料：真跑 stage-designer
  const startedAt = new Date();
  const withMaterials = await executeSkill(stageDesignerDefinition, {
    milestone, cognitiveCore: design, normalizedInput, materials: MATERIALS,
  } as any);
  const tasks = (withMaterials as any)?.subtasks || (withMaterials as any)?.internal?.ext?.stage?.subtasks || [];
  console.log('[probe] ③ 有资料：产出 tasks =', Array.isArray(tasks) ? tasks.length : 'n/a');

  await new Promise((r) => setTimeout(r, 3000));
  const calls = await prisma.prompt_call_logs.findMany({
    where: { agentId: 'skill:stage-designer', createdAt: { gte: startedAt } },
    select: { userPayload: true }, orderBy: { createdAt: 'desc' },
  });
  // 载荷是 JSON；必须解析后按字段判断——用正则找 "resources"…"materials" 会把紧随其后的
  // **顶层** materials 也算进去，得到假阳性。
  const parsedCalls = calls.map((c) => { try { return JSON.parse(c.userPayload || ''); } catch { return null; } }).filter(Boolean) as any[];
  const withMat = parsedCalls.find((p) => Array.isArray(p.materials) && p.materials.length > 0) || null;
  const hasLoadTarget = Boolean(withMat?.milestone?.loadTarget) || parsedCalls.some((p) => p.milestone?.loadTarget);
  const nestedStill = parsedCalls.some((p) => p.normalizedInput?.resources?.materials !== undefined);
  console.log(`[probe]   带资料的载荷 = ${withMat ? '有' : '无'} | 顶层 materials 数组 = ${Array.isArray(withMat?.materials) ? withMat.materials.length : 'n/a'}`);
  console.log(`[probe]   载荷含 loadTarget = ${hasLoadTarget} | 嵌套 resources.materials 仍在 = ${nestedStill}`);
  if (Array.isArray(tasks)) {
    const withRefs = tasks.filter((t: any) => Array.isArray(t.materialRefs) && t.materialRefs.length > 0);
    console.log(`[probe]   落库任务带 materialRefs = ${withRefs.length}/${tasks.length}（有资料时应 >0 且逐字核对）`);
  }

  // ④ 无资料：真跑一次，核对编造引用被删（§2.3b）
  const noMatStarted = new Date();
  const withoutMaterials = await executeSkill(stageDesignerDefinition, {
    milestone, cognitiveCore: design, normalizedInput: { ...normalizedInput, resources: { timeBudget: '每周5小时' } }, materials: null,
  } as any);
  const tasksNoMat = (withoutMaterials as any)?.subtasks || (withoutMaterials as any)?.internal?.ext?.stage?.subtasks || [];
  const fabricated = Array.isArray(tasksNoMat) ? tasksNoMat.filter((t: any) => Array.isArray(t.materialRefs) && t.materialRefs.length > 0).length : -1;
  console.log(`[probe] ④ 无资料：产出 tasks = ${Array.isArray(tasksNoMat) ? tasksNoMat.length : 'n/a'} | 残留 materialRefs 的任务数 = ${fabricated}（应为 0）`);
  void noMatStarted;

  const ok = (!Array.isArray(dist) || dist.length === 0 ? true : hasLoadTarget) && !nestedStill && Boolean(withMat) && fabricated === 0;
  console.log(ok
    ? '[probe] PASS stage 载荷：单一资料投递 + 无编造引用' + (Array.isArray(dist) && dist.length ? ' + loadTarget 注入' : '')
    : '[probe] CHECK 见上方逐项');

  if (pathId && !hasFlag('keep')) {
    try { await prisma.learning_paths.delete({ where: { id: pathId } }); console.log('[probe] 已清理测试路径', pathId); }
    catch (error) { console.log('[probe] 清理失败（请手工删）:', pathId, (error as Error).message); }
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
