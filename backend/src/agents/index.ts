/**
 * Agents 入口文件
 *
 * 统一导出所有 Agent
 */

// 协议
export { 
  AgentType, 
  AgentCategory, 
  AgentInput, 
  AgentOutput, 
  AgentDefinition,
  AgentContext,
  AgentExecutionRequest,
  AgentExecutionResult,
  LearningSignal,
  ProgressMetrics
} from './protocol';

// 新的插件系统 - 使用别名避免冲突
export { 
  AgentPlugin, 
  AgentConfig,
  AgentRegistration,
  AgentPluginFactory 
} from './plugin-types';
export { agentPluginRegistry } from './plugin-registry';

// 配置 - 修复导出名称
export { agentPluginConfig } from '../config/agent-plugin-config';
export { registerAllPlugins, getAllPlugins } from './plugins';

// Path Agent
export { pathAgentDefinition, pathAgentHandler as pathAgentHandlerFn } from '../skills/path-planning';

// Goal Conversation Agent
export {
  goalConversationAgentDefinition,
  goalConversationAgentHandler,
  runGoalConversationAgent
} from '../skills/goal-conversation';

// User Profile Agent
export {
  learnerModelAgentDefinition,
  learnerModelAgentHandler as learnerModelAgentHandlerFn,
  LearnerModelAgent,
  learnerModelAgent
} from './learner-model-agent';

export {
  learningTurnAgentDefinition,
  learningTurnAgentHandler,
} from '../skills/learning-turn';

export {
  sessionWrapupAgentDefinition,
  sessionWrapupAgent,
  sessionWrapupAgentHandler,
} from '../skills/session-wrapup';

// Simulation Orchestrator Agent
export {
  simulationOrchestratorAgentDefinition,
  simulationOrchestratorAgentHandler,
  simulationOrchestrator
} from './simulation-agent';

// Path Adjustment
export {
  pathAdjustmentEngine,
  PathAdjustment,
  AdjustmentType,
  AdjustmentTarget,
  AdjustmentReason
} from '../skills/path-planning/adjustment';

export {
  allAdjustmentStrategies,
  getApplicableStrategies
} from '../skills/path-planning/strategies';

// 插件
export { genericPlanner } from './path-planner/plugins/generic-planner';
export { basicGenerator } from './content-generator/plugins/basic-generator';

// 所有 Agent 定义
import { AgentDefinition } from './protocol';
import { pathAgentDefinition, pathAgentHandler as pathAgentHandlerFn } from '../skills/path-planning';
import { learnerModelAgentDefinition, learnerModelAgentHandler as learnerModelAgentHandlerFn } from './learner-model-agent';
import { goalConversationAgentDefinition, goalConversationAgentHandler } from '../skills/goal-conversation';
import { learningTurnAgentDefinition, learningTurnAgentHandler } from '../skills/learning-turn';
import { peerAgentDefinition, peerAgentHandler } from '../skills/peer-reinforcement';
import { sessionWrapupAgentDefinition, sessionWrapupAgentHandler } from '../skills/session-wrapup';
import { simulationOrchestratorAgentDefinition, simulationOrchestratorAgentHandler } from './simulation-agent';
import { getAgentManifest } from '../services/agent-manifest.service';
import { logger } from '../utils/logger';

export const allAgentDefinitions: AgentDefinition[] = [
  pathAgentDefinition,
  learnerModelAgentDefinition,
  goalConversationAgentDefinition,
  learningTurnAgentDefinition,
  peerAgentDefinition,
  sessionWrapupAgentDefinition,
  simulationOrchestratorAgentDefinition
];

export const agentHandlers: Record<string, (input: any, context: any) => Promise<any>> = {
  'skill:path-planning': pathAgentHandlerFn,
  'skill:learner-model': learnerModelAgentHandlerFn,
  'skill:goal-conversation': goalConversationAgentHandler,
  'skill:learning-turn': learningTurnAgentHandler,
  'skill:peer-reinforcement': peerAgentHandler,
  'skill:session-wrapup': sessionWrapupAgentHandler,
  'simulation-agent': simulationOrchestratorAgentHandler
};

/**
 * 注册所有官方 Agent 到 Gateway
 *
 * 真理源：agent-manifest.service.ts。`allAgentDefinitions` 必须与 manifest 中
 * runtimeEnabled 的条目对齐——manifest 缺失或 runtimeEnabled=false 的不注册。
 * 注意：核心 LLM 能力单元（goal/path/teaching/peer/wrapup）在 manifest 里 kind='skill'，
 * 业务主链通过 skills/executeSkill 调用并计入 skill_registrations 统计；
 * 此处的 gateway.registerAgent 仅用于 gateway 侧 agent-registry 的可发现性。
 */
export async function registerOfficialAgents(gateway: {
  registerAgent: (definition: AgentDefinition, handler: any) => Promise<string>
}): Promise<void> {
  for (const definition of allAgentDefinitions) {
    const manifest = getAgentManifest(definition.id);
    if (manifest && !manifest.runtimeEnabled) {
      logger.info('[agents] skipped disabled official agent', {
        agentId: definition.id,
        agentName: definition.name,
      });
      continue;
    }

    const handler = agentHandlers[definition.id];
    if (handler) {
      await gateway.registerAgent(definition, handler);
      logger.info('[agents] registered official agent', {
        agentId: definition.id,
        agentName: definition.name,
      });
    }
  }
}

