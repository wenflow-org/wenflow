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
import { peerRuntimeDefinition } from '../skills/peer-reinforcement/definition';
import { sessionWrapupRuntimeDefinition } from '../skills/session-wrapup/definition';
import { learnerModelRuntimeDefinition } from '../agents/learner-model-agent/definition';
import { stageDesignerRuntimeDefinition } from '../skills/stage-designer/definition';
import { virtualLearnerPersonaDesignerRuntimeDefinition } from '../skills/virtual-learner-persona-designer/definition';
import { virtualLearnerScenarioDesignerRuntimeDefinition } from '../skills/virtual-learner-scenario-designer/definition';
import { virtualLearnerGoalDialogueSimulatorRuntimeDefinition } from '../skills/virtual-learner-goal-dialogue-simulator/definition';
import { virtualLearnerPathEvaluatorRuntimeDefinition } from '../skills/virtual-learner-path-evaluator/definition';
import { virtualLearnerLearnTurnSimulatorRuntimeDefinition } from '../skills/virtual-learner-learn-turn-simulator/definition';
import { virtualLearnerRefereeRuntimeDefinition } from '../skills/virtual-learner-referee/definition';
import { virtualLearnerActorAuditorRuntimeDefinition } from '../skills/virtual-learner-actor-auditor/definition';
import { adaptiveGuidanceCopyRuntimeDefinition } from '../skills/adaptive-guidance-copy/definition';
import { lessonKnowledgeEnricherRuntimeDefinition } from '../skills/lesson-knowledge-enricher/definition';
import { learningPredictorRuntimeDefinition } from '../skills/learning-predictor/definition';
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
  adaptiveGuidanceCopyRuntimeDefinition,
  lessonKnowledgeEnricherRuntimeDefinition,
  learningPredictorRuntimeDefinition,
];

export const ORCHESTRATOR_RUNTIME_DEFINITIONS = [
  goalAgentRuntimeDefinition,
  pathOrchestratorRuntimeDefinition,
  AITeachingCoordinatorRuntimeDefinition,
  learnerAgentRuntimeDefinition,
  simulationAgentRuntimeDefinition,
];
