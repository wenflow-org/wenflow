/**
 * Core Module - 核心模块统一导出
 */

// Agent 相关
export * from './agent/ILearningAgent';
export * from './agent/BaseAgent';
export * from './agent/AgentLoader';

// Skill 相关
export * from './skill/ISkill';
export * from './skill/SkillManager';

// MCP 相关
export * from './mcp/McpGateway';

// 便捷导出实例
export { agentLoader } from './agent/AgentLoader';
export { skillManager } from './skill/SkillManager';
export { mcpGateway } from './mcp/McpGateway';
