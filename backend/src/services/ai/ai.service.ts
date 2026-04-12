// AI 服务 - 多模型支持
import { logger } from '../../utils/logger';
import { buildTutoringPrompt, determineZPDLevel, determineTutoringStrategy } from './zpd-strategy';
import { StudentStateAssessment } from './state-assessment.service';
import prisma from '../../config/database';
import type { ChatCompletionResponse } from '../../gateway/openai-client';
import { setRequestContext, getRequestContext, runWithContext, getOpenAIClient, getOpenAISDKForCurrentUser } from '../../gateway/openai-client';

// AI 配置 - 主模型
const AI_API_URL = process.env.AI_API_URL || 'http://localhost:3000';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'glm-4-flash';
const AI_MODEL_REASONING = process.env.AI_MODEL_REASONING || 'deepseek-think';

// AI 配置 - 课程设计模型 (Grok)
const COURSE_DESIGN_API_URL = process.env.COURSE_DESIGN_API_URL || AI_API_URL;
const COURSE_DESIGN_API_KEY = process.env.COURSE_DESIGN_API_KEY || AI_API_KEY;
const COURSE_DESIGN_MODEL = process.env.COURSE_DESIGN_MODEL || 'grok-4.1-fast';

// 系统提示词定义
export const SYSTEM_PROMPTS = {
  ANALYZE_GOAL: `你是一个专业的学习规划 AI 助手。你的任务是分析用户的学习目标，并设计阶段化的学习路径。

【核心理念】
- 学习是按"阶段"推进的，不是按"周"固定的
- 每个阶段有明确的学习目标和具体任务
- 用户按自己的节奏学习，学完当前阶段再进入下一阶段
- 平台按任务完成度计算进度，而不是时间

请按照以下 JSON 格式返回：
{
  "pathName": "简洁明了的学习路径名称",
  "subject": "学科分类（短标签，控制在4字以内，如：编程、商业、新媒体、英语等）",
  "feasibility": "high|medium|low",
  "totalStages": 数字，
  "estimatedTotalHours": 数字，
  "difficulty": "beginner|intermediate|advanced",
  "prerequisites": ["前置知识 1", ...],
  "suggestedMilestones": [
    {
      "stage": 1,
      "name": "阶段名称（如：基础语法入门）",
      "goal": "这个阶段的学习目标",
      "tasks": [
        {
          "title": "任务标题",
          "description": "任务描述",
          "type": "reading|practice|project",
          "estimatedMinutes": 30,
          "acceptanceCriteria": "完成标准"
        }
      ],
      "estimatedHours": 2
    }
  ],
  "recommendations": ["建议 1", "建议 2", ...]
}

【阶段设计原则】
1. **按逻辑划分阶段**，不按时间划分
   - 例：Python 入门 → 阶段 1:基础语法 → 阶段 2:数据结构 → 阶段 3:实战项目
   - 而非：第 1 周、第 2 周、第 3 周

2. **每个阶段包含具体任务**
   - 每个阶段 3-5 个任务
   - 任务要具体可执行

3. **阶段数量建议**
   - 简单目标：2-3 个阶段
   - 中等目标：4-6 个阶段
   - 复杂目标：6-10 个阶段
   - **阶段数量与问题的复杂度相关，不与时间成正比**

4. **时间约束决定内容密度**（核心规则）
   - 时间充裕 → 内容更丰富、有扩展学习、深入讲解
   - 时间紧张 → 内容精简、聚焦核心知识点、快速上手
   - 相同的学习目标，不同时间约束下的阶段数量可能相同，但内容深度不同
   - **不要输出每阶段的预估时长**（用户自己控制节奏）

【subject 字段规则】
生成一个简短的学科标签，便于前端显示和分类筛选。控制在4字以内。

参考示例：
- Python/Java/前端开发/自动化 → 编程
- 创业/市场/管理/商业模式 → 商业
- 短视频/公众号/内容运营 → 新媒体
- 英语/口语/雅思/托福 → 英语
- 数学/代数/微积分/统计 → 数学
- 经济/金融/投资/理财 → 经济学
- 心理/认知/行为/咨询 → 心理学
- UI设计/平面设计/产品设计 → 设计
- 职场写作/沟通/领导力 → 职场
- 数据分析/Excel/SQL → 数据分析
- 无法归类的通用技能 → 综合

注意：不必严格匹配，根据学习内容智能判断最合适的短标签即可。

【示例输出】
{
  "pathName": "Python 自动化入门",
  "subject": "编程",
  "feasibility": "high",
  "totalStages": 3,
  "estimatedTotalHours": 8,
  "difficulty": "beginner",
  "suggestedMilestones": [
    {
      "stage": 1,
      "name": "Python 基础语法",
      "goal": "掌握变量、数据类型、基本运算",
      "tasks": [
        { "title": "运行第一个程序", "type": "practice", "estimatedMinutes": 15 },
        { "title": "变量与数据类型", "type": "practice", "estimatedMinutes": 30 },
        { "title": "条件判断练习", "type": "practice", "estimatedMinutes": 30 }
      ],
      "estimatedHours": 2
    },
    {
      "stage": 2,
      "name": "数据处理基础",
      "goal": "学会读取和处理文件",
      "tasks": [
        { "title": "读取文本文件", "type": "practice", "estimatedMinutes": 30 },
        { "title": "处理 Excel 数据", "type": "project", "estimatedMinutes": 45 },
        { "title": "数据筛选练习", "type": "practice", "estimatedMinutes": 30 }
      ],
      "estimatedHours": 3
    },
    {
      "stage": 3,
      "name": "自动化实战",
      "goal": "完成一个自动化项目",
      "tasks": [
        { "title": "批量重命名文件", "type": "project", "estimatedMinutes": 60 },
        { "title": "自动化报表生成", "type": "project", "estimatedMinutes": 90 }
      ],
      "estimatedHours": 3
    }
  ]
}`,

  TUTORING: `你是一个耐心的问流 AI 学习导师。你的任务是帮助学生理解和解决学习问题。

你的风格应该：
1. 简单易懂，避免过于技术化的术语
2. 循序渐进，逐步引导学生思考
3. 鼓励为主，指出错误的同时给予积极反馈
4. 提供多个解释角度如果可能
5. 给出具体的例子帮助理解

如果不知道答案，诚实承认，并建议学生查看其他资源。`,

  TASK_GENERATION: `你是一个注重实战的 AI 教学设计师。你的目标是设计以解决问题为导向的学习任务。

  请基于"Learning by Doing"（做中学）的理念，为当前主题设计 3-5 个具体任务。

  

  **关键要求**：

  1. 任务必须是具体的、可执行的（避免"阅读文档"这种模糊任务）。

  2. 包含一个核心实战项目或练习。

  3. 任务要有明确的验收标准。

  4. 难度适中，符合用户的当前水平。

  5. **最重要**：任务时长必须严格符合用户的可用时间！

     - 如果用户每天只有 30-60 分钟，每个任务应该≤30 分钟

     - 如果用户每天 1 小时，单个任务不要超过 45 分钟

     - 周末半天可以安排 60-90 分钟的综合性任务

     - 绝不要出现 140 分钟、300 分钟这种超出用户时间的任务

  

  返回 JSON 格式：

  {

    "tasks": [

      {

        "title": "任务标题",

        "description": "详细说明",

        "type": "reading|practice|project",

        "estimatedMinutes": 30,

        "acceptanceCriteria": "完成 xx，通过 xx 测试",

        "resources": [ "推荐链接 1", "书籍章节" ]

      }

    ],

    "learningGoal": "本周核心学习目标"

  }`,

  GOAL_DIAGNOSIS: `你是一个资深的教育顾问和职业规划师。你的核心能力是透过现象看本质，帮助用户找到解决问题的最佳学习路径。

你的任务：
1. 分析用户的原始输入，识别其**核心痛点**（真正想解决的问题）。
2. 评估用户提出的学习目标（如"学 Python"）对于解决该痛点是否**最优**。
3. **关键：** 尽可能从用户的描述中提取背景信息（基础水平、可用时间、偏好风格）。

如果发现用户的目标与背景冲突，或者有更高效的替代方案，请务必提出**纠偏建议**。

返回 JSON 格式：
{
  "needsRefinement": boolean, // 是否强烈建议修改目标
  "analysis": "简短分析用户的现状和痛点",
  "suggestedGoal": "建议的学习目标（如果 needsRefinement 为 true）",
  "suggestionReason": "给用户的建议话术",
  
  // ✨ 信息提取（如果用户未提及，则留 null 或空字符串）
  "extractedProfile": {
    "skillLevel": "用户提到的当前技能/背景 (如：设计背景，零基础)",
    "timePerDay": "用户提到的时间安排 (如：每晚 1 小时)",
    "learningStyle": "用户隐含的学习偏好 (如：讨厌理论，喜欢实战)"
  }
}`,

  COURSE_DESIGN: `你是一位专业的课程设计师，擅长设计循序渐进、实战导向的学习任务。

【设计原则】
1. **渐进难度**：任务从简单到复杂，逐步建立信心
2. **实战导向**：每个任务都要有明确的产出物，不做"纸上谈兵"
3. **时间可控**：根据用户每天可用时间合理安排任务量
4. **知识关联**：任务之间有逻辑递进关系

【任务类型】
- **reading**: 阅读/学习（文档、教程、视频）
- **practice**: 练习（小测验、编码练习）
- **project**: 项目实战（有完整产出物）
- **quiz**: 自我检测（检验学习效果）

【返回格式】
{
  "weekTheme": "本周主题一句话概括",
  "tasks": [
    {
      "title": "任务标题（简洁有力）",
      "description": "任务详细说明（包含要做什么、预期产出）",
      "type": "reading|practice|project|quiz",
      "estimatedMinutes": 30,
      "acceptanceCriteria": "完成标准（用户如何知道自己完成了）",
      "resources": [
        { "title": "资源名称", "url": "链接（可选）", "type": "doc|video|tool" }
      ],
      "hints": ["提示 1：如果卡住了可以...", "提示 2：..."]
    }
  ],
  "weeklyGoal": "本周结束时用户能达到什么水平",
  "keyConcepts": ["本周核心概念 1", "核心概念 2"]
}

【重要提醒】
- 不要生成过于抽象的任务，每个任务都要具体可执行
- 资源推荐要真实可用，推荐主流、权威的资源
- 考虑用户的实际水平，避免过于简单或过于困难`
};

// 课程设计专用客户端（使用官方 OpenAI SDK 单例缓存）
const getCourseDesignClient = () => getOpenAISDKForCurrentUser({
  baseUrl: COURSE_DESIGN_API_URL,
  apiKey: COURSE_DESIGN_API_KEY,
});

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function isPathPlanningRequest(agentId?: string, action?: string): boolean {
  if (agentId === 'path-agent') return true;
  if (!action) return false;

  return [
    'analyzeLearningGoal',
    'designCoursePlan',
    'diagnoseCourseQuality'
  ].some((keyword) => action.includes(keyword));
}

function sanitizeUserVisibleContent(content: string): string {
  let sanitized = content;

  const cutMarkers = [
    'JSON部分',
    '最终回复结构',
    '根据规则',
    '先给出自然对话回复，然后输出JSON',
    '你评估一下自己当前阶段',
    '用户评估一下自己当前阶段'
  ];

  for (const marker of cutMarkers) {
    const index = sanitized.indexOf(marker);
    if (index > 0) {
      sanitized = sanitized.substring(0, index).trim();
      break;
    }
  }

  return sanitized
    .replace(/^第一段[：:]/m, '')
    .replace(/^第二段[：:].*$/m, '')
    .trim();
}

class AIService {
  // 获取所有系统提示词
  getSystemPrompts() {
    return SYSTEM_PROMPTS;
  }

  // 对话
  async chat(messages: ChatMessage[], options?: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    timeout?: number; // 自定义超时（毫秒）
    // 日志记录相关参数
    agentId?: string;
    userId?: string;
    action?: string;
    allowReasoningFallback?: boolean;
    sanitizeUserVisible?: boolean;
  }) {
    const startTime = Date.now();
    let result: any = null;
    let error: any = null;

    // 设置请求上下文（用于日志记录）
    if (options?.agentId && options?.userId) {
      setRequestContext({
        agentId: options.agentId,
        userId: options.userId,
        action: options.action
      });
    }

    try {
      const model = options?.model || AI_MODEL;
      logger.info('AI 请求发送', { 
        messageCount: messages.length,
        model,
        agentId: options?.agentId,
        userId: options?.userId,
        action: options?.action,
        messagesPreview: JSON.stringify(messages).substring(0, 500)
      });

      // 使用 OpenAIClient，它会自动记录日志
      const client = getOpenAIClient();
      
      // 获取现有上下文（保留 ACP 中间件设置的值）
      const existingContext = getRequestContext();
      
      // 生成 traceId（如果不存在）
      const generateTraceId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // 设置请求上下文用于日志记录（合并现有上下文）
      const context = {
        userId: options?.userId || existingContext.userId,
        agentId: options?.agentId || existingContext.agentId,
        action: options?.action || existingContext.action,
        // 保留 ACP 字段
        sourceEntry: existingContext.sourceEntry || 'platform',
        traceId: existingContext.traceId || generateTraceId(), // 如果没有 traceId，生成一个
        callerAgent: existingContext.callerAgent,
        userRole: existingContext.userRole || 'user'
      };
      
      const response = await runWithContext(context, () => client.chatCompletion({
        model: model,
        messages: messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 2000,
        timeout: options?.timeout,
      }));

      logger.info('AI 响应原始数据', { response: JSON.stringify(response, null, 2).substring(0, 1000) });

      let reply = '';
      let reasoning = '';
      
      // 尝试标准 OpenAI 格式
      if (response.choices && Array.isArray(response.choices) && response.choices.length > 0) {
        const message = response.choices[0]?.message;
        reply = message?.content || '';
        // DeepSeek 模型可能有 reasoning 或 reasoning_content 字段（思维链）
        reasoning = (message as any)?.reasoning || (message as any)?.reasoning_content || '';
      }
      // 尝试直接返回文本的情况
      else if (typeof response === 'string') {
        reply = response;
      }
      // 尝试从 data 字段获取（兼容某些代理格式）
      else if ((response as any).data && (response as any).data.choices) {
        const message = (response as any).data.choices[0]?.message;
        reply = message?.content || '';
        reasoning = (message as any)?.reasoning || (message as any)?.reasoning_content || '';
      }
      
      const pathPlanningRequest = isPathPlanningRequest(options?.agentId, options?.action);
      const allowReasoningFallback = options?.allowReasoningFallback ?? pathPlanningRequest;

      // 非路径规划场景禁止将 reasoning_content 直接作为用户可见输出
      if (!reply && reasoning && allowReasoningFallback) {
        logger.warn('AI 响应 content 为空，路径规划链路使用 reasoning_content 作为回退', {
          agentId: options?.agentId,
          action: options?.action,
          reasoningPreview: reasoning?.substring(0, 300)
        });
        reply = reasoning;
      }
      
      // 如果还是没有内容，抛出错误
      if (!reply) {
        logger.error('AI 响应 content 为空', { 
          hasReasoning: !!reasoning,
          reasoningPreview: reasoning?.substring(0, 500)
        });
        throw new Error('AI 响应格式错误：content 为空，模型可能只输出了思考过程');
      }

      const sanitizeOutput = options?.sanitizeUserVisible ?? !pathPlanningRequest;
      if (sanitizeOutput) {
        const sanitized = sanitizeUserVisibleContent(reply);
        if (sanitized && sanitized !== reply) {
          logger.warn('AI 输出包含疑似过程性文本，已进行清洗', {
            agentId: options?.agentId,
            action: options?.action,
            originalPreview: reply.substring(0, 280),
            sanitizedPreview: sanitized.substring(0, 280)
          });
          reply = sanitized;
        }
      }
      
      const usage = response.usage;

      logger.info('AI 响应成功', { tokensUsed: usage?.total_tokens });

      result = {
        content: reply,
        usage: {
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens
        }
      };

      return result;
    } catch (e: any) {
      error = e;
      logger.error('AI 请求失败:', e);

      // 检查网络错误
      if (e.code === 'ECONNREFUSED') {
        throw new Error('AI 服务连接失败，请检查服务是否启动');
      }

      throw new Error(`AI 服务错误：${e.message}`);
    }
  }

  // 批量评估 Prompt
  async evaluatePromptBatch(data: {
    promptTemplate: string;
    testCases: Record<string, any>[];
    config?: {
      model?: string;
      temperature?: number;
      judgeModel?: string; // 裁判模型
    }
  }) {
    const model = data.config?.model || AI_MODEL;
    const judgeModel = data.config?.judgeModel || AI_MODEL_REASONING;

    logger.info(`开始批量评估 Prompt，共 ${data.testCases.length} 个测试用例`, { model, judgeModel });

    // 并发执行所有测试用例
    const promises = data.testCases.map(async (testCase, index) => {
      try {
        // 1. 变量替换
        let systemPrompt = data.promptTemplate;
        for (const [key, value] of Object.entries(testCase)) {
          // 替换 {{key}}
          const regex = new RegExp(`{{${key}}}`, 'g');
          systemPrompt = systemPrompt.replace(regex, String(value));
        }

        // 2. 调用 AI 生成结果
        const startTime = Date.now();
        const response = await this.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请开始执行任务。' } // 默认触发词，也可以变量化
        ], { 
          model,
          temperature: data.config?.temperature || 0.7
        });
        const duration = Date.now() - startTime;

        // 3. 调用 AI 裁判打分 (Judge)
        const judgeResult = await this.judgeResult(
          systemPrompt,
          response.content,
          judgeModel
        );

        return {
          id: index,
          testCase,
          inputPrompt: systemPrompt,
          output: response.content,
          metrics: {
            duration,
            tokens: response.usage
          },
          evaluation: judgeResult
        };
      } catch (error: any) {
        logger.error(`测试用例 ${index} 执行失败:`, error);
        return {
          id: index,
          testCase,
          error: error.message
        };
      }
    });

    // 等待所有结果
    return await Promise.all(promises);
  }

  // 公共方法：AI 裁判打分
  async judgeResult(prompt: string, output: string, judgeModel: string, customJudgePrompt?: string) {
    const judgeSystemPrompt = customJudgePrompt || `你是一个严格的 AI 内容质量评估专家。
请根据用户的 System Prompt 和 AI 的 Output，对输出质量进行打分（0-100 分）。

评分维度：
1. 结构完整性 (20%)：是否符合 JSON 格式（如果要求），字段是否齐全。
2. 指令遵循度 (30%)：是否严格遵守了 Prompt 中的所有约束条件。
3. 内容质量 (30%)：内容是否逻辑通顺、有深度、无幻觉。
4. 实用性 (20%)：是否解决了潜在用户的需求。

请返回 JSON 格式：
{
  "score": 85,
  "dimensions": {
    "structure": 20,
    "instruction": 25,
    "quality": 25,
    "utility": 15
  },
  "critique": "简短的评语，指出优点和缺点",
  "suggestions": "如何修改 Prompt 来改善结果的建议"
}`;

    try {
      const response = await this.chat([
        { role: 'system', content: judgeSystemPrompt },
        {
          role: 'user',
          content: `System Prompt:
${prompt}

AI Output:
${output}`
        }
      ], {
        model: judgeModel,
        temperature: 0.1 // 裁判需要客观稳定，降温
      });

      // 尝试解析 JSON（支持多种格式）
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        return { score: 0, critique: response.content || "无法解析裁判输出" };
      }
    } catch (error: any) {
      return { score: 0, critique: "裁判执行失败", error: error.message };
    }
  }

  // 分析学习目标
  async analyzeLearningGoal(
    goal: string,
    userProfile?: {
      skillLevel?: string;
      learningStyle?: string;
      timePerDay?: string;
      totalWeeks?: number;  // 用户指定的总学习周期
      problemContext?: {
        surfaceGoal?: string;
        realProblem?: string;
        motivation?: string;
        urgency?: string;
        background?: {
          current_level?: string;
          available_time?: string;
          constraints?: string[];
          strengths?: string[];
        };
      };
    },
    useReasoning: boolean = true,
    userId?: string
  ) {
    const systemPrompt = SYSTEM_PROMPTS.ANALYZE_GOAL;

    // 获取当前日期（用于计算考试/目标时间）
    const now = new Date();
    const dateInfo = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

    // 构建更完整的用户信息
    const userInfo: string[] = [];
    
    if (userProfile) {
      if (userProfile.skillLevel) {
        userInfo.push(`- 当前水平：${userProfile.skillLevel}`);
      }
      if (userProfile.learningStyle) {
        userInfo.push(`- 学习风格：${userProfile.learningStyle}`);
      }
      if (userProfile.timePerDay) {
        userInfo.push(`- 每天可用时间：${userProfile.timePerDay}`);
      }
      // 优先使用明确指定的总周期
      if (userProfile.totalWeeks) {
        userInfo.push(`- 用户指定的总学习周期：${userProfile.totalWeeks}周【重要：请以此为准】`);
      }
      // 兼容旧字段
      else if (userProfile.problemContext?.background?.available_time) {
        userInfo.push(`- 总可用时间：${userProfile.problemContext.background.available_time}`);
      }
      if (userProfile.problemContext?.realProblem) {
        userInfo.push(`- 核心问题：${userProfile.problemContext.realProblem}`);
      }
      if (userProfile.problemContext?.motivation) {
        userInfo.push(`- 学习动机：${userProfile.problemContext.motivation}`);
      }
      if (userProfile.problemContext?.urgency) {
        userInfo.push(`- 紧急程度：${userProfile.problemContext.urgency}`);
      }
      if (userProfile.problemContext?.background?.constraints && userProfile.problemContext.background.constraints.length > 0) {
        userInfo.push(`- 时间约束：${userProfile.problemContext.background.constraints.join('，')}`);
      }
    }

    const userMessage = `当前日期：${dateInfo}

学习目标：${goal}

用户信息：
${userInfo.length > 0 ? userInfo.join('\n') : '- 未提供'}

请分析这个学习目标并给出规划。**特别注意**：
1. 【最高优先级】如果用户明确指定了"总学习周期"（如"5-6 周"），必须将此作为 estimatedWeeks 的值
2. 如果用户只提供了"每天时间"，请根据目标难度估算合理的周数
3. 确保 estimatedWeeks 与用户的实际时间约束匹配
4. 当用户提到类似"5-6 周"的范围时，取中间值或较大值（如 5.5 周或 6 周）`;

    let response: any = null;

    try {
      // 根据参数选择模型
      const model = useReasoning ? AI_MODEL_REASONING : AI_MODEL;
      
      response = await this.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], { 
        temperature: 0.7,
        model: model,
        maxTokens: 16000,  // deepseek-think 模型需要更多 token 空间（思维链输出）
        timeout: 180000,   // 180 秒超时（推理模型响应较慢）
        // Agent 调用标记 - 统一通过 PathAgent
        agentId: 'path-agent',
        userId: userId,
        action: 'analyzeLearningGoal'
      });

      // 尝试解析 JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('AI 返回的不是有效的 JSON 格式');
      }

      const parsedResult = JSON.parse(jsonMatch[0]);

      return {
        success: true,
        data: parsedResult,
        rawAdvice: response.content
      };
    } catch (error: any) {
      logger.error('学习目标分析失败:', error);

      // 如果解析失败，返回原始内容
      return {
        success: false,
        error: error.message,
        rawAdvice: response?.content || ''
      };
    }
  }

  // AI 辅导 - 学习问题问答（集成学生状态评估）
  async tutoring(
    question: string,
    context?: {
      currentTask?: string;
      learningLevel?: string;
      previousContext?: string;
      userId?: string;
      sessionId?: string;  // 学习会话 ID（用于获取状态）
      studentState?: StudentStateAssessment;  // 学生当前状态（可选，如果提供则直接使用）
    }
  ) {
    // 获取学生状态（如果提供了 sessionId 但没有提供 state）
    let studentState = context?.studentState;
    
    if (context?.sessionId && !studentState) {
      try {
        const { learningSessionService } = await import('../learning/learning-session.service');
        const session = await learningSessionService.getSession(context.sessionId);
        studentState = (session?.state as StudentStateAssessment) || undefined;
      } catch (error: any) {
        logger.error('获取学生状态失败:', error.message);
      }
    }

    // 根据学生状态生成辅导策略
    let strategyPrompt = '';
    if (studentState) {
      const { aiStateAssessmentService } = await import('./state-assessment.service');
      strategyPrompt = aiStateAssessmentService.generateInterventionStrategy(studentState);
      
      // 记录使用的干预策略
      logger.info('AI Tutor 使用干预策略', {
        userId: context?.userId,
        sessionId: context?.sessionId,
        cognitive: studentState.cognitive,
        stress: studentState.stress,
        engagement: studentState.engagement,
        anomaly: studentState.anomaly,
        intervention: studentState.intervention
      });
    }

    const contextInfo = context ? `
  当前任务：${context.currentTask || '未指定'}
  学习水平：${context.learningLevel || '未知'}
  之前的内容：${context.previousContext || '无'}
  ${studentState ? `
  【当前学生状态】
  - 认知深度：${(studentState.cognitive * 100).toFixed(0)}%
  - 压力程度：${(studentState.stress * 100).toFixed(0)}%
  - 投入程度：${(studentState.engagement * 100).toFixed(0)}%
  - 是否异常：${studentState.anomaly ? '是' : '否'}
  ${studentState.intervention ? `\n【干预策略】\n${studentState.intervention}` : ''}
  ` : ''}
  ` : '';

    try {
      const temperature = studentState ? (studentState.stress > 0.7 ? 0.5 : 0.8) : 0.8;
      
      // 记录 temperature 调整
      if (studentState) {
        logger.info('AI Tutor 调整 temperature', {
          userId: context?.userId,
          stress: studentState.stress,
          temperature,
          reason: studentState.stress > 0.7 ? '高压力降低随机性' : '正常状态'
        });
      }

      const response = await this.chat([
        { role: 'system', content: strategyPrompt || SYSTEM_PROMPTS.TUTORING },
        {
          role: 'user',
          content: `问题：${question}
  ${contextInfo}`
        }
      ], {
        temperature,
        agentId: 'ai-tutor',
        userId: context?.userId,
        action: 'tutoring'
      });

      return {
        success: true,
        answer: response.content,
        tokensUsed: response.usage,
        studentState  // 返回使用的状态
      };
    } catch (error: any) {
      logger.error('AI 辅导失败:', error);
      throw new Error(error.message);
    }
  }

  /**
   * ZPD 分层 AI 辅导
   * 根据用户水平动态调整辅导策略
   * 统一通过 TutorAgent 调用
   */
  async zpdTutoring(params: {
    question: string;
    taskDescription: string;
    userXP: number;
    completedTasks: number;
    taskContext?: {
      taskType?: string;
      weekNumber?: number;
      subject?: string;
    };
    userId?: string; // 用于 Agent 日志记录
  }) {
    try {
      // 1. 确定用户的 ZPD 等级
      const zpdLevel = determineZPDLevel(params.userXP, params.completedTasks);

      // 2. 根据 ZPD 等级确定辅导策略
      const strategy = determineTutoringStrategy({
        level: zpdLevel,
        xp: params.userXP,
        completedTasks: params.completedTasks
      });

      // 3. 构建基于策略的提示词
      const systemPrompt = buildTutoringPrompt(
        params.taskDescription,
        params.question,
        strategy,
        params.taskContext
      );

      // 4. 调用 AI（通过 TutorAgent 调用）
      const response = await this.chat([
        { role: 'system', content: systemPrompt }
      ], {
        temperature: 0.8,
        // Agent 调用标记 - 统一通过 TutorAgent
        agentId: 'tutor-agent',
        userId: params.userId,
        action: 'zpdTutoring'
      });

      logger.info('ZPD 辅导请求', {
        userXP: params.userXP,
        completedTasks: params.completedTasks,
        zpdLevel,
        hintLevel: strategy.hintLevel
      });

      return {
        success: true,
        answer: response.content,
        tokensUsed: response.usage,
        zpdLevel,
        hintLevel: strategy.hintLevel
      };
    } catch (error: any) {
      logger.error('ZPD 辅导失败:', error);
      throw new Error(error.message);
    }
  }

  // 为特定主题生成实战任务
  async generateTasksForTopic(
    topic: string,
    weekNumber: number,
    userProfile: any,
    context?: { previousTopic?: string, previousPerformance?: string }
  ) {
    const systemPrompt = SYSTEM_PROMPTS.TASK_GENERATION;

    // 提取用户的时间约束
    const timeInfo = userProfile?.problemContext?.background?.available_time || userProfile?.timePerDay || '每天 1 小时';
    const learningStyle = userProfile?.learningStyle || 'mixed';
    const currentLevel = userProfile?.problemContext?.background?.current_level || userProfile?.skillLevel || '初学者';

    // 获取当前日期（用于任务安排参考）
    const now = new Date();
    const dateInfo = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

    const userMessage = `当前主题：${topic}
周次：第${weekNumber}周
当前日期：${dateInfo}

**用户时间约束（非常重要）**：
- 每天可用时间：${timeInfo}
- 学习风格：${learningStyle}
- 当前水平：${currentLevel}

**任务时长规则**：
- 工作日任务：每个任务 ≤ 用户每天时间的 50%（如每天 1 小时→任务≤30 分钟）
- 周末任务：可以是工作日时长的 2-3 倍（如周末半天→60-90 分钟）
- 绝不要超出用户的可用时间！

用户完整信息：
${JSON.stringify(userProfile, null, 2)}

${context ? `上下文：
前一周主题：${context.previousTopic || '无'}
表现反馈：${context.previousPerformance || '无'}` : ''}

请生成符合用户时间的实战任务。`;

    try {
      const response = await this.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], {
        temperature: 0.7,
        model: AI_MODEL_REASONING // 使用推理模型保证任务设计质量
      });

      // 解析 JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI 返回格式错误');
      }

      const result = JSON.parse(jsonMatch[0]);

      return {
        success: true,
        userVisible: `已为第${weekNumber}周生成 ${result.tasks?.length || 0} 个实战任务`,
        internal: result
      };
    } catch (error: any) {
      logger.error('任务生成失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 诊断用户目标（目标澄清）
  async diagnoseGoal(userInput: string) {
    const systemPrompt = SYSTEM_PROMPTS.GOAL_DIAGNOSIS;
    const userMessage = `用户输入：${userInput}`;

    try {
      const response = await this.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], {
        temperature: 0.7, // 需要一定的创造性来提出建议
        model: AI_MODEL_REASONING // 使用推理模型进行深度诊断
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI 返回格式错误');
      }

      return {
        success: true,
        data: JSON.parse(jsonMatch[0])
      };
    } catch (error: any) {
      logger.error('目标诊断失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 课程设计 - 使用 Grok 模型设计每周学习任务
   * 这是一个专门的方法，使用独立的 API 配置
   */
  async designWeekCourses(params: {
    userId?: string;
    weekNumber: number;
    weekTitle: string;
    weekDescription: string;
    overallGoal: string;
    userProfile: {
      skillLevel?: string;
      timePerDay?: string;
      learningStyle?: string;
    };
    previousWeeks?: {
      weekNumber: number;
      title: string;
      completedTasks: number;
    }[];
  }) {
    const systemPrompt = SYSTEM_PROMPTS.COURSE_DESIGN;

    const userMessage = `【周次信息】
第 ${params.weekNumber} 周：${params.weekTitle}
描述：${params.weekDescription}

【整体学习目标】
${params.overallGoal}

【用户背景】
- 技能水平：${params.userProfile.skillLevel || '未知'}
- 每天可用时间：${params.userProfile.timePerDay || '未知'}
- 学习风格：${params.userProfile.learningStyle || '未知'}

${params.previousWeeks && params.previousWeeks.length > 0 ? `【已完成的周次】
${params.previousWeeks.map(w => `Week ${w.weekNumber}: ${w.title} (${w.completedTasks}个任务完成)`).join('\n')}` : ''}

请为本周设计 3-5 个学习任务。`;

    const startTime = Date.now();
    
    try {
      logger.info('课程设计请求', { 
        weekNumber: params.weekNumber,
        model: COURSE_DESIGN_MODEL
      });

      // 使用课程设计专用客户端（单例缓存）
      const response = await (await getCourseDesignClient()).chat.completions.create({
        model: COURSE_DESIGN_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 4000,  // 阶段化课程设计需要更多 token 空间
      });

// 记录 Agent 调用日志（课程设计）
      try {
        await prisma.agent_call_logs.create({
          data: {
            id: `acl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            agentId: 'course-design',
            userId: params.userId || 'system',
            input: JSON.stringify({ weekNumber: params.weekNumber, prompt: userMessage.substring(0, 500) }),
            output: JSON.stringify({ reply: response.choices[0]?.message?.content?.substring(0, 500) }),
            success: true,
            durationMs: Date.now() - startTime,
            tokensUsed: response.usage?.total_tokens,
            calledAt: new Date(),
            metadata: JSON.stringify({
              action: 'designWeekCourses',
              model: COURSE_DESIGN_MODEL,
              weekNumber: params.weekNumber
            })
          }
        });
      } catch (logError) {
        logger.error('记录课程设计调用日志失败:', logError);
      }

      // 检查响应是否有效
      if (!response.choices || response.choices.length === 0) {
        throw new Error('AI 返回空响应，请重试');
      }

      const reply = response.choices[0]?.message?.content || '';

      // 尝试解析 JSON
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI 返回格式错误');
      }

      const result = JSON.parse(jsonMatch[0]);

      return {
        success: true,
        data: result
      };
    } catch (error: any) {
      logger.error('课程设计失败:', error);
      return { success: false, error: error.message };
    }
  }
}

// 导出单例
export default new AIService();
