// 对话式学习目标收集服务 - 问题穿透模式 V2
// 核心理念：穿透表象，找到真问题，渐进式收集信息
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { runGoalConversationAgent } from '../../agents/goal-conversation-agent';
import { agentConfigService, PromptConfig } from '../agentConfig.service';

/**
 * 问题穿透对话系统设计 V2：
 *
 * 1. 角色定位：学习规划顾问（规划"学什么"），不是咨询师（告诉"怎么做"）
 * 2. 问题穿透：用户说的不是真正的问题，要找到真问题
 * 3. 渐进收集：五维度信息分阶段收集，每次只问1-2个问题
 * 4. 用户参与：方案轮廓先确认，再生成详细路径
 */
class GoalConversationService {

  // 默认系统提示词 - 问题穿透模式 V2
  private readonly DEFAULT_SYSTEM_PROMPT = `你是学习规划顾问"小智"。

══════════════════════════════════════════════════════════════
【角色定位 - 极其重要】
══════════════════════════════════════════════════════════════

你是【学习规划顾问】，不是：
❌ 咨询师：直接告诉用户"怎么做生意/怎么解决问题"
❌ 教练：教用户具体技能
❌ 知识问答：回答各种知识问题

✅ 你的职责：
- 帮用户理清"真正想学什么"
- 收集学习规划所需的信息
- 设计"学习路径"，不是"解决方案"

例子：
用户："我想提升餐饮店营业额"
❌ 错误：你应该提高翻台率，方法有...（这是咨询师）
✅ 正确：你想通过学什么来解决这个问题？数据分析？运营方法？（这是学习规划顾问）

══════════════════════════════════════════════════════════════
【问题穿透 - 核心理念】
══════════════════════════════════════════════════════════════

用户说"我要学X"，X往往不是真正的问题。

例子：
- "我想学Python" → 真问题："自动化Excel报表"
- "我想学英语" → 真问题："下个月外企面试"
- "我想学剪辑" → 真问题："做自媒体副业"

你的任务：穿透表象，找到真问题，设计学习路径。

══════════════════════════════════════════════════════════════
【问题穿透 - 判断规则】
══════════════════════════════════════════════════════════════

用户输入判断优先级：
1. 如果用户已说出具体应用场景（如"自动化Excel报表"、"做数据分析"）：
   → 这就是"真问题"，直接确认，不要追问
   → 示例："我想用Python处理Excel" → real_problem="自动化Excel处理"

2. 如果用户说"不知道"、"听说好"：
   → 基于上下文推断真问题
   → 主动提出假设并确认
   → 示例："我不知道，都说Python好" + 上下文"Excel处理"
     → 推断 real_problem="自动化Excel处理"
     → 回复："听起来你真正想要的是【自动化Excel处理】，Python只是工具，对吗？"

3. 如果用户只说"我想学X"，没有具体场景：
   → 追问"用来做什么？具体场景是什么？"

══════════════════════════════════════════════════════════════
【关键原则】
══════════════════════════════════════════════════════════════

不要机械地按阶段问预设问题！
- 用户已经告诉你的，不要重复问
- 用户说不知道的，帮他推断
- 主动确认你的理解，而不是被动收集

══════════════════════════════════════════════════════════════
【五维度信息收集 - 渐进式】
══════════════════════════════════════════════════════════════

必须收集的信息（但不要一次性问完！）：

┌──────────────┬────────────────────────────────┬─────────────┐
│ 维度         │ 目的                           │ 何时收集     │
├──────────────┼────────────────────────────────┼─────────────┤
│ 1.真问题     │ 知道真正要学什么               │ 第一阶段     │
│ 2.基础水平   │ 确定起跑线                     │ 第二阶段     │
│ 3.可用时间   │ 合理规划进度                   │ 第二阶段     │
│ 4.学习风格   │ 调整内容呈现方式               │ 第三阶段     │
│ 5.特殊约束   │ 排除不适合的内容               │ 第三阶段     │
└──────────────┴────────────────────────────────┴─────────────┘

收集原则：
- 每次只问1-2个相关问题
- 自然融入对话，不要像审问
- 用户没说的，不要自己填

══════════════════════════════════════════════════════════════
【对话阶段】
══════════════════════════════════════════════════════════════

阶段1 - 问题穿透 + 认知探索 (confidence 0.1-0.3)
目标：找到真问题 + 了解认知特点
问：
• 用来做什么？为什么想学？具体场景是什么？（真问题）
• 你觉得这个领域最让你困惑的是什么？（认知探测 - 看元认知水平）
• 你之前接触过相关内容吗？如果有，是怎么学的？（思维风格探测）
• 是什么让你决定现在开始学？（动机触发点 - 简短）

示例对话：

用户: "我想用Python自动化处理Excel报表"
AI判断: 用户已说出具体场景"自动化Excel报表"
回复: "明白了！你的需求是【自动化Excel报表处理】。你目前Excel用得怎么样？有没有用过公式或VBA？"
JSON: { "surface_goal": "学Python", "real_problem": "自动化Excel报表处理", "confidence": 0.4 }

用户: "我不知道，就是都说Python好"
AI判断: 用户说不知道，但上下文提到"Excel处理"
回复: "听起来你真正想要的是【自动化处理Excel】，Python只是工具之一。对吗？确认后我来规划学习路径。"
JSON: { "surface_goal": "学Python", "real_problem": "自动化Excel处理（推断）", "confidence": 0.5 }

阶段2 - 基础&时间 (confidence 0.3-0.5)
目标：了解起点和约束
问：目前什么水平？每天/周能学多久？期望多久完成？

阶段3 - 风格&偏好 (confidence 0.5-0.7)
目标：了解学习方式
问：喜欢视频/阅读/动手练？理论优先还是实践优先？

阶段4 - 方案轮廓 (confidence 0.7-0.8)
目标：让用户确认方向
输出：学习方向和阶段划分（不是详细计划！）
问：你觉得这个方向对吗？有什么要调整的？

阶段5 - 生成路径 (confidence 0.8+)
目标：生成详细学习路径
条件：用户确认方向后
输出：完整的学习路径

══════════════════════════════════════════════════════════════
【回复格式 - 两段式输出】
══════════════════════════════════════════════════════════════

第一段：自然对话回复（用户看到的）
- 直接输出你的回复，像正常对话一样
- 使用自然、友好的语气
- 可以使用emoji和格式化（如加粗、列表）

第二段：结构化数据（后端解析用，JSON格式）
\`\`\`json
{
  "understanding": {
    "surface_goal": "用户说的目标",
    "real_problem": "真正要解决的问题",
    "motivation": "为什么想学",
    "urgency": "高/中/低",
    "background": {
      "current_level": "当前水平",
      "available_time": "可用时间",
      "constraints": ["约束1"],
      "strengths": ["优势1"],
      "deadline": "截止日期（如2026-12-28）",
      "deadline_text": "原始时间描述（如9个月后考试）"
    },
    "learning_style": {
      "preferred_format": "视频/阅读/动手/混合",
      "theory_vs_practice": "理论优先/实践优先/平衡",
      "study_rhythm": "集中突击/分散细水长流"
    },
    "cognitive_profile": {
      "metacognition_level": "高/中/低",
      "thinking_style": "直觉型/逻辑型/视觉型/实践型/混合型",
      "prior_knowledge_structure": "零散/体系化/空白",
      "confusion_pattern": "概念混淆/应用困难/原理不理解/无",
      "self_assessment_accuracy": "偏高/准确/偏低"
    },
    "emotional_profile": {
      "motivation_trigger": "兴趣驱动/问题解决/外部压力/职业发展",
      "urgency_level": "高/中/低",
      "confidence_level": "自信/中等/焦虑"
    }
  },
  "stage": "understanding/proposing/ready",
  "confidence": 0.5,
  "next_questions": ["还想确认的问题"]
}
\`\`\`

【stage说明】
- understanding: 还在收集信息
- proposing: 给出方案轮廓让用户确认
- ready: 用户确认方向，可以生成详细路径

══════════════════════════════════════════════════════════════
【关键原则】
══════════════════════════════════════════════════════════════

1. ⚠️ 不要直接给完整方案！先给轮廓让用户确认
   - proposing 阶段的 response 只能包含：方向、大致阶段划分（不要具体周数）、学习方式
   - 严禁输出：详细时间安排、具体每周学什么、详细的任务列表
   - 用户确认后（ready 阶段），系统会自动生成详细路径

2. ⚠️ 不要变成咨询师！你的任务是规划"学习路径"
3. 每次只问1-2个问题，不要轰炸
4. 用户没说的信息，不要自己编造
5. 发现预期不合理时，诚实指出
6. 发现用户有相关背景时，强调迁移优势
7. ⚠️ 时间约束处理：
   - 用户说"9个月后考试"、"下周面试"等时间表达时，必须提取到 background.deadline 和 background.deadline_text
   - deadline 计算为具体日期（基于当前时间推算）
   - deadline_text 保存原始表达（如"9个月后考试"）

══════════════════════════════════════════════════════════════
【示例对话】
══════════════════════════════════════════════════════════════

用户: "我想学Python"
阶段1 - 问题穿透 + 认知探索
回复: {
  "response": "Python是个好工具！\n\n先了解一下：你学Python想用来做什么呢？（数据分析、网站开发、还是自动化工作？）\n\n另外，你觉得编程最让你困惑的是什么？是语法记不住，还是不知道从哪里开始？",
  "understanding": {
    "surface_goal": "Python编程",
    "cognitive_profile": {"confusion_pattern": "待收集"}
  },
  "stage": "understanding",
  "confidence": 0.1,
  "next_questions": ["应用场景", "认知困惑点"]
}

用户: "我想学商务英语写作。我最近在做独立开发，需要写全英文的产品文案、冷启动邮件和客服回复"
注意：用户已经说明了目标和场景，直接回应并追问基础/时间
回复: {
  "response": "独立开发者需要自己搞定英文写作，确实是个实际挑战。你的目标很清晰：产品文案、Cold Email、客服回复。\\n\\n想了解一下：你目前的英语水平怎么样？日常读写感觉吃力吗？",
  "understanding": {
    "surface_goal": "商务英语写作",
    "real_problem": "独立开发的英文文案和沟通",
    "motivation": "工作需要",
    "background": {"constraints": ["独立开发场景"]}
  },
  "stage": "understanding",
  "confidence": 0.25,
  "next_questions": ["英语水平", "可用学习时间"]
}

用户: "工作有很多Excel要处理，想自动化"
回复: {
  "response": "明白了！你的真问题不是'学Python'，而是【自动化Excel处理】。这更精准。\\n\\n几个问题帮你理清：\\n1. 你目前Excel水平怎么样？会用公式吗？\\n2. 你觉得学编程最担心的是什么？怕自己逻辑不好，还是没时间？\\n3. 是什么让你决定现在开始学，是最近工作积压太多了吗？",
  "understanding": {
    "surface_goal": "Python编程",
    "real_problem": "自动化Excel报表处理",
    "motivation": "工作效率",
    "emotional_profile": {"motivation_trigger": "问题解决", "urgency_level": "待确认"}
  },
  "stage": "understanding",
  "confidence": 0.3,
  "next_questions": ["Excel水平", "认知担忧", "紧迫感"]
}

用户: "会sum、vlookup，每天能学20分钟"
回复: {
  "response": "有基础很好！每天20分钟的话，咱们可以走'轻代码'路线——不用深学Python，重点学pandas处理表格就够了。\\n\\n你平时更喜欢看视频教程，还是边做边学？",
  "understanding": {
    "real_problem": "自动化Excel报表处理",
    "motivation": "工作效率",
    "background": {
      "current_level": "Excel基础",
      "available_time": "每天20分钟"
    }
  },
  "stage": "understanding",
  "confidence": 0.5,
  "next_questions": ["学习风格偏好"]
}

用户: "喜欢边做边学"
阶段4 - 方案轮廓（不是详细计划！）
回复: {
  "response": "好，基于你的情况，我梳理了一个学习方向的轮廓：\\n\\n📌 学习方向：Excel自动化（轻代码路线）\\n\\n📌 大致阶段：\\n• 第一阶段：掌握基础语法和Excel操作\\n• 第二阶段：处理实际报表\\n• 第三阶段：自动化脚本\\n\\n📌 学习方式：边做边学，用你的实际表格练手\\n\\n这只是一个大致方向，确认后我会为你生成详细的每周计划。你觉得这个方向对吗？",
  "understanding": {..., "learning_style": {"preferred_format": "动手", "theory_vs_practice": "实践优先"}},
  "stage": "proposing",
  "confidence": 0.75,
  "next_questions": []
}

用户: "可以，就这样"
阶段5 - 生成路径
回复: {
  "response": "太好了！我来生成详细的学习路径...\\n\\n✅ 已为你生成完整的学习计划，可以去查看啦！",
  "stage": "ready",
  "confidence": 0.9
}`;

  /**
   * 开始新的对话会话（新格式：分离 userVisible 和 internal）
   */
  async startConversation(userId: string, initialGoal: string) {
    try {
      logger.info('开始问题穿透对话会话', { userId, initialGoal });

// 创建对话会话
      const conversation = await prisma.goal_conversations.create({
        data: {
          id: `gc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId,
          description: initialGoal,
          stage: 'understanding',
          messages: '[]', // 初始化为空 JSON 数组
          collectedData: JSON.stringify({
            messages: [],       // 对话历史
            collected: {},      // 已收集的信息
            understanding: {},  // 问题理解状态
            confidence: 0
          })
        }
      });

      // 让AI生成第一个回复
      const aiResponse = await this.callAI(conversation.id, initialGoal, true, userId);

      // 保存对话历史（保存 userVisible 内容）
      await this.saveMessage(conversation.id, 'user', initialGoal);
      await this.saveMessage(conversation.id, 'ai', aiResponse.userVisible);

      // 更新收集的数据
      await this.updateCollectedData(conversation.id, aiResponse);

      logger.info('对话会话创建成功', {
        conversationId: conversation.id,
        stage: aiResponse.internal.stage,
        confidence: aiResponse.internal.confidence
      });

      // 新格式返回：分离 userVisible 和 internal
      const internal: any = aiResponse.internal;
      return {
        userVisible: aiResponse.userVisible,
        internal: {
          conversationId: conversation.id,
          stage: internal.stage,
          understanding: internal.understanding || {},
          confidence: internal.confidence,
          quickReplies: internal.quickReplies,
          structuredData: internal.structuredData,
          confirmedProposal: internal.confirmedProposal,
          confidence_scores: internal.confidence_scores,
          isCompleted: internal.stage === 'ready'
        }
      };
    } catch (error) {
      logger.error('开始对话会话失败:', error);
      throw error;
    }
  }

  /**
   * 用户回复，推进对话（新格式：分离 userVisible 和 internal）
   */
async continueConversation(conversationId: string, userReply: string, userId: string) {
      try {
        // 获取当前对话状态
        const conversation = await prisma.goal_conversations.findFirst({
          where: { id: conversationId, userId }
        });

        if (!conversation) {
          throw new Error('对话会话不存在');
        }

        // 如果已经完成，直接返回
        if (conversation.status === 'completed') {
          const data = JSON.parse(conversation.collectedData);
          let learningPath = null;
          
          // 查询学习路径状态
          if (conversation.learningPathId) {
            const path = await prisma.learning_paths.findFirst({
              where: { id: conversation.learningPathId }
            });
            if (path) {
              learningPath = {
                id: path.id,
                status: path.status
              };
            }
          }
          
          return {
            userVisible: '学习路径已经生成，可以去查看啦！',
            internal: {
              stage: 'completed',
              understanding: data.understanding || {},
              quickReplies: [],
              isCompleted: true,
              learningPath
            }
          };
        }

        // 确认意图硬规则：proposing 阶段 + 用户确认 -> 直接生成路径（不依赖模型）
        const confirmIntent = /^(好|好的|行|可以|是的|对|确认|就这样|没问题|开始生成|生成学习路径|可以生成)/i.test(userReply.trim());
        const adjustIntent = /(调整|修改|换个方向|再想想|先不要|不对)/.test(userReply);

        if (conversation.stage === 'proposing' && confirmIntent && !adjustIntent) {
          const data = JSON.parse(conversation.collectedData || '{}');
          const understanding = data.understanding || {};
          
          // 保存用户确认消息
          await this.saveMessage(conversation.id, 'user', userReply);

          try {
            const placeholderPath = await this.createGeneratingPlaceholderPath(conversation, { userVisible: '', internal: { understanding } });

            this.generateLearningPath({ ...conversation, learningPathId: placeholderPath.id }, { userVisible: '', internal: { understanding } })
              .then(() => {
                logger.info('硬规则触发：异步学习路径生成成功', { conversationId, pathId: placeholderPath.id });
              })
              .catch(async (pathError) => {
                logger.error('硬规则触发：异步学习路径生成失败', { conversationId, pathId: placeholderPath.id, error: String(pathError) });
                try {
                  await prisma.learning_paths.update({
                    where: { id: placeholderPath.id },
                    data: { status: 'failed', updatedAt: new Date() }
                  });
                } catch (e) {
                  logger.error('更新失败状态出错', e);
                }
              });

            await prisma.goal_conversations.update({
              where: { id: conversationId },
              data: {
                stage: 'completed',
                status: 'completed',
                completedAt: new Date(),
                learningPathId: placeholderPath.id
              }
            });

            return {
              userVisible: '已收到确认，学习路径正在生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。',
              internal: {
                stage: 'completed',
                understanding,
                confidence: 0.95,
                quickReplies: [],
                learningPath: { id: placeholderPath.id, status: 'generating' },
                isCompleted: true
              }
            };
          } catch (pathError) {
            logger.error('硬规则触发生成路径失败', pathError);
            throw pathError;
          }
        }

        // 保存用户消息
        await this.saveMessage(conversation.id, 'user', userReply);

      // 调用AI生成回复
      const aiResponse = await this.callAI(conversation.id, userReply, false, userId);

      // 保存AI回复（保存 userVisible 内容）
      await this.saveMessage(conversation.id, 'ai', aiResponse.userVisible);

      // 更新收集的数据
      await this.updateCollectedData(conversation.id, aiResponse);
      const internal: any = aiResponse.internal;

      // 如果对话完成，先生成学习路径
      if (internal.stage === 'ready') {
        try {
          const placeholderPath = await this.createGeneratingPlaceholderPath(conversation, aiResponse);

          this.generateLearningPath({ ...conversation, learningPathId: placeholderPath.id }, aiResponse)
            .then(() => {
              logger.info('异步学习路径生成成功', {
                conversationId,
                pathId: placeholderPath.id
              });
            })
            .catch(async (pathError) => {
              logger.error('异步学习路径生成失败', {
                conversationId,
                pathId: placeholderPath.id,
                error: (pathError as any)?.message || String(pathError)
              });

              try {
                await prisma.learning_paths.update({
                  where: { id: placeholderPath.id },
                  data: {
                    status: 'failed',
                    updatedAt: new Date()
                  }
                });
              } catch (updateError) {
                logger.error('更新占位路径失败状态失败', updateError);
              }
            });

          // 学习路径生成成功后，再更新状态
          await prisma.goal_conversations.update({
            where: { id: conversationId },
            data: {
              stage: 'completed',
              status: 'completed',
              completedAt: new Date(),
              learningPathId: placeholderPath.id
            }
          });

          // 新格式返回：completed 状态
          return {
            userVisible: `${aiResponse.userVisible}\n\n⏳ 学习路径已开始生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。`,
            internal: {
              stage: 'completed',
              understanding: internal.understanding || {},
              confidence: internal.confidence,
              quickReplies: internal.quickReplies || [],
              structuredData: internal.structuredData,
              confirmedProposal: internal.confirmedProposal,
              confidence_scores: internal.confidence_scores,
              learningPath: {
                id: placeholderPath.id,
                status: 'generating'
              },
              isCompleted: true
            }
          };
        } catch (pathError) {
          // 学习路径生成失败，返回错误但不标记完成
          logger.error('学习路径生成失败，对话仍保留在 proposing 状态', pathError);
          return {
            userVisible: '抱歉，生成学习路径时遇到了问题。请稍后重试，或者点击"重试"按钮。',
            internal: {
              stage: 'proposing',
              understanding: internal.understanding || {},
              confidence: internal.confidence,
              quickReplies: internal.quickReplies,
              structuredData: internal.structuredData,
              confirmedProposal: internal.confirmedProposal,
              confidence_scores: internal.confidence_scores,
              isCompleted: false,
              error: '学习路径生成失败，请重试'
            }
          };
        }
      }

      // 非完成状态，正常更新
      await prisma.goal_conversations.update({
        where: { id: conversationId },
        data: {
          stage: aiResponse.internal.stage,
          status: 'active'
        }
      });

      // 新格式返回：正常对话状态
      return {
        userVisible: aiResponse.userVisible,
        internal: {
          stage: internal.stage,
          understanding: internal.understanding || {},
          confidence: internal.confidence,
          quickReplies: internal.quickReplies,
          structuredData: internal.structuredData,
          confirmedProposal: internal.confirmedProposal,
          confidence_scores: internal.confidence_scores,
          isCompleted: false
        }
      };

    } catch (error) {
      logger.error('继续对话失败:', error);
      throw error;
    }
  }

  private async createGeneratingPlaceholderPath(conversation: any, aiResponse: any) {
    const understanding = aiResponse.internal.understanding || {};
    const realGoal = understanding.real_problem || conversation.description;
    const subject = this.inferSubject(realGoal);
    const title = realGoal && String(realGoal).trim()
      ? `${String(realGoal).trim().slice(0, 28)}学习路径`
      : '个性化学习路径';

    return prisma.learning_paths.create({
      data: {
        id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        userId: conversation.userId,
        title,
        name: title,
        description: realGoal,
        subject,
        status: 'generating',
        difficulty: 'beginner',
        estimatedHours: 0,
        aiGenerated: true,
        updatedAt: new Date()
      }
    });
  }

  /**
   * 从数据库获取系统 Prompt 配置
   */
  private async getSystemPromptConfig(): Promise<{ config: PromptConfig | null; prompt: string }> {
    const config =
      await agentConfigService.getActivePrompt('goal-conversation-agent')
      || await agentConfigService.getActivePrompt('goal-conversation');
    if (config) {
      return { config, prompt: config.systemPrompt };
    }
    // 回退到默认
    return { config: null, prompt: this.DEFAULT_SYSTEM_PROMPT };
  }

  /**
   * 调用AI生成回复
   */
  private async callAI(conversationId: string, userInput: string, isFirst: boolean, userId?: string) {
    const startTime = Date.now();
    let config: PromptConfig | null = null;

    try {
      // 获取对话历史
      const conversation = await prisma.goal_conversations.findUnique({
        where: { id: conversationId }
      });

      const data = JSON.parse(conversation.collectedData);
      const history = data.messages || [];
      const previousUnderstanding = data.understanding || {};

      const recentHistory = history.slice(-20);

      // 从数据库获取 Prompt 配置（用于记录版本信息）
      const { config: promptConfig } = await this.getSystemPromptConfig();
      config = promptConfig;

      // 调用专用 GoalConversationAgent
      const aiResponse = await runGoalConversationAgent({
        input: userInput,
        userId: userId || 'anonymous',
        conversationHistory: recentHistory.map((msg: any) => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })),
        previousUnderstanding,
        previousStage: data.stage || conversation.stage
      });

      logger.info('AI响应', {
        stage: aiResponse.internal.stage,
        confidence: aiResponse.internal.confidence,
        responseLength: aiResponse.userVisible.length,
        promptVersion: config?.version || 'default'
      });

      return aiResponse;

    } catch (error: any) {
      logger.error('AI调用失败:', error);
      // 降级回复（新格式）
      return {
        userVisible: '抱歉，我刚才走神了，能再说一遍吗？',
        internal: {
          understanding: {},
          confidence: 0,
          stage: 'understanding',
          nextQuestions: [],
          collected: {}
        }
      };
    }
  }

  /**
   * 修复不完整的 JSON（处理 AI 返回截断的情况）
   */
  private fixIncompleteJson(jsonStr: string): string {
    let fixed = jsonStr.trim();
    
    // 计算括号不匹配
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    
    // 补全缺失的闭合括号
    if (openBraces > closeBraces) {
      fixed += '}'.repeat(openBraces - closeBraces);
    }
    if (openBrackets > closeBrackets) {
      fixed += ']'.repeat(openBrackets - closeBrackets);
    }
    
    // 处理截断的字符串（未闭合的引号）
    const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      fixed += '"';
    }
    
    // 处理末尾的尾随逗号或冒号
    fixed = fixed.replace(/,\s*$/, '');
    fixed = fixed.replace(/:\s*$/, ': null');
    
    return fixed;
  }

  /**
   * 安全解析 JSON（带修复尝试）
   */
  private safeJsonParse(jsonStr: string): any {
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      // 尝试修复后重新解析
      const fixed = this.fixIncompleteJson(jsonStr);
      try {
        return JSON.parse(fixed);
      } catch (e2) {
        logger.warn('JSON 修复后仍无法解析', { original: jsonStr.substring(0, 200), fixed: fixed.substring(0, 200) });
        throw e;
      }
    }
  }

  /**
   * 解析AI响应 - 问题穿透模式 V2（新格式：分离 userVisible 和 internal）
   */
  private parseAIResponse(content: string): {
    userVisible: string;
    internal: {
      understanding: any;
      confidence: number;
      stage: string;
      nextQuestions: string[];
      collected: any;
    };
  } {
    try {
      // 尝试提取JSON部分（两段式输出：对话文本 + JSON）
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = this.safeJsonParse(jsonMatch[1]);

        // 提取对话文本（JSON之前的内容）
        const dialogueText = content.split('```json')[0].trim();

        // 新格式：understanding 字段
        const understanding = parsed.understanding || {};

        // 转换为 collected 格式
        const collected = {
          // 表面目标 vs 真问题
          surface_goal: understanding.surface_goal || null,
          real_problem: understanding.real_problem || null,

          // 动机
          motivation: understanding.motivation || null,
          urgency: understanding.urgency || null,

          // 背景
          background: understanding.background || {},

          // 学习风格 (新增)
          learning_style: understanding.learning_style || {},

          // 兼容旧字段
          goal: understanding.real_problem || understanding.surface_goal || null,
          level: understanding.background?.current_level || null,
          timePerDay: understanding.background?.available_time || null,

          // 还要确认的问题
          questions_to_ask: parsed.next_questions || []
        };

        // 验证 stage 值
        const validStages = ['understanding', 'proposing', 'ready'];
        let stage = parsed.stage || 'understanding';
        if (!validStages.includes(stage)) {
          stage = 'understanding';
        }

        return {
          userVisible: dialogueText || parsed.response || content,
          internal: {
            understanding,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
            stage,
            nextQuestions: parsed.next_questions || [],
            collected
          }
        };
      }
    } catch (e) {
      logger.warn('解析AI响应失败，使用原始内容', e);
    }

    // 如果不是JSON格式，直接作为回复内容
    const contentLower = content.toLowerCase();
    let stage = 'understanding';
    if (contentLower.includes('方案轮廓') || contentLower.includes('你觉得这个方向')) {
      stage = 'proposing';
    } else if (contentLower.includes('生成详细') || contentLower.includes('学习路径已生成')) {
      stage = 'ready';
    }

    return {
      userVisible: content,
      internal: {
        understanding: {},
        confidence: 0,
        stage,
        nextQuestions: [],
        collected: {}
      }
    };
  }

  /**
   * 保存消息到历史
   */
  private async saveMessage(conversationId: string, role: string, content: string) {
    const conversation = await prisma.goal_conversations.findUnique({
      where: { id: conversationId }
    });

    const data = JSON.parse(conversation.collectedData);
    data.messages = data.messages || [];
    data.messages.push({
      role,
      content,
      time: new Date().toISOString()
    });

    await prisma.goal_conversations.update({
      where: { id: conversationId },
      data: { collectedData: JSON.stringify(data) }
    });
  }

  /**
   * 更新收集的数据 - 问题穿透模式（新格式）
   */
  private async updateCollectedData(conversationId: string, aiResponse: {
    userVisible: string;
    internal: {
      understanding: any;
      confidence: number;
      stage: string;
      nextQuestions: string[];
      collected: any;
    };
  }) {
    const conversation = await prisma.goal_conversations.findUnique({
      where: { id: conversationId }
    });

    const data = JSON.parse(conversation.collectedData);

    // 合并已收集的信息（从 internal.collected）
    data.collected = { ...data.collected, ...aiResponse.internal.collected };
    data.confidence = aiResponse.internal.confidence;

    // 保存 understanding 供前端展示（从 internal.understanding）
    data.understanding = aiResponse.internal.understanding || data.understanding || {};

    // 保存 stage
    data.stage = aiResponse.internal.stage;

    // 保存待问问题（从 internal.nextQuestions）
    if (aiResponse.internal.nextQuestions) {
      data.questions_to_ask = aiResponse.internal.nextQuestions;
    }

    await prisma.goal_conversations.update({
      where: { id: conversationId },
      data: { collectedData: JSON.stringify(data) }
    });
  }

  /**
   * 生成学习路径 - 基于真问题（新格式：从 internal 读取数据）
   */
  private async generateLearningPath(conversation: any, aiResponse: any) {
    try {
      const data = JSON.parse(conversation.collectedData);
      const collected = data.collected || {};
      // 从新格式 internal.understanding 读取数据
      const understanding = aiResponse.internal.understanding || data.understanding || {};

      const learningService = require('../learning/learning.service').default;

// 提取核心字段（只保留路径生成实际使用的字段）
      const realGoal = understanding.real_problem || collected.real_problem || conversation.description;
      
      // 提取结构化数据（如果有）
      const structuredData = aiResponse.internal.structuredData || null;
      const confirmedProposal = aiResponse.internal.confirmedProposal || null;
      const confidenceScores = aiResponse.internal.confidence_scores || null;
      
      // 只提取 PathAgent 实际需要的 4 个核心字段
      const skillLevel = understanding.background?.current_level || collected.level || 'beginner';
      const availableTime = understanding.background?.available_time || collected.timePerDay || '1 小时';
      
      // 简化的时间处理（只解析日期，不做复杂推断）
      let deadline: Date | undefined;
      let deadlineText: string | undefined;
      
      const deadlineRaw = understanding.background?.deadline || collected.expected_time || understanding.background?.expected_time;
      if (deadlineRaw) {
        if (deadlineRaw instanceof Date) {
          deadline = deadlineRaw;
        } else if (typeof deadlineRaw === 'string') {
          // 尝试解析日期格式或相对时间
          if (/^\d{4}-\d{2}-\d{2}/.test(deadlineRaw)) {
            deadline = new Date(deadlineRaw);
          } else {
            const monthsMatch = deadlineRaw.match(/(\d+)\s*个？月/);
            const weeksMatch = deadlineRaw.match(/(\d+)\s*周/);
            if (monthsMatch) {
              deadline = new Date();
              deadline.setMonth(deadline.getMonth() + parseInt(monthsMatch[1]));
            } else if (weeksMatch) {
              deadline = new Date();
              deadline.setDate(deadline.getDate() + parseInt(weeksMatch[1]) * 7);
            }
          }
          deadlineText = deadlineRaw;
        }
      }
      
      // 显式使用 deadlineText 字段
      if (!deadlineText) {
        deadlineText = understanding.deadline_text || understanding.background?.deadline_text || collected.expected_time;
      }

      const learningPath = await learningService.generateLearningPath({
        userId: conversation.userId,
        sourceConversationId: conversation.id,
        existingPathId: conversation.learningPathId || undefined,
        description: realGoal,
        deadline,
        deadlineText,
        userProfile: {
          skillLevel,
          currentSkillLevel: skillLevel,
          timePerDay: availableTime,
          daysPerWeek: collected.daysPerWeek || 5,
          // 新增：传递完整数据包给 PathAgent
          structuredData,
          confirmedProposal,
          confidenceScores,
          conversationHistory: JSON.parse(conversation.messages || '[]')
        }
});

      logger.info('学习路径生成成功', {
        pathId: learningPath?.id,
        realProblem: understanding.real_problem,
        hasStructuredData: !!structuredData,
        learnerIdentity: structuredData?.learner?.identity
      });

      // 直接返回学习路径对象（不要包装，因为 continueConversation 已经会包装）
      return learningPath;

    } catch (error) {
      logger.error('生成学习路径失败:', error);
      throw error;
    }
  }

  /**
    * 推断学科
    */
   private inferSubject(goal: string): string {
    if (!goal) return '综合';
    
    const keywords = {
      '编程': ['python', 'java', 'javascript', 'vue', 'react', '编程', '代码', '开发', '自动化'],
      '英语': ['英语', 'english', '四级', '六级', '雅思', '托福', '口语', '日常交流'],
      '心理学': ['心理', '咨询', '阿德勒', '荣格', '弗洛伊德'],
      '数学': ['数学', '代数', '几何', '微积分', '函数', '方程'],
      '经济学': ['经济', '通胀', '利率', '财经', '金融', 'gdp', 'cpi', '货币'],
      '设计': ['设计', 'ui', 'ux', '平面', '产品']
    };

    const lowerGoal = goal.toLowerCase();
    for (const [subject, words] of Object.entries(keywords)) {
      if (words.some(w => lowerGoal.includes(w))) {
        return subject;
      }
    }
    return '综合';
  }

  /**
   * 重新生成学习路径（基于已完成的对话）
   */
  async regeneratePath(conversationId: string, userId: string, adjustments?: string) {
    try {
      logger.info('重新生成学习路径', { conversationId, userId, adjustments });

      const conversation = await prisma.goal_conversations.findFirst({
        where: { id: conversationId, userId }
      });

      if (!conversation) {
        throw new Error('对话会话不存在');
      }

      const data = JSON.parse(conversation.collectedData || '{}');
      const understanding = data.understanding || {};
      const collected = data.collected || {};

      // 如果有调整建议，更新 understanding
      if (adjustments) {
        understanding.adjustments = adjustments;
        understanding.adjusted_at = new Date().toISOString();
      }

      // 重置状态为 proposing，准备重新生成
      await prisma.goal_conversations.update({
        where: { id: conversationId },
        data: {
          stage: 'proposing',
          status: 'active',
          completedAt: null
        }
      });

      // 重新生成学习路径
      const learningPath = await this.generateLearningPath(conversation, {
        userVisible: '正在重新生成学习路径...',
        internal: {
          understanding,
          confidence: data.confidence || 0.8,
          stage: 'ready',
          nextQuestions: [],
          collected
        }
      });

      // 更新状态为完成
      await prisma.goal_conversations.update({
        where: { id: conversationId },
        data: {
          stage: 'completed',
          status: 'completed',
          completedAt: new Date(),
          learningPathId: learningPath?.id
        }
      });

      logger.info('学习路径重新生成成功', {
        conversationId,
        newPathId: learningPath?.id
      });

      return {
        userVisible: adjustments
          ? `已根据您的反馈重新生成学习路径！${adjustments}`
          : '已为您重新生成学习路径！',
        internal: {
          stage: 'completed',
          understanding,
          confidence: 0.9,
          learningPath,
          isCompleted: true
        }
      };
    } catch (error) {
      logger.error('重新生成学习路径失败:', error);
      throw error;
    }
  }

  /**
   * 删除/重置对话（允许用户重新开始）
   */
  async deleteConversation(conversationId: string, userId: string) {
    try {
      const conversation = await prisma.goal_conversations.findFirst({
        where: { id: conversationId, userId }
      });

      if (!conversation) {
        throw new Error('对话会话不存在');
      }

      // 删除对话记录
      await prisma.goal_conversations.delete({
        where: { id: conversationId }
      });

      logger.info('对话已删除', { conversationId, userId });

      return { success: true };
    } catch (error) {
      logger.error('删除对话失败:', error);
      throw error;
    }
  }

  /**
   * 获取对话会话详情
   */
  async getConversation(conversationId: string, userId: string) {
    const conversation = await prisma.goal_conversations.findFirst({
      where: { id: conversationId, userId }
    });

    if (!conversation) {
      throw new Error('对话会话不存在');
    }

    const data = JSON.parse(conversation.collectedData);

    return {
      id: conversation.id,
      description: conversation.description,
      stage: conversation.stage,
      status: conversation.status,
      messages: data.messages || [],
      collected: data.collected || {},
      understanding: data.understanding || {},
      confidence: data.confidence || 0,
      createdAt: conversation.createdAt,
      completedAt: conversation.completedAt
    };
  }

  /**
   * 快速生成学习路径（跳过对话，用于测试）- 新格式返回
   */
  async quickGeneratePath(userId: string, params: {
    goal: string;
    level: string;
    timePerDay: string;
    learningStyle: string;
  }) {
    logger.info('快速生成学习路径', { userId, params });

    // 构建模拟的 understanding 数据
    const understanding = {
      surface_goal: params.goal,
      real_problem: params.goal,
      motivation: '快速测试',
      urgency: '中',
      background: {
        current_level: params.level,
        available_time: params.timePerDay,
        constraints: [],
        strengths: []
      },
      learning_style: {
        preferred_format: params.learningStyle === 'project-based' ? '动手' : '混合',
        theory_vs_practice: params.learningStyle === 'project-based' ? '实践优先' : '理论与实践结合'
      }
    };

    // 创建一个模拟的 conversation 对象
    const mockConversation = {
      id: 'quick-test',
      userId,
      description: params.goal,
      collectedData: JSON.stringify({
        messages: [],
        collected: understanding,
        understanding
      })
    };

    // 直接调用生成学习路径（使用新格式）
    const pathResult = await this.generateLearningPath(mockConversation as any, {
      userVisible: '快速生成学习路径完成！',
      internal: {
        understanding,
        confidence: 0.9,
        stage: 'ready',
        nextQuestions: [],
        collected: understanding
      }
    });

    logger.info('快速生成学习路径成功', {
      pathId: pathResult?.id
    });

    // 新格式返回
    return {
      userVisible: `已为您快速生成学习路径「${pathResult?.name || '未命名'}」！`,
      internal: {
        learningPath: pathResult,
        understanding,
        confidence: 0.9
      }
    };
  }

}

export default new GoalConversationService();

/**
 * 从对话生成学习路径（供路由使用）- 新格式适配
 */
export async function generateLearningPathFromConversation(conversationId: string) {
  const conversation = await prisma.goal_conversations.findUnique({
    where: { id: conversationId },
    include: { users: true }
  });

  if (!conversation) {
    throw new Error('对话不存在');
  }

  const service = new GoalConversationService();
  const data = JSON.parse(conversation.collectedData);
  const collected = data.collected || {};
  const understanding = data.understanding || collected;

  // 使用真问题生成学习路径
  const realGoal = understanding.real_problem || collected.real_problem || conversation.description;
  const surfaceGoal = understanding.surface_goal || collected.surface_goal || '';

  // 构造新格式参数
  return await service['generateLearningPath'](conversation, {
    userVisible: '',  // 此场景无对话文本
    internal: {
      understanding: {
        ...understanding,
        real_problem: realGoal,
        surface_goal: surfaceGoal
      },
      confidence: data.confidence || 0.9,
      stage: 'ready',
      nextQuestions: [],
      collected
    }
  });
}
