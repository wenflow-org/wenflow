/**
 * 字段血缘注册表（SKILL_PROTOCOL_V4 §7.2）+ 编辑分级判定（§7.1）
 *
 * 血缘为静态注册（来源：v4 预改造调查 表 B），展示字段的消费者与爆炸半径；
 * 运营编辑核心文件时按三级分类：安全（可发布）/ 受限（需开发确认）/ 阻断（parity 拦截）。
 */

import type { CoreFile } from './core-file-loader';
import { scanCoreFiles } from './core-file-loader';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface FieldLineageEntry {
  skillId: string;
  /** 字段名；'*' 表示该 skill 全部输出字段 */
  field: string;
  consumers: string[];
  note?: string;
}

/** 静态血缘注册表（随消费者变更由开发维护） */
export const FIELD_LINEAGE: FieldLineageEntry[] = [
  // goal-conversation
  { skillId: 'goal-conversation', field: 'reply', consumers: ['frontend: GoalConversation.vue（对话气泡）', 'frontend: v2/useGoalLive.ts', 'frontend: redesign/useGoalLive.ts'] },
  { skillId: 'goal-conversation', field: 'nextQuestions', consumers: ['frontend: GoalConversation.vue（追问提示）'] },
  { skillId: 'goal-conversation', field: 'quickReplies', consumers: ['frontend: GoalConversation.vue renderHints', 'frontend: useGoalLive ×2', 'frontend: constants/fieldBindings/goal.ts'] },
  { skillId: 'goal-conversation', field: 'state', consumers: ['backend: goal-conversation.service resolveStage/Confidence（阶段推进）', 'backend: runtimeEnvelope businessState'] },
  { skillId: 'goal-conversation', field: 'understanding', consumers: ['backend: goal-conversation.service updateCollectedData（主记忆持久化）', 'backend: learning.service（path-planning 输入）'] },
  { skillId: 'goal-conversation', field: 'confirmedProposal', consumers: ['backend: learning.service（path-planning confirmedProposal）', 'frontend: GoalConversation.vue（方案确认卡）'] },
  { skillId: 'goal-conversation', field: 'confidenceScores', consumers: ['backend: prompt-stability 观测（debug）'] },
  // teaching-turn
  { skillId: 'teaching-turn', field: 'reply', consumers: ['frontend: LearningPage.vue（aiResponse）', 'backend: AITeachingCoordinator（消息持久化）'] },
  { skillId: 'teaching-turn', field: 'analysis', consumers: ['frontend: LearningPage.vue', 'frontend: CognitiveStatePanel.vue（confusionPoints）'] },
  { skillId: 'teaching-turn', field: 'knowledge', consumers: ['backend: AITeachingCoordinator reconcileTeachingKnowledgeState（看板回灌）', 'frontend: LearningPage.vue（knowledgePoints）'] },
  { skillId: 'teaching-turn', field: 'pedagogy', consumers: ['frontend: LearningPage.vue（strategies）'] },
  { skillId: 'teaching-turn', field: 'control', consumers: ['backend: AITeachingCoordinator（课堂收束判断）', 'backend: peerTriggerService.shouldTrigger（同伴触发）'] },
  // session-wrapup
  { skillId: 'session-wrapup', field: 'summary', consumers: ['frontend: CompletionCard.vue', 'backend: learner.coordinator / LessonKnowledgeEnrichmentConsumer（回灌蒸馏器）'] },
  { skillId: 'session-wrapup', field: 'evaluation', consumers: ['backend: AITeachingCoordinator.endSession（持久化）', 'frontend: LearningEvaluationPage.vue'] },
  // peer-reinforcement
  { skillId: 'peer-reinforcement', field: 'message', consumers: ['frontend: LearningPage.vue（peerMessage）'] },
  { skillId: 'peer-reinforcement', field: 'followUpQuestions', consumers: ['frontend: LearningPage.vue'] },
  // adaptive-guidance-copy
  { skillId: 'adaptive-guidance-copy', field: '*', consumers: ['frontend: Dashboard.vue（引导文案）', 'frontend: V2Dashboard.vue（nextStep）'] },
  // 蒸馏/抽取家族（后台消费，无前端直接绑定）
  { skillId: 'lesson-knowledge-enricher', field: '*', consumers: ['backend: LessonKnowledgeEnrichmentConsumer（learner_evidence 表）'] },
  // path 家族
  { skillId: 'path-planning', field: '*', consumers: ['backend: learning.service persistGeneratedPath（learning_paths/milestones 表）', 'frontend: LearningPaths.vue / LearningPathDetail.vue（间接）'] },
  { skillId: 'stage-designer', field: 'subtasks', consumers: ['backend: learning.service（subtasks.create / replan 重建）', 'frontend: LearningPathDetail.vue（间接）'] },
  // virtual-learner 家族
  { skillId: 'virtual-learner-goal-dialogue-simulator', field: '*', consumers: ['backend: simulation.coordinator（stageResults.goal）'] },
  { skillId: 'virtual-learner-learn-turn-simulator', field: '*', consumers: ['backend: simulation.coordinator / quick-learn.service（transcript/report）'] },
  { skillId: 'virtual-learner-path-evaluator', field: '*', consumers: ['backend: simulation.coordinator（stageResults.path_review）'] },
  { skillId: 'virtual-learner-persona-designer', field: 'personaSeed', consumers: ['backend: admin virtual-learners 路由（persona 持久化）'] },
  { skillId: 'virtual-learner-scenario-designer', field: '*', consumers: ['backend: admin virtual-learners 路由'] },
  { skillId: 'virtual-learner-referee', field: '*', consumers: ['backend: blackbox-runner（refereeReports）', 'frontend: SessionCockpit.vue / MockSessionCockpit.vue'] },
  { skillId: 'virtual-learner-actor-auditor', field: '*', consumers: ['backend: blackbox-runner（actorAuditReports）', 'frontend: SessionCockpit.vue'] },
];

/** 查询某 skill 的血缘条目（文件优先，静态表兜底；按 mtime 缓存） */
export function getFieldLineage(skillId: string): FieldLineageEntry[] {
  return loadLineageEntries().filter((entry) => entry.skillId === skillId);
}

/**
 * §2.5 声明式血缘：静态注册表 ∪ 全仓 core inputs 声明推导。
 * 凡 core Y 的 inputs 引用 skill:X.fieldPath，即记为 X 该字段的消费者 skill:Y（inputs 声明）。
 */
export function getFieldLineageWithDeclarations(skillId: string): FieldLineageEntry[] {
  const merged = new Map<string, FieldLineageEntry>();
  for (const entry of getFieldLineage(skillId)) {
    merged.set(entry.field, { ...entry, consumers: [...entry.consumers] });
  }

  const { files } = scanCoreFiles();
  for (const core of files) {
    if (core.skillId === skillId || !core.inputs?.length) continue;
    for (const input of core.inputs) {
      // 血缘只推导 skill: 上游产物引用；sandbox（编排注入）/user（用户平台）不参与 skill 血缘
      if (input.kind !== 'skill' || input.skill !== skillId) continue;
      const consumer = `skill:${core.skillId}（inputs 声明）`;
      const existing = merged.get(input.fieldPath);
      if (existing) {
        if (!existing.consumers.includes(consumer)) existing.consumers.push(consumer);
      } else {
        merged.set(input.fieldPath, { skillId, field: input.fieldPath, consumers: [consumer] });
      }
    }
  }
  return Array.from(merged.values());
}

const LINEAGE_FILE = path.join(process.cwd(), '../prompts/field-lineage.yaml');
let lineageCache: { mtimeMs: number; entries: FieldLineageEntry[] } | null = null;

function isValidEntry(value: unknown): value is FieldLineageEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.skillId === 'string' &&
    typeof entry.field === 'string' &&
    Array.isArray(entry.consumers) &&
    entry.consumers.every((c) => typeof c === 'string')
  );
}

/** 血缘文件（prompts/field-lineage.yaml）可编辑；失效或缺席时回退内置静态表 */
function loadLineageEntries(): FieldLineageEntry[] {
  try {
    const stat = fs.statSync(LINEAGE_FILE);
    if (lineageCache && lineageCache.mtimeMs === stat.mtimeMs) {
      return lineageCache.entries;
    }
    const parsed = yaml.load(fs.readFileSync(LINEAGE_FILE, 'utf-8')) as Record<string, unknown>;
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    if (entries.length > 0 && entries.every(isValidEntry)) {
      lineageCache = { mtimeMs: stat.mtimeMs, entries: entries as FieldLineageEntry[] };
      return lineageCache.entries;
    }
  } catch {
    // 文件缺席或损坏 → 静态表兜底
  }
  return FIELD_LINEAGE;
}

export type CoreEditLevel = 'safe' | 'restricted' | 'blocked';

export interface CoreEditClassification {
  level: CoreEditLevel;
  messages: string[];
}

/** §7.1 编辑分级：比较新旧核心文件的字段表结构差异 */
export function classifyCoreEdit(oldCore: CoreFile | null, newCore: CoreFile): CoreEditClassification {
  if (!oldCore) {
    return { level: 'safe', messages: ['首次创建核心文件'] };
  }
  const messages: string[] = [];
  let level: CoreEditLevel = 'safe';

  const newFields = new Map(newCore.fields.map((field) => [field.name, field.type]));
  for (const oldField of oldCore.fields) {
    const newType = newFields.get(oldField.name);
    if (newType === undefined) {
      level = 'blocked';
      messages.push(`字段 ${oldField.name} 被删除（阻断级：需开发同步消费者后方可发布）`);
    } else if (newType !== oldField.type) {
      level = 'blocked';
      messages.push(`字段 ${oldField.name} 类型变更 ${oldField.type} → ${newType}（阻断级）`);
    }
  }
  const oldNames = new Set(oldCore.fields.map((field) => field.name));
  for (const field of newCore.fields) {
    if (!oldNames.has(field.name)) {
      if (level !== 'blocked') level = 'restricted';
      messages.push(`新增字段 ${field.name}（受限级：暂无消费者，开发接入后生效）`);
    }
  }

  if (messages.length === 0) {
    messages.push('文案级修改（安全级：守门三查通过即可发布）');
  }
  return { level, messages };
}
