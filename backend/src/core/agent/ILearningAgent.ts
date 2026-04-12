/**
 * ILearningAgent - 学习平台 Agent 标准接口
 * 所有 Agent 必须实现此接口
 */

export interface IAgentCapabilities {
  /** Agent 能力标签 */
  tags: string[];
  /** 支持的学科 */
  subjects: string[];
  /** 输入参数 Schema */
  inputSchema: object;
  /** 输出结果 Schema */
  outputSchema: object;
}

export interface IAgentContext {
  /** 用户 ID */
  userId: string;
  /** 会话 ID */
  sessionId?: string;
  /** 学习路径 ID */
  learningPathId?: string;
  /** 当前任务 ID */
  taskId?: string;
  /** 历史消息 */
  conversationHistory?: Array<{ role: string; content: string }>;
  /** 用户画像 */
  userProfile?: {
    skillLevel?: string;
    learningStyle?: string;
    timePerDay?: string;
  };
  /** 扩展字段 */
  [key: string]: any;
}

export interface IAgentInput {
  /** 用户输入 */
  prompt: string;
  /** 上下文信息 */
  context?: IAgentContext;
  /** 附加参数 */
  params?: Record<string, any>;
}

export interface IAgentOutput {
  /** 是否成功 */
  success: boolean;

  /** 用户可见的自然语言输出（纯对话文本） */
  userVisible: string;

  /** 内部结构化数据（传给下一个 Agent 或存储） */
  internal?: {
    understanding?: any;
    confidence?: number;
    stage?: string;
    metadata?: any;
    [key: string]: any;
  };

  /** 原始响应（可选，用于调试或向后兼容） */
  raw?: any;

  /** 错误信息 */
  error?: {
    code: string;
    message: string;
  };

  /** 元数据 */
  metadata?: {
    duration?: number;
    tokensUsed?: number;
    model?: string;
  };
}

export interface ILearningAgent {
  /** Agent 唯一标识 */
  readonly id: string;
  /** Agent 显示名称 */
  readonly name: string;
  /** 版本号 */
  readonly version: string;
  /** 描述 */
  readonly description: string;
  /** 所属学科（综合/编程/英语/数学等） */
  readonly subject: string;
  /** Agent 能力定义 */
  readonly capabilities: IAgentCapabilities;
  /** Agent 配置 */
  readonly config?: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    timeout?: number;
  };

  /**
   * 执行 Agent
   * @param input 输入参数
   * @returns 执行结果
   */
  run(input: IAgentInput): Promise<IAgentOutput>;

  /**
   * 验证输入
   * @param input 输入参数
   * @returns 是否有效
   */
  validate?(input: IAgentInput): boolean;

  /**
   * 初始化（可选）
   */
  initialize?(): Promise<void>;

  /**
   * 销毁（可选）
   */
  destroy?(): Promise<void>;
}

/**
 * Agent 构造函数类型
 */
export type AgentConstructor = new (...args: any[]) => ILearningAgent;

/**
 * Agent 注册信息
 */
export interface IAgentRegistration {
  id: string;
  name: string;
  version: string;
  description: string;
  subject: string;
  capabilities: IAgentCapabilities;
  constructor: AgentConstructor;
  filePath: string;
}
