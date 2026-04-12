/**
 * Agent 插件类型定义
 * 
 * 可插拔的 WenFlow Agent 架构核心接口
 */

// Agent 类型枚举
export type AgentType = 
  | 'requirement-extractor' 
  | 'path-planner' 
  | 'content-generator' 
  | 'quality-evaluator' 
  | 'tutor';

// Agent 上下文
export interface AgentContext {
  userId?: string;
  taskId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
  history?: any[];
}

// Agent 输出（新格式：分离 userVisible 和 internal）
export interface AgentOutput {
  success: boolean;
  /** 用户可见的自然语言输出（纯对话文本） */
  userVisible: string;
  /** 内部结构化数据（传给下一个 Agent 或存储） */
  internal?: any;
  /** @deprecated 旧格式数据，保留向后兼容 */
  data?: any;
  error?: string;
  metadata?: {
    agentId: string;
    agentName: string;
    confidence?: number;
    generatedAt?: string;
    tokensUsed?: number;
    duration?: number;
  };
}

// Agent 配置
export interface AgentConfig {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  timeout?: number;
  retries?: number;
  [key: string]: any;
}

// Agent 插件接口
export interface AgentPlugin {
  // 元数据
  id: string;
  name: string;
  version: string;
  description: string;
  type: AgentType;
  capabilities: string[];
  
  // 配置（可选，有默认值）
  config?: AgentConfig;
  
  // 执行方法
  execute(input: any, context: AgentContext): Promise<AgentOutput>;
  
  // 可选：初始化方法
  initialize?(): Promise<void>;
  
  // 可选：销毁方法
  destroy?(): Promise<void>;
  
  // 可选：辅助方法
  buildUserPrompt?(input: any): string;
  buildLearningContext?(input: any): string;
  buildAnalysisPrompt?(input: any, content: string): string;
  buildEvalContext?(input: any): string;
  fetchUrlContent?(url: string): Promise<string>;
  parseHtml?(html: string): string;
  calculateGrade?(score: number): string;
  buildMappingPromptInternal?(sourceData: any, targetSchema: any[]): string;
  parseMappingResponse?(content: string): any;
  
  // 可选：特定插件方法
  handleLowConfidence?(annotation: any, confidence: number, skillName: string, skillContext: Record<string, any>): Promise<any>;
  checkAlignment?(path: any, goal: string, userContext: Record<string, any>): Promise<any>;
  fallbackHandle?(input: any): any;
  fallbackCheck?(input: any): any;
  summarizePath?(path: any): string;
}

// Agent 注册信息
export interface AgentRegistration {
  plugin: AgentPlugin;
  registeredAt: Date;
  callCount: number;
  successCount: number;
  totalDuration: number;
}

// 插件工厂函数类型
export type AgentPluginFactory = () => AgentPlugin;

// 输入输出 Schema（用于文档和验证）
export interface AgentSchema {
  input: {
    type: string;
    properties: Record<string, {
      type: string;
      description?: string;
      required?: boolean;
      default?: any;
    }>;
  };
  output: {
    type: string;
    properties: Record<string, {
      type: string;
      description?: string;
    }>;
  };
}
