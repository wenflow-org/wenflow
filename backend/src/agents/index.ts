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
export { pathAgentDefinition, pathAgentHandler as pathAgentHandlerFn, replanPath } from './path-agent';

// Goal Conversation Agent
export {
  goalConversationAgentDefinition,
  goalConversationAgentHandler,
  runGoalConversationAgent
} from './goal-conversation-agent';

// User Profile Agent
export {
  learnerModelAgentDefinition,
  learnerModelAgentHandler as learnerModelAgentHandlerFn,
  LearnerModelAgent,
  learnerModelAgent
} from './learner-model-agent';

export {
  teachingTurnAgentDefinition,
  teachingTurnAgentHandler,
} from './teaching-turn-agent';

export {
  sessionWrapupAgentDefinition,
  sessionWrapupAgent,
  sessionWrapupAgentHandler,
} from './session-wrapup-agent';

// Simulation Orchestrator Agent
export {
  simulationOrchestratorAgentDefinition,
  simulationOrchestratorAgentHandler,
  simulationOrchestrator
} from './simulation-orchestrator-agent';

// Path Adjustment
export {
  pathAdjustmentEngine,
  PathAdjustment,
  AdjustmentType,
  AdjustmentTarget,
  AdjustmentReason
} from './path-agent/adjustment';

export {
  allAdjustmentStrategies,
  getApplicableStrategies
} from './path-agent/strategies';

// 插件
export { genericPlanner } from './path-planner/plugins/generic-planner';
export { basicGenerator } from './content-generator/plugins/basic-generator';

// Content Strategy Selector
export {
  ContentStrategySelector,
  contentStrategySelector,
  selectContentStrategy,
  inferCognitiveLoad,
  type ContentStrategy,
  type TaskType,
  type CognitiveLoad,
  type TaskMetadata,
  type StrategySelection,
  type StrategyConfig
} from './content-strategy-selector';

// 所有 Agent 定义
import { AgentDefinition } from './protocol';
import { pathAgentDefinition, pathAgentHandler as pathAgentHandlerFn } from './path-agent';
import { learnerModelAgentDefinition, learnerModelAgentHandler as learnerModelAgentHandlerFn } from './learner-model-agent';
import { goalConversationAgentDefinition, goalConversationAgentHandler } from './goal-conversation-agent';
import { teachingTurnAgentDefinition, teachingTurnAgentHandler } from './teaching-turn-agent';
import { peerAgentHandler } from './peer-agent';
import { sessionWrapupAgentDefinition, sessionWrapupAgentHandler } from './session-wrapup-agent';
import { simulationOrchestratorAgentDefinition, simulationOrchestratorAgentHandler } from './simulation-orchestrator-agent';
import { getAgentManifest } from '../services/agent-manifest.service';
import { logger } from '../utils/logger';

export const allAgentDefinitions: AgentDefinition[] = [
  pathAgentDefinition,
  learnerModelAgentDefinition,
  goalConversationAgentDefinition,
  teachingTurnAgentDefinition,
  sessionWrapupAgentDefinition,
  simulationOrchestratorAgentDefinition
];

export const agentHandlers: Record<string, (input: any, context: any) => Promise<any>> = {
  'path-agent': pathAgentHandlerFn,
  'learner-model-agent': learnerModelAgentHandlerFn,
  'goal-conversation-agent': goalConversationAgentHandler,
  'teaching-turn-agent': teachingTurnAgentHandler,
  'skill:peer-reinforcement': peerAgentHandler,
  'session-wrapup-agent': sessionWrapupAgentHandler,
  'simulation-orchestrator': simulationOrchestratorAgentHandler
};

/**
 * 注册所有官方 Agent 到 Gateway
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
