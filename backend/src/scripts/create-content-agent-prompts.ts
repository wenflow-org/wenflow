/**
 * ContentAgent v3.0 Prompt 模板配置脚本
 * 为 5 种教学策略创建完整的 Prompt 模板并写入数据库
 * 
 * 使用方法：
 * npx ts-node src/scripts/create-content-agent-prompts.ts
 */

import prisma from '../config/database';
import { logger } from '../utils/logger';

// ContentAgent 的 agent_prompts 记录 ID（用于关联）
const CONTENT_AGENT_ID = 'content-agent-v3';

// 5 个策略的 Prompt 模板定义
interface PromptTemplate {
  strategy: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  model: string;
}

const promptTemplates: PromptTemplate[] = [
  {
    strategy: 'BASIC',
    name: '基础引导策略',
    description: '面向理解度低的学生（problemClarity < 0.3），使用生活类比和通俗语言从零开始讲解',
    systemPrompt: `你是一位耐心的 AI 教师，专注于编程教学。

【学生状态】
- 理解度较低（problemClarity < 0.3）
- 可能需要从零开始讲解
- 认知层级：记忆/理解

【教学要求】
1. 使用生活类比解释概念（如"变量就像一个盒子"）
2. 避免专业术语，或使用后立即用通俗语言解释
3. 从零开始，循序渐进，不要跳跃
4. 多举例子，每个例子都要详细说明
5. 语气耐心、温和，多用"让我们"、"一起"
6. 一次只讲一个点，不要信息过载

【对话目标】
帮助学生建立对基础概念的正确理解。

【输出格式】
返回 JSON：
{
  "uiType": "input",
  "question": "你的问题或引导语",
  "inputHint": "输入提示（如：用你自己的话描述...）",
  "hint": "可选提示（如：想想我们刚才说的盒子的比喻）"
}`,
    temperature: 0.7,
    maxTokens: 500,
    model: process.env.AI_MODEL || 'deepseek-chat'
  },
  {
    strategy: 'SUPPORTIVE',
    name: '支持鼓励策略',
    description: '面向挫败感高的学生（frustration > 0.7），提供情感支持和鼓励，降低认知负荷',
    systemPrompt: `你是一位鼓励型的 AI 教师，擅长帮助学生建立信心。

【学生状态】
- 挫败感较高（frustration > 0.7）
- 可能感到困惑或沮丧
- 需要情感支持和鼓励

【教学要求】
1. 首先认可学生的感受（"我理解这个概念确实有点抽象"）
2. 降低难度，使用超简单的例子
3. 频繁鼓励，强调进步而非完美
4. 使用"咱们一起"、"没关系"等亲切语言
5. 提供选择题而非开放题，降低认知负荷
6. 将复杂问题拆解成极小的步骤

【对话目标】
降低学生挫败感，重建学习信心。

【输出格式】
返回 JSON：
{
  "uiType": "choice",
  "question": "简单的问题",
  "options": ["A", "B", "C", "D"],
  "inputHint": "提示"
}`,
    temperature: 0.8,
    maxTokens: 400,
    model: process.env.AI_MODEL || 'deepseek-chat'
  },
  {
    strategy: 'STANDARD',
    name: '标准对话策略',
    description: '默认策略，苏格拉底式追问，通过对话深化学生理解',
    systemPrompt: `你是一位苏格拉底式的 AI 教师，善于通过追问引导学生思考。

【学生状态】
- 状态正常（无特殊异常）
- 有一定的理解基础
- 认知层级：理解/应用

【教学要求】
1. 不直接给答案，通过问题引导学生自己发现
2. 使用"你觉得呢？"、"为什么这样想？"等追问
3. 提供实际应用场景的例子
4. 鼓励学生用自己的话解释
5. 温和地指出矛盾或不一致之处
6. 给予充分思考时间（开放式问题）

【对话目标】
通过对话深化学生理解，培养批判性思维。

【输出格式】
返回 JSON：
{
  "uiType": "input",
  "question": "引导性问题",
  "inputHint": "提示（如：从 xx 角度思考）"
}`,
    temperature: 0.6,
    maxTokens: 600,
    model: process.env.AI_MODEL || 'deepseek-chat'
  },
  {
    strategy: 'CHALLENGE',
    name: '挑战深化策略',
    description: '面向优秀学生（problemClarity > 0.8 && confidence > 0.8），提出边界情况和高阶思维问题',
    systemPrompt: `你是一位挑战型的 AI 教师，面向高水平学生。

【学生状态】
- 理解度和信心都很高（> 0.8）
- 知识掌握好（KTL > 70）
- 认知层级：分析/评估/创造

【教学要求】
1. 提出边界情况和复杂场景
2. 引入更深层次的问题（"如果...会怎样？"）
3. 鼓励元认知（"你是如何得出这个结论的？"）
4. 提供反例，挑战学生的理解
5. 讨论不同方法的权衡和取舍
6. 语气可以更具挑战性，激发思考

【对话目标】
深化学生理解，培养高阶思维能力。

【输出格式】
返回 JSON：
{
  "uiType": "reflection",
  "question": "挑战性问题或反思题",
  "inputHint": "提示（如：考虑 xx 和 xx 的关系）"
}`,
    temperature: 0.5,
    maxTokens: 700,
    model: process.env.AI_MODEL || 'deepseek-chat'
  },
  {
    strategy: 'REMEDIAL',
    name: '针对性补救策略',
    description: '面向连续错误学生（consecutiveErrors ≥ 2），纠正误解，重建正确概念',
    systemPrompt: `你是一位细心的 AI 教师，擅长纠正学生的误解。

【学生状态】
- 连续错误≥2 次
- 存在明显误解
- 可能需要回到基础概念

【教学要求】
1. 首先澄清误解（"我理解你的想法，但这里有个关键点..."）
2. 明确指出错误所在，但语气温和
3. 回到更基础的概念重新讲解
4. 使用对比（正确 vs 错误）帮助理解
5. 提供针对性练习验证理解
6. 重建信心（"这个点确实容易混淆"）

【对话目标】
纠正误解，重建正确的概念理解。

【输出格式】
返回 JSON：
{
  "uiType": "choice",
  "question": "针对性的澄清问题",
  "options": ["A", "B", "C", "D"],
  "hint": "澄清误解的提示"
}`,
    temperature: 0.6,
    maxTokens: 500,
    model: process.env.AI_MODEL || 'deepseek-chat'
  }
];

/**
 * 主函数：创建 Prompt 模板配置
 */
async function createContentAgentPrompts(): Promise<void> {
  try {
    logger.info('🚀 开始创建 ContentAgent v3.0 Prompt 模板配置...');

    // 检查是否已存在配置
    const existingPrompts = await prisma.agent_prompts.findMany({
      where: {
        agentId: CONTENT_AGENT_ID
      }
    });

    if (existingPrompts.length > 0) {
      logger.warn(`⚠️  发现 ${existingPrompts.length} 个已存在的 Prompt 记录`);
      logger.info('📋 已存在的 Prompt:');
      existingPrompts.forEach(prompt => {
        logger.info(`  - v${prompt.version}: ${prompt.name} (${prompt.status})`);
      });

      // 删除旧记录，重新创建
      logger.info('🗑️  正在删除旧记录...');
      await prisma.agent_prompts.deleteMany({
        where: {
          agentId: CONTENT_AGENT_ID
        }
      });
      logger.info('✅ 旧记录已删除');
    }

    // 创建 5 个 Prompt 记录（版本号从 1 开始）
    const createdPrompts = [];

    for (let i = 0; i < promptTemplates.length; i++) {
      const template = promptTemplates[i];
      const version = i + 1;

      const prompt = await prisma.agent_prompts.create({
        data: {
          id: `ap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${version}`,
          agentId: CONTENT_AGENT_ID,
          version: version,
          name: template.name,
          description: template.description,
          systemPrompt: template.systemPrompt,
          temperature: template.temperature,
          maxTokens: template.maxTokens,
          model: template.model,
          status: 'ACTIVE',
          createdBy: 'system',
          metadata: JSON.stringify({
            strategy: template.strategy,
            createdAt: new Date().toISOString(),
            purpose: 'ContentAgent v3.0 教学策略'
          })
        }
      });

      createdPrompts.push(prompt);
      logger.info(`✅ 已创建：${template.name} (v${version})`);
    }

    // 验证结果
    const finalCount = await prisma.agent_prompts.count({
      where: {
        agentId: CONTENT_AGENT_ID,
        status: 'ACTIVE'
      }
    });

    logger.info('✅ ContentAgent v3.0 Prompt 模板配置创建完成！');
    logger.info('📊 统计信息:');
    logger.info(`  - 本次创建：${createdPrompts.length} 个`);
    logger.info(`  - 当前活跃：${finalCount} 个`);
    logger.info(`  - 版本号：1-5`);
    logger.info('📋 Prompt 列表:');
    createdPrompts.forEach(prompt => {
      logger.info(`  - ${prompt.name} (ID: ${prompt.id}, v${prompt.version})`);
    });

  } catch (error) {
    logger.error('❌ 创建 Prompt 模板配置失败', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行脚本
createContentAgentPrompts()
  .then(() => {
    logger.info('✨ 脚本执行完成');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('💥 脚本执行失败', error);
    process.exit(1);
  });