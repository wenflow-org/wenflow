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

// Content Agent v3.0 (状态感知对话型)
export { 
  contentAgentV3Definition, 
  registerContentAgentV3,
  ContentAgentV3 
} from './content-agent-v3';

// Progress Agent
export {
  progressAgentDefinition,
  progressAgentHandler as progressAgentHandlerFn,
  setupProgressAgentListeners
} from './progress-agent';

// Goal Conversation Agent
export {
  goalConversationAgentDefinition,
  goalConversationAgentHandler,
  runGoalConversationAgent
} from './goal-conversation-agent';

// User Profile Agent
export {
  userProfileAgentDefinition,
  userProfileAgentHandler as userProfileAgentHandlerFn,
  UserProfileAgent,
  userProfileAgent
} from './user-profile-agent';

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
import { contentAgentV3Definition, ContentAgentV3 } from './content-agent-v3';
import { progressAgentDefinition, progressAgentHandler as progressAgentHandlerFn } from './progress-agent';
import { userProfileAgentDefinition, userProfileAgentHandler as userProfileAgentHandlerFn } from './user-profile-agent';
import { goalConversationAgentDefinition, goalConversationAgentHandler } from './goal-conversation-agent';
import { peerAgentDefinition, peerAgentHandler } from './peer-agent';
import { summaryAgentDefinition, summaryAgentHandler } from './summary-agent';
import { sessionEvaluationAgentDefinition, sessionEvaluationAgentHandler } from './session-evaluation-agent';
import { getAgentManifest } from '../services/agent-manifest.service';

export const allAgentDefinitions: AgentDefinition[] = [
  pathAgentDefinition,
  contentAgentV3Definition,
  progressAgentDefinition,
  userProfileAgentDefinition,
  goalConversationAgentDefinition,
  peerAgentDefinition,
  summaryAgentDefinition,
  sessionEvaluationAgentDefinition
];

export const agentHandlers: Record<string, (input: any, context: any) => Promise<any>> = {
  'path-agent': pathAgentHandlerFn,
  'content-agent-v3': async (input: any, context: any) => {
    const agent = new ContentAgentV3();
    return await (agent as any).execute(input);
  },
  'progress-agent': progressAgentHandlerFn,
  'user-profile-agent': userProfileAgentHandlerFn,
  'goal-conversation-agent': goalConversationAgentHandler,
  'peer-agent': peerAgentHandler,
  'summary-agent': summaryAgentHandler,
  'session-evaluation-agent': sessionEvaluationAgentHandler
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
      console.log(`[Agents] Skipped (disabled): ${definition.name}`);
      continue;
    }

    const handler = agentHandlers[definition.id];
    if (handler) {
      await gateway.registerAgent(definition, handler);
      console.log(`[Agents] Registered: ${definition.name}`);
    }
  }
}
