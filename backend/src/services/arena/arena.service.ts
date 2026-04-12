import aiService from '../ai/ai.service';
import { logger } from '../../utils/logger';
import { RuleBasedUserAgent } from './user-agent';
import {
  PERSONA_AGENT_CONFIG,
  EXTRACT_AGENT_CONFIG,
  GENERATE_AGENT_CONFIG,
  EVALUATE_AGENT_CONFIG,
  OPTIMIZE_AGENT_CONFIG,
  EXTRACT_AGENT_SYSTEM_PROMPT,
  getPersonaUserPrompt,
  getUserAgentPrompt
} from './agent-configs';
import dataMappingAgent from '../../agents/data-mapping-agent';
import { runGoalConversationAgent } from '../../agents/goal-conversation-agent';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

const ARENA_GOAL_GREETING = `你好！👋 我是你的学习规划师小智。

告诉我你想学什么，我来帮你找到真正要解决的问题。

💡 小提示：与其说"我想学 Python"，不如告诉我你想用 Python 做什么？`;

/**
 * 多智能体演练场服务
 * 协调多个AI Agent完成从画像到优化的完整流程
 */
class ArenaService {

  /**
   * 解析AI响应，处理markdown代码块包装
   */
  private parseAIResponse(content: string): any {
    try {
      let cleanedContent = content.trim();

      // 清理 markdown 代码块标记
      if (cleanedContent.includes('```')) {
        const codeBlockMatch = cleanedContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          cleanedContent = codeBlockMatch[1].trim();
        }
      }

      return JSON.parse(cleanedContent);
    } catch (e: any) {
      logger.warn('AI响应JSON解析失败，尝试恢复部分数据', {
        error: e.message,
        contentLength: content.length
      });

      // 尝试从截断的JSON中恢复数据
      try {
        let cleanedContent = content.trim();

        // 清理 markdown 代码块标记
        if (cleanedContent.includes('```')) {
          const codeBlockMatch = cleanedContent.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch && codeBlockMatch[1]) {
            cleanedContent = codeBlockMatch[1].trim();
          }
        }

        // 尝试修复截断的JSON：添加缺失的括号和引号
        let openBraces = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < cleanedContent.length; i++) {
          const char = cleanedContent[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') openBraces++;
            if (char === '}') openBraces--;
          }
        }

        // 如果有未闭合的括号，添加对应的闭合括号
        while (openBraces > 0) {
          cleanedContent += '}';
          openBraces--;
        }

        // 如果最后是截断的字符串，添加引号闭合
        if (cleanedContent.endsWith('"')) {
          // 正常结尾
        } else if (cleanedContent.match(/:\s*"[^"]*$/)) {
          cleanedContent += '"';
        }

        // 尝试解析修复后的JSON
        return JSON.parse(cleanedContent);
      } catch (e2: any) {
        logger.error('JSON修复失败，返回原始内容', { error: e2.message });
        return { rawContent: content, parseError: true };
      }
    }
  }

  // ==================== 1. 画像Agent ====================
  async runPersonaAgent(sessionId: string, config?: any) {
    const startTime = Date.now();
    
    try {
      // 创建Agent日志
      const log = await this.createAgentLog(sessionId, 'PersonaAgent', 'persona');
      
      // 从统一配置获取 Prompt
      const systemPrompt = PERSONA_AGENT_CONFIG.systemPrompt;

      // 使用配置函数生成 userPrompt（保证每次不同）
      const userPrompt = getPersonaUserPrompt(config);
      
      const response = await aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { 
        temperature: PERSONA_AGENT_CONFIG.temperature, 
        maxTokens: PERSONA_AGENT_CONFIG.maxTokens,
        agentId: 'persona-agent',
        userId: 'arena-system'
      });

      // 解析画像（使用统一的parseAIResponse方法）
      const persona = this.parseAIResponse(response.content);

      // 如果解析失败，返回错误信息
      if (persona.parseError) {
        logger.error('PersonaAgent输出解析失败，建议增加maxTokens', {
          contentLength: response.content.length,
          truncatedContent: response.content.substring(0, 500)
        });
      }

      // 使用DataMappingAgent进行智能数据映射
      let mappedPersona = persona;
      try {
        const mappingResult = await dataMappingAgent.mapPersona(persona);
        if (mappingResult.success) {
          mappedPersona = mappingResult.internal;
          logger.info('PersonaAgent数据映射成功', {
            mappedFields: Object.keys(mappedPersona),
            warnings: mappingResult.warnings
          });
        } else {
          logger.warn('PersonaAgent数据映射失败，使用原始数据', {
            errors: mappingResult.errors
          });
        }
      } catch (e) {
        logger.error('DataMappingAgent调用失败', e);
      }

      // 保存画像 (使用 upsert 避免重复创建)
      const savedPersona = await prisma.arena_personas.upsert({
        where: { sessionId },
        update: {
          content: JSON.stringify(mappedPersona),
          surfaceGoal: mappedPersona.surfaceGoal || persona.surfaceGoal,
          realProblem: mappedPersona.realProblem || persona.realProblem,
          level: mappedPersona.level || persona.level,
          timePerDay: mappedPersona.timePerDay || persona.timePerDay,
          totalWeeks: String(mappedPersona.totalWeeks || persona.totalWeeks || ''), // 转为字符串
          motivation: mappedPersona.motivation || persona.motivation,
          urgency: mappedPersona.urgency || persona.urgency,
          generationTimeMs: Date.now() - startTime,
          agentName: 'PersonaAgent'
        },
        create: {
          id: uuidv4(),
          sessionId,
          content: JSON.stringify(mappedPersona),
          surfaceGoal: mappedPersona.surfaceGoal || persona.surfaceGoal,
          realProblem: mappedPersona.realProblem || persona.realProblem,
          level: mappedPersona.level || persona.level,
          timePerDay: mappedPersona.timePerDay || persona.timePerDay,
          totalWeeks: String(mappedPersona.totalWeeks || persona.totalWeeks || ''),
          motivation: mappedPersona.motivation || persona.motivation,
          urgency: mappedPersona.urgency || persona.urgency,
          generationTimeMs: Date.now() - startTime,
          agentName: 'PersonaAgent'
        }
      });

      // 更新日志
      await this.updateAgentLog(log.id, {
        status: 'success',
        endTime: new Date(),
        durationMs: Date.now() - startTime,
        output: JSON.stringify(persona),
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
        totalTokens: response.usage?.totalTokens || 0
      });

      return { success: true, data: savedPersona };
    } catch (error: any) {
      logger.error('PersonaAgent failed:', error);
      throw error;
    }
  }

  // ==================== 2. 对话Agent (UserAgent ↔ GoalConversationAgent 交互模式) ====================
  async runDialogAgent(sessionId: string, options?: { maxRounds?: number, manualMode?: boolean, fromRound?: number }) {
    const startTime = Date.now();
    const maxRounds = Math.min(options?.maxRounds || 25, 30); // 最多30轮
    const fromRound = options?.fromRound || 1; // 从第几轮开始
    
    try {
      const log = await this.createAgentLog(sessionId, 'DialogAgent', 'dialogue');
      
      // 获取画像
      const persona = await prisma.arena_personas.findUnique({
        where: { sessionId }
      });
      
      if (!persona) {
        throw new Error('No persona found');
      }

      const personaData = JSON.parse(persona.content);
      
      // 记录画像数据用于调试
      logger.info('画像数据加载', {
        name: personaData.name || '匿名',
        surfaceGoal: personaData.surfaceGoal,
        realProblem: personaData.realProblem,
        level: personaData.level,
        learningState: personaData.psychology?.learningState,
        scenario: personaData.scenario
      });

      // 创建规则化 User Agent（模拟用户）- 用画像"实例化"一个数字人
      const userAgent = new RuleBasedUserAgent(personaData);
      logger.info(`数字人实例化完成: ${personaData.name || '匿名'}`, {
        initialState: userAgent.getState()
      });

      // 开始交互对话
      const messages: any[] = [];

      // GoalConversationAgent 开场白（固定）
      let currentSystemMessage = ARENA_GOAL_GREETING;
      let arenaUnderstanding: any = {};
      
      messages.push({
        role: 'assistant',
        content: currentSystemMessage,
        round: 1,
          agent: 'GoalConversationAgent',
        timestamp: new Date().toISOString()
      });

      // 辅助函数：实时保存对话
      const saveDialogueRealtime = async (msgs: any[]) => {
        const userCount = msgs.filter((m: any) => m.role === 'user').length;
        const aiCount = msgs.filter((m: any) => m.role === 'assistant').length;
        await prisma.arena_dialogues.upsert({
          where: { sessionId },
          update: {
            messages: JSON.stringify(msgs),
            messageCount: msgs.length,
            userMessageCount: userCount,
            aiMessageCount: aiCount,
            generationTimeMs: Date.now() - startTime,
            agentName: 'DialogAgent'
          },
          create: {
            id: uuidv4(),
            sessionId,
            messages: JSON.stringify(msgs),
            messageCount: msgs.length,
            userMessageCount: userCount,
            aiMessageCount: aiCount,
            generationTimeMs: Date.now() - startTime,
            agentName: 'DialogAgent'
          }
        });
      };

      // 如果从指定轮次开始，需要加载之前的对话历史
      let existingMessages: any[] = [];
      if (fromRound > 1) {
        const existingDialogue = await prisma.arena_dialogues.findUnique({
          where: { sessionId }
        });
        if (existingDialogue && existingDialogue.messages) {
          try {
            existingMessages = JSON.parse(existingDialogue.messages);
            // 只保留到 fromRound-1 的消息
            existingMessages = existingMessages.filter((m: any) => m.round < fromRound);
            logger.info(`加载了之前的对话历史`, { count: existingMessages.length });
          } catch (e) {
            logger.warn('解析已有对话失败', e);
          }
        }
      }

      for (let round = fromRound; round <= maxRounds; round++) {
        // 检查是否被手动停止
        const sessionStatus = await prisma.arena_sessions.findUnique({
          where: { id: sessionId },
          select: { status: true }
        });

        if (sessionStatus?.status === 'stopped') {
          logger.info('对话被手动停止', { sessionId, round });
          break;
        }

        logger.info(`第 ${round} 轮对话开始`, { sessionId, round });
        
        // ====== UserAgent 生成回复 ======
        // 调用规则化 UserAgent 生成回复
        const interactionResult = userAgent.generateResponse(currentSystemMessage);
        
        // 记录用户消息
        messages.push({
          role: 'user',
          content: interactionResult.userResponse,
          round: round,
          agent: 'UserAgent',
          userState: userAgent.getState(), // 当前状态
          revealedInfo: interactionResult.revealedInfo, // 本轮透露的信息
          timestamp: new Date().toISOString()
        });
        
        // 实时保存（用户消息）
        await saveDialogueRealtime(messages);
        
        logger.info(`UserAgent(${personaData.name || '匿名'})回复:`, {
          response: interactionResult.userResponse.substring(0, 100),
          round: interactionResult.round,
          templateUsed: interactionResult.metadata.templateUsed
        });

        // 短暂等待，避免触发限流
        await new Promise(resolve => setTimeout(resolve, 100));

        // ====== GoalConversationAgent 继续对话（如果不是最后一轮）======
        // 检查是否需要提前结束（输出了"### 确认方案"）
        const needsConfirmation = currentSystemMessage.includes('### 确认方案');
        
        if (needsConfirmation) {
          logger.info('GoalConversationAgent 触发确认方案，对话即将结束');
          
          // 让 UserAgent 做最后一次确认回复
          const confirmResult = userAgent.generateResponse(
            '好的，我已经收集到足够信息，现在需要你确认。请回复"好的，确认"或补充你还想了解的内容。'
          );
          
          messages.push({
            role: 'user',
            content: confirmResult.userResponse,
            round: round + 1,
            agent: 'UserAgent',
            userState: userAgent.getState(),
            revealedInfo: confirmResult.revealedInfo,
            timestamp: new Date().toISOString(),
            isConfirmation: true // 标记为确认消息
          });
          
          // 实时保存
          await saveDialogueRealtime(messages);
          
          logger.info('UserAgent 确认回复:', { response: confirmResult.userResponse });
          break; // 结束对话循环
        }
        
        if (round < maxRounds) {
          // 构建对话历史（用于 GoalConversationAgent）- 只传入最近的4-6轮
          const recentMessages = messages.slice(-6).map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content
          }));

          // 调用 GoalConversationAgent（只使用 userVisible 部分）
          const latestUserMessage = [...recentMessages].reverse().find((m: any) => m.role === 'user')?.content || '';
          const historyForAgent = latestUserMessage
            ? recentMessages.slice(0, -1)
            : recentMessages;

          const systemOutput = await runGoalConversationAgent({
            input: latestUserMessage || '请继续对话',
            userId: 'arena-system',
            conversationHistory: historyForAgent,
            previousUnderstanding: arenaUnderstanding
          });

          arenaUnderstanding = systemOutput.internal?.understanding || arenaUnderstanding;

          // 只传递 userVisible 给 UserAgent，内部数据不暴露
          currentSystemMessage = systemOutput.userVisible;
          messages.push({
            role: 'assistant',
            content: currentSystemMessage,
            round: round + 1,
            agent: 'GoalConversationAgent',
            timestamp: new Date().toISOString()
          });
          
          // 实时保存（AI消息）
          await saveDialogueRealtime(messages);
          
          logger.info(`GoalConversationAgent回复:`, {
            response: currentSystemMessage.substring(0, 100)
          });

          // 短暂等待
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // 统计
      const userCount = messages.filter((m: any) => m.role === 'user').length;
      const aiCount = messages.filter((m: any) => m.role === 'assistant').length;

      // 保存对话 (使用 upsert 避免重复创建)
      const savedDialogue = await prisma.arena_dialogues.upsert({
        where: { sessionId },
        update: {
          messages: JSON.stringify(messages),
          messageCount: messages.length,
          userMessageCount: userCount,
          aiMessageCount: aiCount,
          generationTimeMs: Date.now() - startTime,
          agentName: 'DialogAgent'
        },
        create: {
          id: uuidv4(),
          sessionId,
          messages: JSON.stringify(messages),
          messageCount: messages.length,
          userMessageCount: userCount,
          aiMessageCount: aiCount,
          generationTimeMs: Date.now() - startTime,
          agentName: 'DialogAgent'
        }
      });

      await this.updateAgentLog(log.id, {
        status: 'success',
        endTime: new Date(),
        durationMs: Date.now() - startTime,
        output: JSON.stringify(messages),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      });

      return { success: true, data: savedDialogue };
    } catch (error: any) {
      logger.error('DialogAgent failed:', error);
      throw error;
    }
  }

  // ==================== 3. 产出Agent ====================
  async runExtractAgent(sessionId: string) {
    const startTime = Date.now();
    
    try {
      const log = await this.createAgentLog(sessionId, 'ExtractAgent', 'extraction');
      
      // 获取对话
      const dialogue = await prisma.arena_dialogues.findUnique({
        where: { sessionId }
      });
      
      if (!dialogue) {
        throw new Error('No dialogue found');
      }

      const messages = JSON.parse(dialogue.messages);

      // 提取需求 - 使用思维启发式Prompt
      const context = {
        recentMessages: messages.slice(-10),
        dialogueHistory: JSON.stringify(messages, null, 2)
      };

      const response = await aiService.chat([
        { role: 'system', content: EXTRACT_AGENT_SYSTEM_PROMPT },
        { role: 'user', content: `请从以下对话中提取学习需求（思维启发式模式）：\n\n${JSON.stringify(context, null, 2)}` }
      ], { 
        temperature: EXTRACT_AGENT_CONFIG.temperature, 
        maxTokens: EXTRACT_AGENT_CONFIG.maxTokens,
        agentId: 'extract-agent',
        userId: 'arena-system'
      });

      const extraction = this.parseAIResponse(response.content);

      // 使用DataMappingAgent进行智能数据映射
      let mappedExtraction = extraction;
      try {
        const mappingResult = await dataMappingAgent.mapExtraction(extraction);
        if (mappingResult.success) {
          mappedExtraction = mappingResult.internal;
          logger.info('ExtractAgent数据映射成功', {
            mappedFields: Object.keys(mappedExtraction),
            warnings: mappingResult.warnings
          });
        } else {
          logger.warn('ExtractAgent数据映射失败，使用原始数据', {
            errors: mappingResult.errors
          });
        }
      } catch (e) {
        logger.error('DataMappingAgent调用失败', e);
      }

      // 转换 stages 为字符串（数据库 totalWeeks 是 String 类型）
      const totalWeeksStr = mappedExtraction.totalWeeks ? String(mappedExtraction.totalWeeks) : '3-5';

      // 保存提取结果 (使用 upsert 避免重复创建)
      const savedExtraction = await prisma.arena_extractions.upsert({
        where: { sessionId },
        update: {
          content: JSON.stringify(mappedExtraction),
          surfaceGoal: mappedExtraction.surfaceGoal || extraction.surfaceGoal,
          realProblem: mappedExtraction.realProblem || extraction.realProblem,
          level: mappedExtraction.level || extraction.level,
          timePerDay: mappedExtraction.timePerDay || extraction.timePerDay,
          totalWeeks: totalWeeksStr,
          motivation: mappedExtraction.motivation || extraction.motivation,
          urgency: mappedExtraction.urgency || extraction.urgency,
          completenessScore: mappedExtraction.completenessScore || 0,
          missingFields: JSON.stringify(mappedExtraction.missingFields || []),
          followUpQuestions: JSON.stringify(mappedExtraction.followUpQuestions || []),
          generationTimeMs: Date.now() - startTime,
          agentName: 'ExtractAgent'
        },
        create: {
          id: uuidv4(),
          sessionId,
          content: JSON.stringify(mappedExtraction),
          surfaceGoal: mappedExtraction.surfaceGoal || extraction.surfaceGoal,
          realProblem: mappedExtraction.realProblem || extraction.realProblem,
          level: mappedExtraction.level || extraction.level,
          timePerDay: mappedExtraction.timePerDay || extraction.timePerDay,
          totalWeeks: totalWeeksStr,
          motivation: mappedExtraction.motivation || extraction.motivation,
          urgency: mappedExtraction.urgency || extraction.urgency,
          completenessScore: mappedExtraction.completenessScore || 0,
          missingFields: JSON.stringify(mappedExtraction.missingFields || []),
          followUpQuestions: JSON.stringify(mappedExtraction.followUpQuestions || []),
          generationTimeMs: Date.now() - startTime,
          agentName: 'ExtractAgent'
        }
      });

      await this.updateAgentLog(log.id, {
        status: 'success',
        endTime: new Date(),
        durationMs: Date.now() - startTime,
        output: JSON.stringify(extraction),
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
        totalTokens: response.usage?.totalTokens || 0
      });

      return { success: true, data: savedExtraction };
    } catch (error: any) {
      logger.error('ExtractAgent failed:', error);
      throw error;
    }
  }

  // ==================== 4. 生成Agent ====================
  async runGenerateAgent(sessionId: string) {
    const startTime = Date.now();
    
    try {
      const log = await this.createAgentLog(sessionId, 'GenerateAgent', 'generation');
      
      // 获取提取的需求
      const extraction = await prisma.arena_extractions.findUnique({
        where: { sessionId }
      });
      
      if (!extraction) {
        throw new Error('No extraction found');
      }

      // 生成方案 - 使用思维启发式配置
      // 从ExtractAgent提取的数据中获取认知维度信息
      let extractionContent: any = {};
      try {
        extractionContent = JSON.parse(extraction.content || '{}');
      } catch { extractionContent = {}; }

      // 构建增强的需求描述，包含认知维度（带默认值）
      const enrichedRequirement = {
        basicInfo: {
          surfaceGoal: extractionContent.surfaceGoal || '',
          realProblem: extractionContent.realProblem || '',
          level: extractionContent.level || '入门',
          timePerDay: extractionContent.timePerDay || '1-2小时'
        },
        cognitiveDimensions: {
          realScenario: extractionContent.realScenario || { context: '', frequency: '', duration: '', currentSolution: '', biggestPain: '' },
          thinkingBlocks: extractionContent.thinkingBlocks || [],
          analogyMaterials: extractionContent.analogyMaterials || { work: [], hobbies: [], priorSkills: [] },
          successPatterns: extractionContent.successPatterns || { bestLearningContext: '', motivationTriggers: [] }
        },
        thinkingInspiredMetrics: extractionContent.thinkingInspiredMetrics || { scenarioSpecificity: 0, analogyRichness: 0, thinkingBlockClarity: 0, overallThinkingScore: 0 }
      };
      
      const userPrompt = `请基于以下需求生成思维启发式学习路径：

${JSON.stringify(enrichedRequirement, null, 2)}

【关键要求】
1. 从 realScenario 出发设计任务（不是从知识点出发）
2. 使用 analogyMaterials 中的素材设计类比
3. 针对 thinkingBlocks 设计突破卡点的任务
4. 遵循 5 个认知层次：觉察 → 连接 → 尝试 → 扩展 → 创造`;

      const response = await aiService.chat([
        { role: 'system', content: GENERATE_AGENT_CONFIG.systemPrompt },
        { role: 'user', content: userPrompt }
      ], { 
        temperature: GENERATE_AGENT_CONFIG.temperature, 
        maxTokens: GENERATE_AGENT_CONFIG.maxTokens,
        agentId: 'generate-agent',
        userId: 'arena-system'
      });

      const generation = this.parseAIResponse(response.content);

      // 验证和修正任务类型
      const VALID_TASK_TYPES = ['scene_awareness', 'analogy_discovery', 'problem_guided', 'transfer_application', 'reflection_summary'];

      if (generation.suggestedMilestones && Array.isArray(generation.suggestedMilestones)) {
        generation.suggestedMilestones.forEach((milestone: any) => {
          if (milestone.tasks && Array.isArray(milestone.tasks)) {
            milestone.tasks.forEach((task: any) => {
              if (!VALID_TASK_TYPES.includes(task.type)) {
                logger.warn('非法任务类型，修正为problem_guided', { type: task.type });
                task.type = 'problem_guided';
              }
            });
          }
        });
      }

      // 保存 - 适配 suggestedMilestones 格式
      const milestones = generation.suggestedMilestones || [];
      const totalTasks = milestones.reduce((sum: number, m: any) => sum + (m.tasks?.length || 0), 0);
      
      const savedGeneration = await prisma.arena_generations.upsert({
        where: { sessionId },
        update: {
          proposalContent: JSON.stringify({
            pathName: generation.pathName,
            subject: generation.subject,
            totalStages: generation.totalStages
          }),
          pathContent: JSON.stringify(generation),
          totalWeeks: milestones.length,
          totalTasks: totalTasks,
          generationTimeMs: Date.now() - startTime,
          agentName: 'GenerateAgent'
        },
        create: {
          id: uuidv4(),
          sessionId,
          proposalContent: JSON.stringify({
            pathName: generation.pathName,
            subject: generation.subject,
            totalStages: generation.totalStages
          }),
          pathContent: JSON.stringify(generation),
          totalWeeks: milestones.length,
          totalTasks: totalTasks,
          generationTimeMs: Date.now() - startTime,
          agentName: 'GenerateAgent'
        }
      });

      await this.updateAgentLog(log.id, {
        status: 'success',
        endTime: new Date(),
        durationMs: Date.now() - startTime,
        output: JSON.stringify(generation),
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
        totalTokens: response.usage?.totalTokens || 0
      });

      return { success: true, data: savedGeneration };
    } catch (error: any) {
      logger.error('GenerateAgent failed:', error);
      throw error;
    }
  }

  // ==================== 5. 评判Agent ====================
  async runEvaluateAgent(sessionId: string) {
    const startTime = Date.now();
    
    try {
      const log = await this.createAgentLog(sessionId, 'EvaluateAgent', 'evaluation');
      
      // 获取所有数据
      const [persona, dialogue, extraction, generation] = await Promise.all([
        prisma.arena_personas.findUnique({ where: { sessionId } }),
        prisma.arena_dialogues.findUnique({ where: { sessionId } }),
        prisma.arena_extractions.findUnique({ where: { sessionId } }),
        prisma.arena_generations.findUnique({ where: { sessionId } })
      ]);

      // 解析内容
      let personaContent: any = {};
      let dialogueMessages: any[] = [];
      let extractionContent: any = {};
      let pathContent: any = {};
      
      try {
        personaContent = persona?.content ? JSON.parse(persona.content) : {};
      } catch { personaContent = {}; }
      
      try {
        dialogueMessages = dialogue?.messages ? JSON.parse(dialogue.messages) : [];
      } catch { dialogueMessages = []; }
      
      try {
        extractionContent = extraction?.content ? JSON.parse(extraction.content) : {};
      } catch { extractionContent = {}; }
      
      try {
        pathContent = generation?.pathContent ? JSON.parse(generation.pathContent) : {};
      } catch { pathContent = {}; }

      // 构建完整输入
      const systemPrompt = `你是质量评判专家。
请评判以下学习规划流程的质量。

## 1. 用户画像
${JSON.stringify(personaContent, null, 2)}

## 2. 对话记录 (${dialogueMessages.length} 轮)
${dialogueMessages.slice(0, 10).map((m: any, i: number) => 
  `[${i+1}] ${m.role === 'user' ? '用户' : 'AI'}: ${m.content?.substring(0, 200)}...`
).join('\n')}

## 3. 需求提取结果
${JSON.stringify(extractionContent, null, 2)}
完整度：${extraction?.completenessScore || 0}%

## 4. 生成的学习路径
${JSON.stringify(pathContent, null, 2)}
阶段数：${pathContent?.stages?.length || 0}

---
请根据以上完整数据，评判整个流程的质量。

输出格式：
{
  "overallScore": 85,
  "dimensionScores": {
    "persona": 90,
    "dialogue": 85,
    "extraction": 80,
    "proposal": 85,
    "path": 88
  },
  "report": {
    "strengths": ["优点1", "优点2"],
    "weaknesses": ["不足1", "不足2"],
    "issues": ["关键问题"]
  },
  "suggestions": [
    {"aspect": "对话策略", "suggestion": "具体建议"}
  ]
}`;

      const response = await aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请评判质量' }
      ], { 
        temperature: 0.3, 
        maxTokens: 2000,
        agentId: 'evaluate-agent',
        userId: 'arena-system'
      });

      let evaluation: any = {};
      try {
        evaluation = JSON.parse(response.content);
      } catch {
        evaluation = { rawContent: response.content };
      }

      // 保存评判 (使用 upsert 避免重复创建)
      const savedEvaluation = await prisma.arena_evaluations.upsert({
        where: { sessionId },
        update: {
          overallScore: evaluation.overallScore || 0,
          personaScore: evaluation.dimensionScores?.persona || 0,
          dialogueScore: evaluation.dimensionScores?.dialogue || 0,
          extractionScore: evaluation.dimensionScores?.extraction || 0,
          proposalScore: evaluation.dimensionScores?.proposal || 0,
          pathScore: evaluation.dimensionScores?.path || 0,
          report: JSON.stringify(evaluation.report || {}),
          suggestions: JSON.stringify(evaluation.suggestions || []),
          generationTimeMs: Date.now() - startTime,
          agentName: 'EvaluateAgent'
        },
        create: {
          id: uuidv4(),
          sessionId,
          overallScore: evaluation.overallScore || 0,
          personaScore: evaluation.dimensionScores?.persona || 0,
          dialogueScore: evaluation.dimensionScores?.dialogue || 0,
          extractionScore: evaluation.dimensionScores?.extraction || 0,
          proposalScore: evaluation.dimensionScores?.proposal || 0,
          pathScore: evaluation.dimensionScores?.path || 0,
          report: JSON.stringify(evaluation.report || {}),
          suggestions: JSON.stringify(evaluation.suggestions || []),
          generationTimeMs: Date.now() - startTime,
          agentName: 'EvaluateAgent'
        }
      });

      await this.updateAgentLog(log.id, {
        status: 'success',
        endTime: new Date(),
        durationMs: Date.now() - startTime,
        output: JSON.stringify(evaluation),
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
        totalTokens: response.usage?.totalTokens || 0
      });

      return { success: true, data: savedEvaluation };
    } catch (error: any) {
      logger.error('EvaluateAgent failed:', error);
      throw error;
    }
  }

  // ==================== 6. 调整Agent ====================
  async runOptimizeAgent(sessionId: string) {
    const startTime = Date.now();
    
    try {
      const log = await this.createAgentLog(sessionId, 'OptimizeAgent', 'optimization');
      
      // 获取评判结果
      const evaluation = await prisma.arena_evaluations.findUnique({
        where: { sessionId }
      });

      if (!evaluation) {
        throw new Error('No evaluation found');
      }

      const suggestions = JSON.parse(evaluation.suggestions || '[]');

      // 生成优化建议
      const systemPrompt = `你是Prompt优化专家。
根据评判结果，优化各Agent的Prompt。

评判建议：${JSON.stringify(suggestions)}

输出格式：
{
  "suggestions": [
    {"agent": "DialogAgent", "issue": "问题", "solution": "解决方案"}
  ],
  "optimizedPrompts": {
    "DialogAgent": "优化后的system prompt",
    "ExtractAgent": "优化后的system prompt"
  },
  "expectedImprovement": {
    "extractionScore": "预期提升5-10分",
    "completeness": "预期周期询问率提升到90%"
  }
}`;

      const response = await aiService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请生成优化方案' }
      ], { 
        temperature: 0.5, 
        maxTokens: 2500,
        agentId: 'optimize-agent',
        userId: 'arena-system'
      });

      let optimization: any = {};
      try {
        optimization = JSON.parse(response.content);
      } catch {
        optimization = { rawContent: response.content };
      }

      // 保存优化 (使用 upsert 避免重复创建)
      const savedOptimization = await prisma.arena_optimizations.upsert({
        where: { sessionId },
        update: {
          suggestions: JSON.stringify(optimization.suggestions || []),
          optimizedPrompts: JSON.stringify(optimization.optimizedPrompts || {}),
          expectedImprovement: JSON.stringify(optimization.expectedImprovement || {}),
          generationTimeMs: Date.now() - startTime,
          agentName: 'OptimizeAgent'
        },
        create: {
          id: uuidv4(),
          sessionId,
          suggestions: JSON.stringify(optimization.suggestions || []),
          optimizedPrompts: JSON.stringify(optimization.optimizedPrompts || {}),
          expectedImprovement: JSON.stringify(optimization.expectedImprovement || {}),
          generationTimeMs: Date.now() - startTime,
          agentName: 'OptimizeAgent'
        }
      });

      await this.updateAgentLog(log.id, {
        status: 'success',
        endTime: new Date(),
        durationMs: Date.now() - startTime,
        output: JSON.stringify(optimization),
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
        totalTokens: response.usage?.totalTokens || 0
      });

      return { success: true, data: savedOptimization };
    } catch (error: any) {
      logger.error('OptimizeAgent failed:', error);
      throw error;
    }
  }

  // ==================== 辅助方法 ====================
  
  private async createAgentLog(sessionId: string, agentName: string, agentType: string) {
    return await prisma.arena_agent_logs.create({
      data: {
        id: uuidv4(),
        sessionId,
        agentName,
        agentType,
        status: 'running',
        startTime: new Date()
      }
    });
  }

  private async updateAgentLog(logId: string, data: any) {
    return await prisma.arena_agent_logs.update({
      where: { id: logId },
      data
    });
  }

  // ==================== 运行完整流程 ====================
  async runFullSession(sessionId: string, config?: any) {
    const results: any = {};
    
    try {
      // 1. 画像Agent
      results.persona = await this.runPersonaAgent(sessionId, config);
      
      // 2. 对话Agent
      results.dialogue = await this.runDialogAgent(sessionId);
      
      // 3. 产出Agent
      results.extraction = await this.runExtractAgent(sessionId);
      
      // 4. 生成Agent
      results.generation = await this.runGenerateAgent(sessionId);
      
      // 5. 评判Agent
      results.evaluation = await this.runEvaluateAgent(sessionId);
      
      // 6. 调整Agent
      results.optimization = await this.runOptimizeAgent(sessionId);
      
      // 更新会话状态
      await prisma.arena_sessions.update({
        where: { id: sessionId },
        data: { status: 'completed' }
      });
      
      return { success: true, results };
    } catch (error: any) {
      // 更新会话状态为失败
      await prisma.arena_sessions.update({
        where: { id: sessionId },
        data: { status: 'failed' }
      });
      
      throw error;
    }
  }
}

export default new ArenaService();
