/**
 * ISkill - 技能标准接口
 * 技能是 Agent 的原子能力单元
 */

export interface ISkillCapabilities {
  /** 技能标签 */
  tags: string[];
  /** 支持的输入类型 */
  inputTypes: string[];
  /** 输出类型 */
  outputType: string;
  /** 是否需要 AI */
  requiresAI: boolean;
}

export interface ISkillContext {
  /** 用户 ID */
  userId: string;
  /** 学习上下文 */
  learningContext?: {
    subject?: string;
    difficulty?: string;
    stage?: number;
  };
  /** 技能特定配置 */
  config?: Record<string, any>;
  /** 扩展字段 */
  [key: string]: any;
}

export interface ISkillInput<T = any> {
  /** 输入数据 */
  data: T;
  /** 上下文 */
  context: ISkillContext;
  /** 选项 */
  options?: Record<string, any>;
}

export interface ISkillOutput<T = any> {
  /** 是否成功 */
  success: boolean;
  /** 输出数据 */
  data: T;
  /** 错误信息 */
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  /** 元数据 */
  metadata?: {
    duration: number;
    tokensUsed?: number;
    cacheHit?: boolean;
  };
}

export interface ISkill {
  /** 技能唯一标识 */
  readonly id: string;
  /** 技能名称 */
  readonly name: string;
  /** 版本 */
  readonly version: string;
  /** 描述 */
  readonly description: string;
  /** 所属分类 */
  readonly category: string;
  /** 能力定义 */
  readonly capabilities: ISkillCapabilities;
  /** 配置 */
  readonly config?: {
    timeout?: number;
    retryCount?: number;
    cacheEnabled?: boolean;
  };

  /**
   * 执行技能
   * @param input 输入
   * @returns 结果
   */
  execute(input: ISkillInput): Promise<ISkillOutput>;

  /**
   * 验证输入
   * @param input 输入
   * @returns 是否有效
   */
  validate?(input: ISkillInput): boolean;

  /**
   * 预热（可选，用于加载模型等）
   */
  warmup?(): Promise<void>;
}

/**
 * 技能构造函数类型
 */
export type SkillConstructor = new (...args: any[]) => ISkill;

/**
 * 技能注册信息
 */
export interface ISkillRegistration {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  capabilities: ISkillCapabilities;
  constructor: SkillConstructor;
  filePath: string;
}

/**
 * 技能编排（组合多个技能）
 */
export interface ISkillPipeline {
  /** Pipeline ID */
  readonly id: string;
  /** 名称 */
  readonly name: string;
  /** 技能链 */
  readonly skills: string[];
  /** 执行 */
  execute(input: ISkillInput, skillManager: ISkillManager): Promise<ISkillOutput>;
}

/**
 * 技能管理器接口
 */
export interface ISkillManager {
  /** 注册技能 */
  register(skill: ISkill): void;
  /** 获取技能 */
  get(id: string): ISkill | undefined;
  /** 列出所有技能 */
  list(): ISkill[];
  /** 按标签查找 */
  findByTag(tag: string): ISkill[];
  /** 按分类查找 */
  findByCategory(category: string): ISkill[];
  /** 执行技能 */
  execute(skillId: string, input: ISkillInput): Promise<ISkillOutput>;
}
