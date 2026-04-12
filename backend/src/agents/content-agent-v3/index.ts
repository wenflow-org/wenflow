/**
 * Content Agent v3.0 - 三层架构对话内容生成
 * 
 * 基于战略 - 战术 - 执行三层架构，生成个性化的对话式学习内容
 * 
 * 核心特性：
 * 1. 战略层：对话阶段管理和目标规划
 * 2. 战术层：策略选择和 UI 类型决策
 * 3. 执行层：内容生成和质量自检
 * 4. 集成学习状态追踪系统（LSS/KTL/LF/LSB）
 * 5. Prompt 实验室集成
 */

import { BaseAgent } from '../../core/agent/BaseAgent';
import { IAgentInput, IAgentOutput, IAgentCapabilities } from '../../core/agent/ILearningAgent';
import { getOpenAIClient } from '../../gateway/openai-client';
import { agentConfigService, PromptConfig } from '../../services/agentConfig.service';
import { logger } from '../../utils/logger';
import prisma from '../../config/database';

// 导入学习状态追踪系统服务
import { learningStateService, LearningStateMetrics } from '../../services/learning/learning-state.service';
import { studentBaselineService, StudentBaselineData, ZScoreResult } from '../../services/student-baseline.service';
import { learningSessionService } from '../../services/learning/learning-session.service';
import { createEventBus, EventBus } from '../../gateway/event-bus';

// 导入缓存服务
import { responseCache } from '../../services/cache/response-cache.service';
import { queryCache } from '../../services/cache/query-cache.service';
import { promptCache } from '../../services/cache/prompt-cache.service';

// 导入策略管理器
import { StrategyManager, strategyManager, ContentStrategy, StudentState, StrategySelectionResult, ContentGuideline, UIType } from './strategies';

// ==================== 类型定义 ====================

/**
 * 对话消息
 */
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

/**
 * 战略层接口
 */
interface StrategyLayer {
  conversationStage: 'DIAGNOSIS' | 'DEEPENING' | 'CONSOLIDATE';
  conversationGoal: string;      // 从 PathAgent 获取的认知目标
  estimatedRounds: number;       // 3-8 轮
  currentRound: number;
  
  // 方法
  updateStage(assessmentResult: AssessmentResult): void;
  getRoundObjective(): string;
}

/**
 * 战术层接口
 */
interface TacticsLayer {
  // 策略选择
  strategy: 'SUPPORTIVE' | 'BASIC' | 'STANDARD' | 'CHALLENGE' | 'REMEDIAL';
  strategyReason: string;
  
  // UI 类型选择
  uiType: 'choice' | 'input' | 'code' | 'reflection';
  
  // 难度级别
  difficulty: number;  // 1-5
  
  // 方法
  selectStrategy(studentState: StudentState): Strategy;
  selectUIType(taskType: string, strategy: Strategy): UIType;
}

/**
 * 策略类型
 */
interface Strategy {
  type: 'SUPPORTIVE' | 'BASIC' | 'STANDARD' | 'CHALLENGE' | 'REMEDIAL';
  difficulty: number;
  instruction: string;
  focusAreas: string[];
}

/**
 * UI 类型
 * 使用导入的 UIType 类型
 */

/**
 * 执行层接口
 */
interface ExecutionLayer {
  // 生成对话内容
  generateQuestion(objective: string, strategy: Strategy): Promise<string>;
  generateOptions(uiType: UIType): Promise<string[]>;
  generateHint(strategy: Strategy): string;
  
  // 质量自检
  qualityCheck(content: Content): QualityResult;
}

/**
 * 内容结构
 */
interface Content {
  uiType: string;
  question: string;
  options?: string[];
  inputHint?: string;
  hint?: string;
}

/**
 * 质量检查结果
 */
interface QualityResult {
  passed: boolean;
  score: number;
  issues: string[];
  retryCount: number;
}

/**
 * 评估结果
 */
interface AssessmentResult {
  score: number;
  understandingLevel: string;
  misconceptions: string[];
}

/**
 * 评估参数
 */
interface EvaluationParams {
  expectedUnderstanding: string;
  assessmentCriteria: {
    excellent: string;
    good: string;
    fair: string;
    poor: string;
  };
  keyConcepts: string[];
  commonMisconceptions: string[];
  remedialThreshold: number;
  advancementThreshold: number;
}

/**
 * 状态变更建议
 */
interface StateChangeSuggestions {
  taskProgress: number;
  cognitiveStateChanges: Record<string, number>;
  learningMetrics?: {
    lssChange?: number;
    ktlChange?: number;
    lfChange?: number;
  };
  nextStepSuggestion: 'continue' | 'remedial' | 'complete';
}

/**
 * 完整学生状态（集成学习状态追踪系统）
 */
interface FullStudentState extends Partial<StudentState> {
  // 学习状态指标
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
  depthScore: number;
  engagement: number;
  
  // EMA 基线数据
  responseTimeBaseline: number;
  messageLengthBaseline: number;
  aiScoreBaseline: number;
  
  // 派生指标
  isBaselineStable: boolean;
  hasAnomaly: boolean;
}

/**
 * 基础学生状态（输入）
 */
interface BasicStudentState extends Partial<StudentState> {
  userId: string;
}

/**
 * ContentAgent 输入接口
 */
interface ContentAgentV3Input extends IAgentInput {
  // 任务信息
  taskId?: string;
  taskTitle?: string;
  taskDescription?: string;
  subject?: string;
  cognitiveObjective?: string;
  
  // 学生状态
  studentState?: StudentState;
  
  // 对话上下文
  conversationHistory?: Message[];
  currentRound?: number;
  previousRoundResult?: {
    score: number;
    understandingLevel: string;
    misconceptions: string[];
  };
  
  // 配置
  promptVersion?: string;
}

/**
 * ContentAgent 输出接口
 */
interface ContentAgentV3Output extends IAgentOutput {
  // 对话内容
  content: {
    uiType: string;
    question: string;
    options?: string[];
    inputHint?: string;
    hint?: string;
  };
  
  // 评估参数
  evaluationParams: EvaluationParams;
  
  // 状态变更建议
  stateChangeSuggestions: StateChangeSuggestions;
  
  // 内部元数据（扩展 IAgentOutput.metadata）
  internal: {
    strategy: string;
    strategyReason: string;
    conversationStage: string;
    difficulty: number;
    estimatedMinutes: number;
    qualityScore: number;
    [key: string]: any;
  };
}

// ==================== Agent 定义 ====================

export class ContentAgentV3 extends BaseAgent {
  readonly id = 'content-agent-v3';
  readonly name = 'Content Agent v3.0';
  readonly version = '3.0.0';
  readonly description = '基于三层架构的对话式学习内容生成 Agent';
  readonly subject = '综合';
  readonly systemPrompt: string;
  
  // 三层架构组件
  private strategyLayer: StrategyLayer;
  private tacticsLayer: TacticsLayer;
  private executionLayer: ExecutionLayer;
  
  // 学习状态追踪系统服务
  private learningStateService: typeof learningStateService;
  private studentBaselineService: typeof studentBaselineService;
  private learningSessionService: typeof learningSessionService;
  private eventBus: EventBus;
  
  constructor() {
    super({
      temperature: 0.7,
      maxTokens: 2000,
      timeout: 30000,
      retries: 3,
    });

    this.systemPrompt = `你是 Content Agent v3.0，一个专业的对话式学习内容生成专家。

【核心职责】
1. 根据学生学习状态生成个性化的对话内容
2. 通过战略 - 战术 - 执行三层架构确保内容质量
3. 动态调整策略以适配学生的认知水平
4. 生成评估参数和状态变更建议

【输出要求】
1. 内容要紧密围绕认知目标
2. 根据学生状态调整难度和风格
3. 使用清晰、鼓励性的语言
4. 提供适当的提示和引导`;

    // 初始化三层架构
    this.strategyLayer = this.initStrategyLayer();
    this.tacticsLayer = this.initTacticsLayer();
    this.executionLayer = this.initExecutionLayer();
    
    // 初始化学习状态追踪系统服务
    this.learningStateService = learningStateService;
    this.studentBaselineService = studentBaselineService;
    this.learningSessionService = learningSessionService;
    this.eventBus = createEventBus(prisma);
  }

  readonly capabilities: IAgentCapabilities = {
    tags: ['dialogue-generation', 'adaptive-learning', 'state-tracking'],
    subjects: ['编程', '英语', '数学', '经济学', '心理学', '设计'],
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        taskTitle: { type: 'string', description: '任务标题' },
        taskDescription: { type: 'string', description: '任务描述' },
        cognitiveObjective: { type: 'string', description: '认知目标' },
        studentState: {
          type: 'object',
          properties: {
            problemClarity: { type: 'number' },
            confidence: { type: 'number' },
            frustration: { type: 'number' },
            cognitiveDepth: { type: 'number' },
            learningStyle: { type: 'string' },
            currentLSS: { type: 'number' },
            currentKTL: { type: 'number' },
            currentLF: { type: 'number' },
            currentLSB: { type: 'number' },
            userId: { type: 'string', description: '用户 ID' }
          }
        },
        conversationHistory: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              content: { type: 'string' }
            }
          }
        },
        currentRound: { type: 'number' },
        sessionId: { type: 'string', description: '学习会话 ID' }
      },
      required: ['taskTitle', 'cognitiveObjective']
    },
    outputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'object',
          properties: {
            uiType: { type: 'string' },
            question: { type: 'string' },
            options: { type: 'array' },
            inputHint: { type: 'string' },
            hint: { type: 'string' }
          }
        },
        evaluationParams: { type: 'object' },
        stateChangeSuggestions: { type: 'object' },
        metadata: { type: 'object' }
      }
    }
  };

  // ==================== 三层架构初始化 ====================

  /**
   * 初始化战略层
   */
  private initStrategyLayer(): StrategyLayer {
    return {
      conversationStage: 'DIAGNOSIS',
      conversationGoal: '',
      estimatedRounds: 5,
      currentRound: 1,
      
      updateStage: (assessmentResult: AssessmentResult) => {
        const score = assessmentResult.score;
        
        if (score >= 0.8) {
          this.strategyLayer.conversationStage = 'CONSOLIDATE';
        } else if (score >= 0.5) {
          this.strategyLayer.conversationStage = 'DEEPENING';
        } else {
          this.strategyLayer.conversationStage = 'DIAGNOSIS';
        }
      },
      
      getRoundObjective: () => {
        const stage = this.strategyLayer.conversationStage;
        const goal = this.strategyLayer.conversationGoal;
        
        switch (stage) {
          case 'DIAGNOSIS':
            return `诊断学生对"${goal}"的理解程度，找出知识盲点`;
          case 'DEEPENING':
            return `深化学生对"${goal}"的理解，引导深入思考`;
          case 'CONSOLIDATE':
            return `巩固学生对"${goal}"的掌握，确保能够应用`;
          default:
            return `探索"${goal}"的核心概念`;
        }
      }
    };
  }

  /**
   * 初始化战术层
   */
  private initTacticsLayer(): TacticsLayer {
    return {
      strategy: 'STANDARD',
      strategyReason: '',
      uiType: 'input',
      difficulty: 3,
      
      selectStrategy: (studentState: StudentState): Strategy => {
        // === 新增：学习状态感知的策略选择 ===
        const fullState = studentState as any;
        
        // 高疲劳 → 支持鼓励（降低认知负荷）
        if (fullState.lf > 7 || fullState.currentLF > 7) {
          logger.info('[TacticsLayer] 高疲劳度，选择支持鼓励策略');
          return {
            type: 'SUPPORTIVE',
            difficulty: 1,
            instruction: '温和鼓励，降低难度',
            focusAreas: ['建立信心', '降低压力', '简单引导']
          };
        }
        
        // 低知识掌握 → 基础引导
        if (fullState.ktl < 3 || fullState.currentKTL < 3) {
          logger.info('[TacticsLayer] 低知识掌握，选择基础引导策略');
          return {
            type: 'BASIC',
            difficulty: 2,
            instruction: '简单易懂，避免术语',
            focusAreas: ['基础概念', '生活类比', '逐步引导']
          };
        }
        
        // 高压力 → 支持鼓励
        if (fullState.lss > 7 || fullState.currentLSS > 7) {
          logger.info('[TacticsLayer] 高压力，选择支持鼓励策略');
          return {
            type: 'SUPPORTIVE',
            difficulty: 1,
            instruction: '温和鼓励，降低难度',
            focusAreas: ['建立信心', '降低压力', '简单引导']
          };
        }
        
        // 高知识掌握 + 高参与度 → 挑战深化
        const ktl = fullState.ktl ?? (fullState as any).currentKTL ?? 5;
        const engagement = this.calculateEngagement(fullState);
        
        if (ktl > 7 && engagement > 0.8) {
          logger.info('[TacticsLayer] 高掌握度 + 高参与度，选择挑战策略');
          return {
            type: 'CHALLENGE',
            difficulty: 5,
            instruction: '提出有深度的问题，激发思考',
            focusAreas: ['深度思考', '知识应用', '举一反三']
          };
        }
        
        // 使用策略管理器进行选择（默认逻辑）
        const result = strategyManager.selectStrategy(fullState as any);
        
        // 转换为内部 Strategy 类型
        return {
          type: result.strategy.type,
          difficulty: result.strategy.contentGuidelines.difficultyLevel,
          instruction: result.strategy.contentGuidelines.tone,
          focusAreas: [
            result.strategy.contentGuidelines.explanationDepth,
            result.strategy.contentGuidelines.exampleType,
            result.strategy.contentGuidelines.feedbackStyle
          ]
        };
      },
      
      selectUIType: (taskType: string, strategy: Strategy): UIType => {
        // 使用策略管理器获取 UI 推荐
        const strategyType = strategy.type as ContentStrategy;
        return strategyManager.getUITypeRecommendation(strategyType, taskType);
      }
    };
  }

  /**
   * 初始化执行层
   */
  private initExecutionLayer(): ExecutionLayer {
    return {
      generateQuestion: async (objective: string, strategy: Strategy): Promise<string> => {
        const stage = this.strategyLayer.conversationStage;
        
        const prompts: Record<string, string> = {
          DIAGNOSIS: `请提出一个诊断性问题，了解学生对"${objective}"的理解程度。问题应该：
1. 开放性强，让学生能够表达想法
2. 能够暴露潜在的误解
3. 难度适中，不会让学生感到压力`,
          
          DEEPENING: `请提出一个深化性问题，引导学生深入思考"${objective}"。问题应该：
1. 激发"为什么"和"如何"的思考
2. 连接前后知识点
3. 鼓励举一反三`,
          
          CONSOLIDATE: `请提出一个巩固性问题，检验学生对"${objective}"的掌握程度。问题应该：
1. 要求应用所学知识
2. 包含实际场景
3. 有一定挑战性但可完成`
        };
        
        const stagePrompt = prompts[stage] || prompts.DIAGNOSIS;
        
        const styleGuide: Record<string, string> = {
          SUPPORTIVE: '语气要温和鼓励，使用"我们一起"、"慢慢来"等表达',
          BASIC: '用简单易懂的语言，避免专业术语，多用类比',
          STANDARD: '清晰专业，循序渐进',
          CHALLENGE: '提出有深度的问题，激发思考',
          REMEDIAL: '耐心细致，回顾基础，重新讲解'
        };
        
        const styleInstruction = styleGuide[strategy.type] || styleGuide.STANDARD;
        
        const userPrompt = `${stagePrompt}

【教学策略】
- 策略类型：${strategy.type}
- 难度级别：${strategy.difficulty}/5
- 重点领域：${strategy.focusAreas.join('、')}

【风格要求】
${styleInstruction}

请生成一个问题（100-200 字）：`;

        try {
          const config = await this.getPromptConfig();
          const client = getOpenAIClient();
          const response = await client.chatCompletion({
            model: config.model || process.env.AI_MODEL || 'deepseek-chat',
            messages: [
              { role: 'system', content: this.systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: config.temperature || 0.7,
            max_tokens: config.maxTokens || 500
          });
          
          return response.choices[0]?.message?.content || `让我们一起思考：${objective}的核心是什么？`;
        } catch (error) {
          logger.error('[ContentAgentV3] 生成问题失败:', error);
          return `请描述你对"${objective}"的理解`;
        }
      },
      
      generateOptions: async (uiType: 'choice'): Promise<string[]> => {
        // 生成选择题选项
        const optionsPrompt = `请为一道选择题生成 4 个选项（1 个正确答案 + 3 个干扰项）。

要求：
1. 正确答案要明确
2. 干扰项要基于常见误解
3. 选项长度相近
4. 避免明显错误的选项

请以 JSON 数组格式返回，例如：["选项 A", "选项 B", "选项 C", "选项 D"]`;

        try {
          const config = await this.getPromptConfig();
          const client = getOpenAIClient();
          const response = await client.chatCompletion({
            model: config.model || process.env.AI_MODEL || 'deepseek-chat',
            messages: [
              { role: 'system', content: '你是一个专业的题目设计师' },
              { role: 'user', content: optionsPrompt }
            ],
            temperature: 0.6,
            max_tokens: 300
          });
          
          const content = response.choices[0]?.message?.content || '';
          
          // 尝试解析 JSON
          try {
            const match = content.match(/\[[\s\S]*\]/);
            if (match) {
              return JSON.parse(match[0]) as string[];
            }
          } catch (e) {
            logger.warn('[ContentAgentV3] 解析选项失败，使用默认选项');
          }
          
          // 降级处理
          return ['选项 A', '选项 B', '选项 C', '选项 D'];
        } catch (error) {
          logger.error('[ContentAgentV3] 生成选项失败:', error);
          return ['是', '否', '不确定', '需要提示'];
        }
      },
      
      generateHint: (strategy: Strategy): string => {
        const hints: Record<string, string> = {
          SUPPORTIVE: '如果需要帮助，请随时告诉我，我们一起解决！',
          BASIC: '提示：回想一下我们之前讨论的基础概念',
          STANDARD: '提示：从问题的关键词入手思考',
          CHALLENGE: '提示：尝试从不同角度分析这个问题',
          REMEDIAL: '提示：我们先回顾一下相关的知识点'
        };
        
        return hints[strategy.type] || hints.STANDARD;
      },
      
      qualityCheck: (content: Content): QualityResult => {
        const issues: string[] = [];
        let score = 100;
        
        // 检查问题长度
        if (content.question.length < 20) {
          issues.push('问题过短，可能不够清晰');
          score -= 20;
        }
        
        if (content.question.length > 500) {
          issues.push('问题过长，可能让学生困惑');
          score -= 15;
        }
        
        // 检查选择题选项
        if (content.uiType === 'choice') {
          if (!content.options || content.options.length < 3) {
            issues.push('选择题选项数量不足');
            score -= 25;
          }
        }
        
        // 检查是否包含敏感词
        const sensitiveWords = ['错误', '不对', '太差'];
        for (const word of sensitiveWords) {
          if (content.question.includes(word)) {
            issues.push(`包含负面词汇：${word}`);
            score -= 10;
          }
        }
        
        return {
          passed: score >= 60,
          score: Math.max(0, score),
          issues,
          retryCount: issues.length
        };
      }
    };
  }

  // ==================== 核心方法 ====================

  /**
   * 获取 Prompt 配置（使用缓存）
   */
  private async getPromptConfig(): Promise<PromptConfig | null> {
    try {
      // 使用 Prompt 缓存
      const prompt = await promptCache.getCachedPrompt('content-agent-v3');
      
      if (prompt) {
        return {
          systemPrompt: prompt.systemPrompt,
          temperature: prompt.temperature,
          maxTokens: prompt.maxTokens,
          model: prompt.model || process.env.AI_MODEL || 'deepseek-chat',
          version: 1  // 默认版本号
        };
      }
      
      // 缓存未命中，从数据库加载
      const dbPrompt = await agentConfigService.getActivePrompt('content-agent-v3');
      return dbPrompt;
    } catch (error) {
      logger.warn('[ContentAgentV3] 获取 Prompt 配置失败，使用默认配置');
      return null;
    }
  }

  /**
   * 解析输入
   */
  private parseInput(input: ContentAgentV3Input): ContentAgentV3Input {
    // 设置默认值
    const parsed: ContentAgentV3Input = {
      ...input,
      taskTitle: input.taskTitle || input.prompt || '学习任务',
      cognitiveObjective: input.cognitiveObjective || input.prompt || '理解核心概念',
      studentState: {
        problemClarity: 0.5,
        confidence: 0.5,
        frustration: 0.3,
        cognitiveDepth: 0.5,
        learningStyle: 'mixed',
        currentLSS: 0.5,
        currentKTL: 0.5,
        currentLF: 0.3,
        currentLSB: 0.2,
        ...(input.studentState || {}),
        userId: (input.studentState as any)?.userId || 'unknown'
      } as any,
      conversationHistory: input.conversationHistory || [],
      currentRound: input.currentRound || 1
    };
    
    // 更新战略层状态
    this.strategyLayer.currentRound = parsed.currentRound;
    this.strategyLayer.conversationGoal = parsed.cognitiveObjective;
    
    return parsed;
  }

  /**
   * 丰富学生状态（集成学习状态追踪系统）
   */
  private async enrichStudentState(basicState: BasicStudentState): Promise<FullStudentState> {
    const userId = basicState.userId;
    
    try {
      // 1. 获取学习状态指标
      const learningState = await this.learningStateService.getCurrentState(userId);
      
      // 2. 获取 EMA 基线
      const baseline = await this.studentBaselineService.getOrCreateBaseline(userId);
      
      // 3. 合并状态
      const fullState: FullStudentState = {
        ...basicState,
        // 学习状态指标
        lss: learningState?.lss ?? (basicState as any).currentLSS ?? 5,
        ktl: learningState?.ktl ?? (basicState as any).currentKTL ?? 5,
        lf: learningState?.lf ?? (basicState as any).currentLF ?? 3,
        lsb: learningState?.lsb ?? (basicState as any).currentLSB ?? 2,
        depthScore: (basicState as any).cognitiveDepth ?? 0.5,
        engagement: this.calculateEngagement(basicState),
        
        // EMA 基线数据
        responseTimeBaseline: baseline.responseTime.ema,
        messageLengthBaseline: baseline.messageLength.ema,
        aiScoreBaseline: baseline.aiScore.ema,
        
        // 计算派生指标
        isBaselineStable: baseline.responseTime.updateCount > 5,
        hasAnomaly: this.detectAnomaly(baseline, learningState)
      };
      
      logger.debug('[ContentAgentV3] 学生状态丰富完成', {
        userId,
        lss: fullState.lss.toFixed(2),
        ktl: fullState.ktl.toFixed(2),
        lf: fullState.lf.toFixed(2),
        lsb: fullState.lsb.toFixed(2),
        hasAnomaly: fullState.hasAnomaly
      });
      
      return fullState;
    } catch (error: any) {
      logger.error('[ContentAgentV3] 丰富学生状态失败:', error.message);
      
      // 降级处理：返回基础状态
      return {
        ...basicState,
        lss: (basicState as any).currentLSS ?? 5,
        ktl: (basicState as any).currentKTL ?? 5,
        lf: (basicState as any).currentLF ?? 3,
        lsb: (basicState as any).currentLSB ?? 2,
        depthScore: (basicState as any).cognitiveDepth ?? 0.5,
        engagement: 0.5,
        responseTimeBaseline: 10,
        messageLengthBaseline: 50,
        aiScoreBaseline: 0.5,
        isBaselineStable: false,
        hasAnomaly: false
      } as FullStudentState;
    }
  }

  /**
   * 计算参与度
   */
  private calculateEngagement(state: BasicStudentState): number {
    // 基于多个指标计算参与度
    const confidenceWeight = 0.3;
    const clarityWeight = 0.3;
    const frustrationWeight = 0.2;
    const depthWeight = 0.2;
    
    const engagement = 
      ((state as any).confidence ?? 0.5) * confidenceWeight +
      ((state as any).problemClarity ?? 0.5) * clarityWeight +
      (1 - ((state as any).frustration ?? 0.3)) * frustrationWeight +
      ((state as any).cognitiveDepth ?? 0.5) * depthWeight;
    
    return Math.min(1, Math.max(0, engagement));
  }

  /**
   * 检测异常
   */
  private detectAnomaly(baseline: StudentBaselineData, learningState: LearningStateMetrics | null): boolean {
    // 使用 Z-Score 检测异常
    const zScoreThreshold = 2.5;
    
    const hasResponseTimeAnomaly = Math.abs(baseline.responseTime.ema - 10) > 5;
    const hasEngagementAnomaly = 
      (learningState?.lss ?? 5) > 7 || 
      (learningState?.lf ?? 3) > 7;
    const hasStressAnomaly = (learningState?.lss ?? 5) > 8;
    
    return hasResponseTimeAnomaly || hasEngagementAnomaly || hasStressAnomaly;
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(input: ContentAgentV3Input): string {
    const params = {
      taskId: input.taskId,
      studentState: {
        problemClarity: input.studentState?.problemClarity,
        confidence: input.studentState?.confidence,
        frustration: input.studentState?.frustration,
        cognitiveDepth: (input.studentState as any)?.cognitiveDepth
      },
      conversationStage: this.strategyLayer.conversationStage,
      currentRound: input.currentRound || 1,
      cognitiveObjective: input.cognitiveObjective
    };
    
    return responseCache.generateKey('content-agent-v3', params);
  }

  /**
   * 更新学习状态
   */
  private async updateLearningState(
    input: ContentAgentV3Input,
    output: ContentAgentV3Output
  ): Promise<void> {
    const userId = (input.studentState as any)?.userId;
    const sessionId = (input as any).sessionId;
    
    if (!userId) {
      logger.warn('[ContentAgentV3] 缺少 userId，跳过状态更新');
      return;
    }
    
    try {
      // 1. 评估内容质量
      const contentQuality = this.assessContentQuality(output);
      
      // 2. 更新 EMA 基线
      await this.studentBaselineService.updateBaseline(userId, {
        aiScore: contentQuality
      });
      
      // 3. 记录到学习会话（如果有 sessionId）
      if (sessionId) {
        await this.learningSessionService.addMessageAndAssessState(
          sessionId,
          {
            role: 'assistant',
            content: output.content.question,
            timestamp: new Date().toISOString()
          },
          userId
        );
      }
      
      // 4. 发布状态更新事件
      await this.eventBus.emit({
        type: 'content:generated',
        source: 'content-agent-v3',
        userId,
        sessionId,
        data: {
          strategy: output.internal.strategy,
          contentQuality,
          stateChanges: output.stateChangeSuggestions
        }
      });
      
      logger.info('[ContentAgentV3] 学习状态更新完成', {
        userId,
        sessionId,
        contentQuality: contentQuality.toFixed(2)
      });
    } catch (error: any) {
      logger.error('[ContentAgentV3] 更新学习状态失败:', error.message);
      // 不阻断主流程
    }
  }

  /**
   * 评估内容质量
   */
  private assessContentQuality(output: ContentAgentV3Output): number {
    // 基于多个维度评估内容质量（0-1）
    let quality = 0.5;
    
    // 策略适配度（30%）
    const strategyQuality = this.assessStrategyAlignment(output);
    quality += strategyQuality * 0.3;
    
    // 内容质量检查（40%）
    const contentQuality = output.internal.qualityScore / 100;
    quality += contentQuality * 0.4;
    
    // 状态变更合理性（30%）
    const stateChangeQuality = this.assessStateChangeQuality(output);
    quality += stateChangeQuality * 0.3;
    
    return Math.min(1, Math.max(0, quality));
  }

  /**
   * 评估策略适配度
   */
  private assessStrategyAlignment(output: ContentAgentV3Output): number {
    const strategy = output.internal.strategy;
    const difficulty = output.internal.difficulty;
    
    // 策略和难度匹配度检查
    if (strategy === 'SUPPORTIVE' && difficulty <= 2) {
      return 1.0;  // 支持策略 + 低难度 = 完美匹配
    }
    if (strategy === 'CHALLENGE' && difficulty >= 4) {
      return 1.0;  // 挑战策略 + 高难度 = 完美匹配
    }
    if (strategy === 'STANDARD' && difficulty >= 2 && difficulty <= 4) {
      return 1.0;  // 标准策略 + 中等难度 = 完美匹配
    }
    
    return 0.7;  // 默认中等匹配度
  }

  /**
   * 评估状态变更建议质量
   */
  private assessStateChangeQuality(output: ContentAgentV3Output): number {
    const suggestions = output.stateChangeSuggestions;
    
    // 检查建议是否合理
    if (suggestions.nextStepSuggestion === 'remedial' && 
        Object.values(suggestions.cognitiveStateChanges).every(v => v >= 0)) {
      return 0.5;  // 需要补救但状态变化都是正面的，不合理
    }
    
    if (suggestions.nextStepSuggestion === 'complete' && 
        suggestions.taskProgress < 0.8) {
      return 0.5;  // 建议完成但进度不足，不合理
    }
    
    return 1.0;  // 合理
  }

  /**
   * 生成评估参数
   */
  private generateEvaluationParams(
    objective: string,
    strategy: Strategy
  ): EvaluationParams {
    const difficultyLabels: Record<number, string> = {
      1: '基础',
      2: '入门',
      3: '标准',
      4: '进阶',
      5: '挑战'
    };
    
    return {
      expectedUnderstanding: `学生能够${objective}`,
      assessmentCriteria: {
        excellent: '完全理解并能独立应用，能解释原理',
        good: '基本理解，在提示下能够应用',
        fair: '部分理解，需要较多指导',
        poor: '理解困难，需要重新讲解'
      },
      keyConcepts: [objective],
      commonMisconceptions: [
        '概念混淆',
        '应用场景理解不清',
        '步骤顺序错误'
      ],
      remedialThreshold: 0.4,
      advancementThreshold: 0.8
    };
  }

  /**
   * 生成状态变更建议
   */
  private generateStateChangeSuggestions(
    input: ContentAgentV3Input,
    strategy: Strategy,
    fullStudentState?: FullStudentState
  ): StateChangeSuggestions {
    const studentState = input.studentState!;
    
    // 根据策略类型建议下一步
    let nextStep: 'continue' | 'remedial' | 'complete' = 'continue';
    
    if (strategy.type === 'REMEDIAL' || strategy.type === 'BASIC') {
      nextStep = 'remedial';
    } else if (strategy.type === 'CHALLENGE' && studentState.confidence > 0.9) {
      nextStep = 'complete';
    }
    
    // 计算认知状态变化建议
    const cognitiveStateChanges: Record<string, number> = {};
    
    if (strategy.type === 'SUPPORTIVE') {
      cognitiveStateChanges.frustration = -0.2;  // 降低挫败感
      cognitiveStateChanges.confidence = 0.1;    // 提升信心
    } else if (strategy.type === 'CHALLENGE') {
      cognitiveStateChanges.cognitiveDepth = 0.15;  // 提升认知深度
    } else {
      cognitiveStateChanges.problemClarity = 0.1;   // 提升问题清晰度
    }
    
    // 计算任务进度
    const progressIncrement = strategy.type === 'CHALLENGE' ? 0.2 : 0.1;
    const taskProgress = Math.min(1, progressIncrement);
    
    // === 新增：学习状态指标变化建议 ===
    const learningMetrics: StateChangeSuggestions['learningMetrics'] = {};
    
    // 基于完整学生状态生成学习指标变化建议
    if (fullStudentState) {
      // 高疲劳 → 建议降低 LSS
      if (fullStudentState.lf > 7) {
        learningMetrics.lssChange = -5;
        learningMetrics.lfChange = -2;
      }
      
      // 低知识掌握 → 建议提升 KTL
      if (fullStudentState.ktl < 3) {
        learningMetrics.ktlChange = 0.05;
      }
      
      // 高压力 → 建议降低 LSS
      if (fullStudentState.lss > 7) {
        learningMetrics.lssChange = (learningMetrics.lssChange ?? 0) - 3;
      }
      
      // 高质量内容 → KTL 提升
      if (strategy.type === 'CHALLENGE' && studentState.confidence > 0.8) {
        learningMetrics.ktlChange = (learningMetrics.ktlChange ?? 0) + 0.03;
      }
    }
    
    return {
      taskProgress,
      cognitiveStateChanges,
      learningMetrics,
      nextStepSuggestion: nextStep
    };
  }

  /**
   * 重试生成
   */
  private async retryGenerate(
    input: ContentAgentV3Input,
    retryCount: number
  ): Promise<IAgentOutput> {
    logger.warn(`[ContentAgentV3] 质量检查未通过，重试次数：${retryCount}`);
    
    // 最多重试 2 次
    if (retryCount >= 2) {
      return this.createFallbackOutput(input);
    }
    
    // 重新执行
    return await this.execute(input);
  }

  /**
   * 降级输出
   */
  private createFallbackOutput(input: ContentAgentV3Input): IAgentOutput {
    const taskTitle = input.taskTitle || '学习任务';
    
    return {
      success: true,
      userVisible: `让我们一起思考：${taskTitle}的核心是什么？请分享你的想法。`,
      internal: {
        fallback: true,
        reason: 'quality_check_failed'
      },
      metadata: {
        model: this.config.model,
        duration: 0
      }
    };
  }

  /**
   * 执行核心逻辑
   */
  protected async execute(input: IAgentInput): Promise<IAgentOutput> {
    const startTime = Date.now();
    const typedInput = input as ContentAgentV3Input;
    
    try {
      // 1. 生成缓存键
      const cacheKey = this.generateCacheKey(typedInput);
      
      // 2. 尝试从缓存获取
      const cachedResult = responseCache.get<IAgentOutput>(cacheKey);
      if (cachedResult) {
        logger.info('[ContentAgentV3] 缓存命中', { cacheKey });
        return {
          ...cachedResult,
          metadata: {
            ...cachedResult.metadata,
            duration: Date.now() - startTime
          }
        };
      }
      
      logger.info('[ContentAgentV3] 缓存未命中，执行生成', { cacheKey });
      
      // 3. 解析输入
      const parsedInput = this.parseInput(typedInput);
      
      // 4. === 新增：获取完整的学生状态 ===
      const basicState = parsedInput.studentState as BasicStudentState;
      const fullStudentState = await this.enrichStudentState(basicState);
      
      // 5. 战略层：更新对话阶段和目标
      const stageObjective = this.strategyLayer.getRoundObjective();
      
      // 6. 战术层：选择策略（使用完整状态）
      const strategy = this.tacticsLayer.selectStrategy(fullStudentState as any);
      const uiType = this.tacticsLayer.selectUIType(
        parsedInput.params?.taskType || 'discussion',
        strategy
      );
      
      // 更新战术层状态
      this.tacticsLayer.strategy = strategy.type;
      this.tacticsLayer.uiType = uiType;
      this.tacticsLayer.difficulty = strategy.difficulty;
      this.tacticsLayer.strategyReason = `基于学生状态：挫败感${fullStudentState.frustration.toFixed(2)}, 清晰度${fullStudentState.problemClarity.toFixed(2)}, LSS=${fullStudentState.lss.toFixed(1)}, KTL=${fullStudentState.ktl.toFixed(1)}, LF=${fullStudentState.lf.toFixed(1)}`;
      
      // 7. 执行层：生成内容
      const question = await this.executionLayer.generateQuestion(stageObjective, strategy);
      const options = uiType === 'choice' ? await this.executionLayer.generateOptions(uiType) : undefined;
      const hint = this.executionLayer.generateHint(strategy);
      
      // 8. 质量自检
      const content: Content = {
        uiType,
        question,
        options,
        inputHint: hint
      };
      
      const qualityResult = this.executionLayer.qualityCheck(content);
      
      // 9. 如果质量不达标，重试生成
      if (!qualityResult.passed) {
        return await this.retryGenerate(typedInput, qualityResult.retryCount);
      }
      
      // 10. 生成评估参数
      const evaluationParams = this.generateEvaluationParams(
        parsedInput.cognitiveObjective!,
        strategy
      );
      
      // 11. === 新增：生成状态变更建议（使用完整状态）===
      const stateChanges = this.generateStateChangeSuggestions(
        parsedInput,
        strategy,
        fullStudentState
      );
      
      // 12. 计算耗时
      const duration = Date.now() - startTime;
      
      // 13. 获取 Prompt 配置
      const promptConfig = await this.getPromptConfig();
      
      // 14. 组装输出
      const output: ContentAgentV3Output = {
        success: true,
        content: {
          uiType,
          question,
          options,
          inputHint: hint
        },
        evaluationParams,
        stateChangeSuggestions: stateChanges,
        internal: {
          strategy: strategy.type,
          uiType,
          conversationStage: this.strategyLayer.conversationStage,
          conversationGoal: this.strategyLayer.conversationGoal,
          currentRound: this.strategyLayer.currentRound,
          promptVersion: promptConfig?.version || 'default',
          strategyReason: this.tacticsLayer.strategyReason,
          difficulty: strategy.difficulty,
          estimatedMinutes: 3,
          qualityScore: qualityResult.score,
          studentState: {
            lss: fullStudentState.lss,
            ktl: fullStudentState.ktl,
            lf: fullStudentState.lf,
            lsb: fullStudentState.lsb,
            engagement: fullStudentState.engagement,
            hasAnomaly: fullStudentState.hasAnomaly
          }
        },
        userVisible: question,
        metadata: {
          duration,
          model: promptConfig?.model || this.config.model
        }
      };
      
      // 15. 记录日志
      logger.info('[ContentAgentV3] 生成成功', {
        strategy: strategy.type,
        stage: this.strategyLayer.conversationStage,
        duration,
        qualityScore: qualityResult.score,
        studentState: {
          lss: fullStudentState.lss.toFixed(2),
          ktl: fullStudentState.ktl.toFixed(2),
          lf: fullStudentState.lf.toFixed(2),
          lsb: fullStudentState.lsb.toFixed(2)
        }
      });
      
      // 16. 更新 Prompt 统计
      if (promptConfig) {
        await agentConfigService.updateStats(
          'content-agent-v3',
          promptConfig.version,
          duration,
          true
        );
      }
      
      // 17. === 新增：更新学习状态 ===
      await this.updateLearningState(typedInput, output);
      
      // 18. 存入缓存（TTL: 1 小时）
      responseCache.set(cacheKey, output, 3600000);
      
      return output;
      
    } catch (error: any) {
      logger.error('[ContentAgentV3] 执行失败:', error);
      
      const duration = Date.now() - startTime;
      
      // 更新 Prompt 统计（失败）
      const promptConfig = await this.getPromptConfig();
      if (promptConfig) {
        await agentConfigService.updateStats(
          'content-agent-v3',
          promptConfig.version,
          duration,
          false
        );
      }
      
      // 降级处理
      return {
        success: true,
        userVisible: `让我们一起思考：${typedInput.taskTitle || '这个任务'}的核心是什么？请分享你的想法。`,
        internal: {
          error: error.message,
          fallback: true
        },
        metadata: {
          duration,
          model: this.config.model
        }
      };
    }
  }

  /**
   * 获取 Agent 信息
   */
  getInfo() {
    return {
      ...super.getInfo(),
      strategyLayer: {
        stage: this.strategyLayer.conversationStage,
        goal: this.strategyLayer.conversationGoal,
        currentRound: this.strategyLayer.currentRound
      },
      tacticsLayer: {
        strategy: this.tacticsLayer.strategy,
        uiType: this.tacticsLayer.uiType,
        difficulty: this.tacticsLayer.difficulty
      }
    };
  }
}

export default ContentAgentV3;

// 导出 Agent 定义（用于注册）
export { contentAgentV3Definition } from './register';
export { registerContentAgentV3 } from './register';
