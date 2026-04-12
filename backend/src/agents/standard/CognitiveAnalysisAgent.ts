/**
 * CognitiveAnalysisAgent - 认知分析 Agent
 * 基于对话内容分析学生的认知层级、理解度、情绪状态
 * 使用布鲁姆分类法 (Bloom's Taxonomy) 评估认知层级
 */

import { BaseAgent } from '../../core/agent/BaseAgent';
import { IAgentInput, IAgentOutput, IAgentCapabilities, IAgentContext } from '../../core/agent/ILearningAgent';
import { getOpenAIClient } from '../../gateway/openai-client';
import { logger } from '../../utils/logger';

export enum CognitiveLevel {
  REMEMBER = 'remember',      // 记忆 - 识别、回忆
  UNDERSTAND = 'understand',  // 理解 - 解释、分类、总结
  APPLY = 'apply',            // 应用 - 执行、实施
  ANALYZE = 'analyze',        // 分析 - 区分、组织、归因
  EVALUATE = 'evaluate',      // 评估 - 检查、批判
  CREATE = 'create',          // 创造 - 生成、计划、构建
}

export interface CognitiveAnalysisResult {
  cognitiveLevel: CognitiveLevel;
  levelScore: number;              // 层级分数 1-6
  understanding: number;           // 理解度 0-1
  confusionPoints: string[];       // 困惑点列表
  engagement: number;              // 参与度 0-1
  emotionalState: 'positive' | 'neutral' | 'frustrated' | 'confused' | 'excited';
  knowledgeGaps: string[];         // 知识缺口
  learningStyle: string;           // 检测到的学习风格
  topics: string[];                // 涉及的主题
  questions: string[];             // 提出的问题
}

export interface DialogueContext {
  sessionId: string;
  userId: string;
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  currentTopic?: string;
  learningLevel?: string;
  subject?: string;
}

export class CognitiveAnalysisAgent extends BaseAgent {
  readonly id = 'cognitive-analysis-agent';
  readonly name = 'CognitiveAnalysisAgent';
  readonly version = '2.0.0';
  readonly description = '分析学生对话的认知层级和学习状态';
  readonly subject = '综合';

  readonly capabilities: IAgentCapabilities = {
    tags: ['cognitive-analysis', 'learning-assessment', 'dialogue-analysis'],
    subjects: ['编程', '英语', '数学', '经济学', '心理学', '设计', '综合'],
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '学生消息' },
        context: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            userId: { type: 'string' },
            conversationHistory: { type: 'array' },
            currentTopic: { type: 'string' },
            subject: { type: 'string' },
          },
        },
      },
      required: ['prompt'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        cognitiveLevel: { type: 'string', enum: Object.values(CognitiveLevel) },
        levelScore: { type: 'number', minimum: 1, maximum: 6 },
        understanding: { type: 'number', minimum: 0, maximum: 1 },
        confusionPoints: { type: 'array', items: { type: 'string' } },
        engagement: { type: 'number', minimum: 0, maximum: 1 },
        emotionalState: { type: 'string' },
        knowledgeGaps: { type: 'array', items: { type: 'string' } },
      },
    },
  };

  constructor() {
    super({
      temperature: 0.5,
      maxTokens: 2000,
      timeout: 30000,
      model: process.env.AI_MODEL || 'deepseek-chat',
    });

    this.systemPrompt = `你是一位学习认知分析专家。你的任务是分析学生的学习对话，评估其认知层级和理解状态。

【分析维度】
1. 认知层级（基于布鲁姆分类法）
   - remember: 记忆（识别、回忆）
   - understand: 理解（解释、分类、总结）
   - apply: 应用（执行、实施）
   - analyze: 分析（区分、组织、归因）
   - evaluate: 评估（检查、批判）
   - create: 创造（生成、计划、构建）

2. 理解度 (0-1)
3. 困惑点列表
4. 参与度 (0-1)
5. 情绪状态
6. 知识缺口
7. 学习风格偏好

【输出格式】
{
  "cognitiveLevel": "analyze",
  "levelScore": 4,
  "understanding": 0.75,
  "confusionPoints": ["递归概念", "边界条件"],
  "engagement": 0.85,
  "emotionalState": "confused",
  "knowledgeGaps": ["缺少数据结构基础"],
  "learningStyle": "visual",
  "topics": ["递归", "二叉树"],
  "questions": ["什么是递归？"]
}

【分析原则】
- 客观分析，不主观臆断
- 关注认知过程，而非内容正确性
- 识别潜在知识缺口
- 评估学习风格偏好`;
  }

  protected async execute(input: IAgentInput): Promise<IAgentOutput> {
    const { prompt, context } = input;
    const dialogueContext = context as DialogueContext;

    const analysisPrompt = this.buildAnalysisPrompt(prompt, dialogueContext);

    try {
      const client = getOpenAIClient();
      const response = await client.chatCompletion({
        model: process.env.AI_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      });

      const content = response.choices[0]?.message?.content || '';

      if (!content) {
        throw new Error('AI 响应内容为空');
      }

      const analysis: CognitiveAnalysisResult = this.parseJSON(content);
      const validatedAnalysis = this.validateAndNormalize(analysis);

      logger.info(`[cognitive-analysis-agent] 分析成功：${validatedAnalysis.cognitiveLevel}, understanding=${validatedAnalysis.understanding}`);

      return {
        success: true,
        userVisible: '',
        internal: {
          analysis: validatedAnalysis,
          understanding: {
            cognitiveLevel: validatedAnalysis.cognitiveLevel,
            understanding: validatedAnalysis.understanding,
            emotionalState: validatedAnalysis.emotionalState,
          },
          confidence: 0.9,
          stage: 'cognitive_analysis_completed',
        },
      };
    } catch (error: any) {
      logger.error(`[cognitive-analysis-agent] AI 分析失败：${error.message}`);
      logger.info(`[cognitive-analysis-agent] 使用规则引擎回退`);

      const fallbackAnalysis = this.ruleBasedAnalysis(prompt);

      return {
        success: true,
        userVisible: '',
        internal: {
          analysis: fallbackAnalysis,
          understanding: {
            cognitiveLevel: fallbackAnalysis.cognitiveLevel,
            understanding: fallbackAnalysis.understanding,
            emotionalState: fallbackAnalysis.emotionalState,
          },
          confidence: 0.5,
          stage: 'cognitive_analysis_fallback',
        },
      };
    }
  }

  /**
   * 构建分析提示
   */
  private buildAnalysisPrompt(message: string, context?: DialogueContext): string {
    const parts: string[] = [];

    parts.push(`【学生消息】\n${message}\n`);

    if (context) {
      if (context.currentTopic) {
        parts.push(`【当前主题】${context.currentTopic}\n`);
      }

      if (context.subject) {
        parts.push(`【学科】${context.subject}\n`);
      }

      if (context.learningLevel) {
        parts.push(`【学习水平】${context.learningLevel}\n`);
      }

      if (context.conversationHistory && context.conversationHistory.length > 0) {
        parts.push(`【对话历史】（最近3轮）\n`);
        const recentHistory = context.conversationHistory.slice(-6);
        for (const msg of recentHistory) {
          parts.push(`${msg.role}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
        }
        parts.push('');
      }
    }

    parts.push('请分析这段对话的认知层级和学习状态，严格按照 JSON 格式返回。');

    return parts.join('\n');
  }

  /**
   * 验证和归一化分析结果
   */
  private validateAndNormalize(analysis: CognitiveAnalysisResult): CognitiveAnalysisResult {
    return {
      cognitiveLevel: Object.values(CognitiveLevel).includes(analysis.cognitiveLevel)
        ? analysis.cognitiveLevel
        : CognitiveLevel.UNDERSTAND,
      levelScore: Math.max(1, Math.min(6, analysis.levelScore || 2)),
      understanding: Math.max(0, Math.min(1, analysis.understanding || 0.5)),
      confusionPoints: Array.isArray(analysis.confusionPoints) ? analysis.confusionPoints : [],
      engagement: Math.max(0, Math.min(1, analysis.engagement || 0.5)),
      emotionalState: ['positive', 'neutral', 'frustrated', 'confused', 'excited'].includes(analysis.emotionalState)
        ? analysis.emotionalState
        : 'neutral',
      knowledgeGaps: Array.isArray(analysis.knowledgeGaps) ? analysis.knowledgeGaps : [],
      learningStyle: analysis.learningStyle || 'mixed',
      topics: Array.isArray(analysis.topics) ? analysis.topics : [],
      questions: Array.isArray(analysis.questions) ? analysis.questions : [],
    };
  }

  /**
   * 基于规则的回退分析
   * 当 AI 解析失败时使用
   */
  private ruleBasedAnalysis(message: string): CognitiveAnalysisResult {
    const lowerMessage = message.toLowerCase();

    // 认知层级关键词
    const levelKeywords: Record<CognitiveLevel, string[]> = {
      [CognitiveLevel.REMEMBER]: ['什么是', '定义', '概念', '记住', '列举', '名称'],
      [CognitiveLevel.UNDERSTAND]: ['为什么', '解释', '理解', '意思', '区别', '比较', '举例'],
      [CognitiveLevel.APPLY]: ['怎么用', '应用', '实践', '实现', '使用', '操作'],
      [CognitiveLevel.ANALYZE]: ['分析', '分解', '关系', '结构', '原理', '原因'],
      [CognitiveLevel.EVALUATE]: ['评估', '判断', '优劣', '哪个好', '建议', '推荐', '对比'],
      [CognitiveLevel.CREATE]: ['创造', '设计', '构建', '方案', '如果', '改进', '优化'],
    };

    // 检测认知层级
    let detectedLevel: CognitiveLevel = CognitiveLevel.UNDERSTAND;
    let maxScore = 0;

    for (const [level, keywords] of Object.entries(levelKeywords)) {
      const score = keywords.filter(k => lowerMessage.includes(k)).length;
      if (score > maxScore) {
        maxScore = score;
        detectedLevel = level as CognitiveLevel;
      }
    }

    // 情绪检测
    let emotionalState: CognitiveAnalysisResult['emotionalState'] = 'neutral';
    if (/谢谢|明白|懂了|好的|可以/.test(message)) {
      emotionalState = 'positive';
    } else if (/难|不会|不懂|困惑|迷茫|错误|失败/.test(message)) {
      emotionalState = 'frustrated';
    } else if (/为什么|怎么|是什么/.test(message)) {
      emotionalState = 'confused';
    }

    // 参与度（基于消息长度）
    const engagement = Math.min(1, message.length / 200);

    // 理解度（基于问题类型）
    const isQuestion = message.includes('?') || message.includes('？');
    const understanding = isQuestion ? 0.4 : 0.7;

    // 困惑点
    const confusionPoints: string[] = [];
    if (message.includes('不懂')) confusionPoints.push('概念理解');
    if (message.includes('不会')) confusionPoints.push('实践应用');
    if (message.includes('为什么')) confusionPoints.push('原理理解');

    return {
      cognitiveLevel: detectedLevel,
      levelScore: Object.values(CognitiveLevel).indexOf(detectedLevel) + 1,
      understanding,
      confusionPoints,
      engagement,
      emotionalState,
      knowledgeGaps: confusionPoints,
      learningStyle: 'mixed',
      topics: [],
      questions: isQuestion ? [message] : [],
    };
  }

  /**
   * 批量分析对话历史
   */
  async analyzeConversationHistory(
    messages: Array<{ role: string; content: string }>
  ): Promise<CognitiveAnalysisResult[]> {
    const results: CognitiveAnalysisResult[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const result = await this.run({
          prompt: msg.content,
        });

        if (result.success && result.internal?.analysis) {
          results.push(result.internal.analysis as CognitiveAnalysisResult);
        }
      }
    }

    return results;
  }

  /**
   * 生成认知发展报告
   */
  generateProgressReport(analyses: CognitiveAnalysisResult[]): {
    avgLevel: number;
    levelProgression: CognitiveLevel[];
    understandingTrend: number[];
    dominantEmotions: Record<string, number>;
    commonConfusionPoints: string[];
    recommendations: string[];
  } {
    if (analyses.length === 0) {
      return {
        avgLevel: 0,
        levelProgression: [],
        understandingTrend: [],
        dominantEmotions: {},
        commonConfusionPoints: [],
        recommendations: [],
      };
    }

    // 平均认知层级
    const avgLevel = analyses.reduce((sum, a) => sum + a.levelScore, 0) / analyses.length;

    // 层级发展
    const levelProgression = analyses.map(a => a.cognitiveLevel);

    // 理解度趋势
    const understandingTrend = analyses.map(a => a.understanding);

    // 主导情绪
    const dominantEmotions: Record<string, number> = {};
    for (const a of analyses) {
      dominantEmotions[a.emotionalState] = (dominantEmotions[a.emotionalState] || 0) + 1;
    }

    // 常见困惑点
    const confusionPointCounts: Record<string, number> = {};
    for (const a of analyses) {
      for (const point of a.confusionPoints) {
        confusionPointCounts[point] = (confusionPointCounts[point] || 0) + 1;
      }
    }
    const commonConfusionPoints = Object.entries(confusionPointCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([point]) => point);

    // 建议
    const recommendations: string[] = [];
    if (avgLevel < 2) {
      recommendations.push('建议增加概念理解层面的练习');
    }
    if (dominantEmotions['frustrated'] > analyses.length * 0.3) {
      recommendations.push('学生多次表现出沮丧情绪，建议调整难度或提供额外支持');
    }
    if (understandingTrend[understandingTrend.length - 1] < understandingTrend[0]) {
      recommendations.push('理解度呈下降趋势，建议复习前置知识');
    }

    return {
      avgLevel,
      levelProgression,
      understandingTrend,
      dominantEmotions,
      commonConfusionPoints,
      recommendations,
    };
  }
}

export default CognitiveAnalysisAgent;
