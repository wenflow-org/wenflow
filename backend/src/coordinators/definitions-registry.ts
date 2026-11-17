/**
 * 统一定义注册表（定义层单一代码源）
 *
 * 取代已废弃的 scripts/sync-runtime-definitions.ts（表镜像方案）：
 * admin API 直接从此处 import 实时编译，天然与代码一致，无镜像漂移。
 *
 * 三层定义权威：
 * - Agent 层：services/agent-manifest.service.ts（运行时唯一真理源）
 * - 编排层：coordinators 目录的 definition 文件（本文件 ORCHESTRATOR_RUNTIME_DEFINITIONS）
 * - Skill 层：prompts/core 的 core.yaml + skills 目录的 definition 文件（本文件 SKILL_RUNTIME_DEFINITIONS）
 */
import { pathAgentRuntimeDefinition } from '../skills/path-planning/definition';
import { goalConversationRuntimeDefinition } from '../skills/goal-conversation/definition';
import { teachingTurnRuntimeDefinition } from '../skills/teaching-turn/definition';
import { peerRuntimeDefinition } from '../skills/teaching-peer-reinforcement/definition';
import { sessionWrapupRuntimeDefinition } from '../skills/teaching-wrapup/definition';
import { learnerModelRuntimeDefinition } from '../agents/profile-learner-model-agent/definition';
import { stageDesignerRuntimeDefinition } from '../skills/path-task-design/definition';
import { virtualLearnerPersonaDesignerRuntimeDefinition } from '../skills/simulation-persona-designer/definition';
import { virtualLearnerScenarioDesignerRuntimeDefinition } from '../skills/simulation-scenario-designer/definition';
import { virtualLearnerGoalDialogueSimulatorRuntimeDefinition } from '../skills/simulation-goal-dialogue/definition';
import { virtualLearnerPathEvaluatorRuntimeDefinition } from '../skills/simulation-path-evaluate/definition';
import { virtualLearnerLearnTurnSimulatorRuntimeDefinition } from '../skills/simulation-learn-turn/definition';
import { virtualLearnerRefereeRuntimeDefinition } from '../skills/simulation-referee/definition';
import { virtualLearnerActorAuditorRuntimeDefinition } from '../skills/simulation-actor-audit/definition';
import { virtualLearnerEpistemicGroundingRuntimeDefinition } from '../skills/simulation-epistemic-grounding/definition';
import { adaptiveGuidanceCopyRuntimeDefinition } from '../skills/profile-adaptive-copy/definition';
import { lessonKnowledgeEnricherRuntimeDefinition } from '../skills/profile-lesson-enrich/definition';
import { learningPredictorRuntimeDefinition } from '../skills/profile-learning-predict/definition';
import { pathReviewerRuntimeDefinition } from '../skills/path-reviewer/definition';
import { kcMapperRuntimeDefinition } from '../skills/path-kc-mapping/definition';
import { virtualLearnerMemoryCuratorRuntimeDefinition } from '../skills/simulation-memory-curate/definition';
import { goalAgentRuntimeDefinition } from './goal.definition';
import { pathAgentRuntimeDefinition as pathOrchestratorRuntimeDefinition } from './path.definition';
import { AITeachingCoordinatorRuntimeDefinition } from './ai-teaching.definition';
import { learnerAgentRuntimeDefinition } from './learner.definition';
import { simulationAgentRuntimeDefinition } from './simulation.definition';

export const SKILL_RUNTIME_DEFINITIONS = [
  pathAgentRuntimeDefinition,
  goalConversationRuntimeDefinition,
  learnerModelRuntimeDefinition,
  teachingTurnRuntimeDefinition,
  peerRuntimeDefinition,
  sessionWrapupRuntimeDefinition,
  stageDesignerRuntimeDefinition,
  virtualLearnerPersonaDesignerRuntimeDefinition,
  virtualLearnerScenarioDesignerRuntimeDefinition,
  virtualLearnerGoalDialogueSimulatorRuntimeDefinition,
  virtualLearnerPathEvaluatorRuntimeDefinition,
  virtualLearnerLearnTurnSimulatorRuntimeDefinition,
  virtualLearnerRefereeRuntimeDefinition,
  virtualLearnerActorAuditorRuntimeDefinition,
  virtualLearnerEpistemicGroundingRuntimeDefinition,
  adaptiveGuidanceCopyRuntimeDefinition,
  lessonKnowledgeEnricherRuntimeDefinition,
  learningPredictorRuntimeDefinition,
  pathReviewerRuntimeDefinition,
  kcMapperRuntimeDefinition,
  virtualLearnerMemoryCuratorRuntimeDefinition,
];

export const ORCHESTRATOR_RUNTIME_DEFINITIONS = [
  goalAgentRuntimeDefinition,
  pathOrchestratorRuntimeDefinition,
  AITeachingCoordinatorRuntimeDefinition,
  learnerAgentRuntimeDefinition,
  simulationAgentRuntimeDefinition,
];
