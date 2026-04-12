/**
 * BaseAgent - Agent 基类
 * 提供通用功能和默认实现
 */

import {
  ILearningAgent,
  IAgentInput,
  IAgentOutput,
  IAgentContext,
  IAgentCapabilities,
} from './ILearningAgent';
import aiService from '../../services/ai/ai.service';
import { logger } from '../../utils/logger';

// 默认配置常量
const DEFAULT_AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 2000;

export interface IBaseAgentConfig {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  timeout?: number;
  retries?: number;
}

export abstract class BaseAgent implements ILearningAgent {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly subject: string;
  abstract readonly capabilities: IAgentCapabilities;

  readonly config: Required<IBaseAgentConfig>;
  protected systemPrompt: string = '';

  constructor(config?: IBaseAgentConfig) {
    this.config = {
      temperature: config?.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: config?.maxTokens ?? DEFAULT_MAX_TOKENS,
      model: config?.model ?? DEFAULT_AI_MODEL,
      timeout: config?.timeout ?? 30000,
      retries: config?.retries ?? 3,
    };
  }

  /**
   * 执行 Agent（模板方法模式）
   */
  async run(input: IAgentInput): Promise<IAgentOutput> {
    const startTime = Date.now();

    try {
      // 1. 验证输入
      if (this.validate && !this.validate(input)) {
        return {
          success: false,
          userVisible: '输入参数验证失败，请检查您的输入。',
          error: {
            code: 'VALIDATION_ERROR',
            message: '输入参数验证失败',
          },
          metadata: {
            duration: Date.now() - startTime,
          },
        };
      }

      // 2. 预处理输入
      const processedInput = await this.preprocess(input);

      // 3. 执行核心逻辑（子类实现）
      const result = await this.execute(processedInput);

      // 4. 后处理输出
      const processedOutput = await this.postprocess(result);

      const duration = Date.now() - startTime;

      // execute 方法返回 IAgentOutput，直接使用并补充元数据
      return {
        ...result,
        metadata: {
          duration,
          ...result.metadata,
        },
      };
    } catch (error: any) {
      logger.error(`[${this.id}] Agent 执行失败:`, error);

      return {
        success: false,
        userVisible: '抱歉，处理过程中出现了错误，请稍后重试。',
        error: {
          code: error.code || 'EXECUTION_ERROR',
          message: error.message || '执行失败',
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * 验证输入（可覆盖）
   */
  validate(input: IAgentInput): boolean {
    if (!input.prompt || typeof input.prompt !== 'string') {
      return false;
    }
    return true;
  }

  /**
   * 预处理输入（可覆盖）
   */
  protected async preprocess(input: IAgentInput): Promise<IAgentInput> {
    return input;
  }

  /**
   * 执行核心逻辑（子类必须实现）
   */
  protected abstract execute(input: IAgentInput): Promise<IAgentOutput>;

  /**
   * 后处理输出（可覆盖）
   */
  protected async postprocess(output: IAgentOutput): Promise<IAgentOutput> {
    return output;
  }

  /**
   * 调用 AI 服务（便捷方法）
   */
  protected async callAI(
    messages: Array<{ role: string; content: string }>,
    options?: Partial<IBaseAgentConfig>
  ): Promise<{ content: string; usage?: { totalTokens?: number } }> {
    const response = await aiService.chat(
      messages as any,
      {
        model: options?.model || this.config.model,
        temperature: options?.temperature ?? this.config.temperature,
        maxTokens: options?.maxTokens ?? this.config.maxTokens,
      }
    );

    const content = response.choices[0]?.message?.content || '';
    const usage = response.usage ? { totalTokens: response.usage.total_tokens } : undefined;

    return { content, usage };
  }

  /**
   * 构建系统提示词（可覆盖）
   */
  protected buildSystemPrompt(context?: IAgentContext): string {
    return this.systemPrompt;
  }

  /**
   * 构建用户提示词（可覆盖）
   */
  protected buildUserPrompt(input: IAgentInput): string {
    return input.prompt;
  }

  /**
   * 解析 JSON 响应（带错误处理）
   */
  protected parseJSON<T>(content: string): T {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]) as T;
      }
      throw new Error('未找到 JSON 内容');
    } catch (error: any) {
      throw new Error(`JSON 解析失败: ${error.message}`);
    }
  }

  /**
   * 初始化（可覆盖）
   */
  async initialize(): Promise<void> {
    logger.info(`[${this.id}] Agent 初始化完成`);
  }

  /**
   * 销毁（可覆盖）
   */
  async destroy(): Promise<void> {
    logger.info(`[${this.id}] Agent 已销毁`);
  }

  /**
   * 获取 Agent 信息
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      subject: this.subject,
      capabilities: this.capabilities,
      config: this.config,
    };
  }

  /**
   * 创建标准 Agent 输出（辅助方法）
   * 帮助子类构造符合新接口的输出
   */
  protected createOutput(
    userVisible: string,
    internal?: IAgentOutput['internal'],
    metadata?: Partial<IAgentOutput['metadata']>
  ): IAgentOutput {
    return {
      success: true,
      userVisible,
      internal,
      metadata: {
        model: this.config.model,
        ...metadata,
      },
    };
  }

  /**
   * 创建错误输出（辅助方法）
   */
  protected createErrorOutput(
    userVisible: string,
    code: string,
    message: string,
    metadata?: Partial<IAgentOutput['metadata']>
  ): IAgentOutput {
    return {
      success: false,
      userVisible,
      error: {
        code,
        message,
      },
      metadata: {
        model: this.config.model,
        ...metadata,
      },
    };
  }
}
