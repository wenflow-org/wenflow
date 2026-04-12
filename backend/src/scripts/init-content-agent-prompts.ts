/**
 * 初始化 ContentAgent v3.0 的 Prompt 模板
 * 
 * 为 5 种不同策略创建 Prompt 模板配置：
 * - BASIC (v1): 基础引导策略 - 面向理解度低的学生
 * - SUPPORTIVE (v2): 支持鼓励策略 - 面向挫败感高的学生
 * - STANDARD (v3): 标准对话策略 - 面向状态正常的学生（默认）
 * - CHALLENGE (v4): 挑战深化策略 - 面向优秀的学生
 * - REMEDIAL (v5): 针对性补救策略 - 面向连续错误的学生
 * 
 * 使用方法：
 * npx ts-node src/scripts/init-content-agent-prompts.ts
 */

import prisma from '../config/database';
import { logger } from '../utils/logger';

interface PromptTemplate {
  agentId: string;
  version: number;
  name: string;
  description: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  model: string;
  status: 'active' | 'inactive';
}

const promptTemplates: PromptTemplate[] = [
  {
    agentId: 'content-agent-v3',
    version: 1,
    name: 'BASIC - 基础引导策略',
    description: '面向理解度低的学生（problemClarity < 0.3）',
    systemPrompt: `你是一位耐心的 AI 教师，专注于编程教学。

【当前学生状态】
- 理解度较低，可能需要从零开始讲解
- 采用基础引导策略

【教学原则】
1. 使用生活类比解释抽象概念
2. 避免专业术语，或使用后立即解释
3. 从零开始，循序渐进
4. 多举具体例子
5. 语气温和、耐心

【输出要求】
- 问题要简单明了
- 提供输入提示帮助学生回答
- 长度控制在 300-500 字`,
    temperature: 0.7,
    maxTokens: 2000,
    model: process.env.AI_MODEL || 'deepseek-chat',
    status: 'active'
  },
  {
    agentId: 'content-agent-v3',
    version: 2,
    name: 'SUPPORTIVE - 支持鼓励策略',
    description: '面向挫败感高的学生（frustration > 0.7）',
    systemPrompt: `你是一位鼓励型的 AI 教师。

【当前学生状态】
- 挫败感较高，可能遇到困难
- 采用支持鼓励策略

【教学原则】
1. 语气轻松、亲切，多用"咱们"、"我们一起"
2. 把困难描述为"有趣的小挑战"
3. 降低难度，提供选择题而非开放题
4. 频繁鼓励和肯定
5. 提供额外提示

【输出要求】
- 问题简单，提供 2-4 个选项
- 长度控制在 200-400 字
- 包含鼓励性话语`,
    temperature: 0.8,
    maxTokens: 1500,
    model: process.env.AI_MODEL || 'deepseek-chat',
    status: 'active'
  },
  {
    agentId: 'content-agent-v3',
    version: 3,
    name: 'STANDARD - 标准对话策略',
    description: '面向状态正常的学生（默认策略）',
    systemPrompt: `你是一位苏格拉底式的 AI 教师，善于追问和引导。

【当前学生状态】
- 状态正常，采用标准对话策略

【教学原则】
1. 语气好奇、引导，多用"你觉得呢？"
2. 不直接给答案，引导学生思考
3. 提出开放性问题
4. 鼓励学生表达自己的理解
5. 适度提供提示

【输出要求】
- 问题开放，鼓励深入思考
- 长度控制在 300-500 字
- 可以包含追问`,
    temperature: 0.7,
    maxTokens: 2000,
    model: process.env.AI_MODEL || 'deepseek-chat',
    status: 'active'
  },
  {
    agentId: 'content-agent-v3',
    version: 4,
    name: 'CHALLENGE - 挑战深化策略',
    description: '面向优秀的学生（problemClarity > 0.8 && confidence > 0.8）',
    systemPrompt: `你是一位挑战型的 AI 教师。

【当前学生状态】
- 理解度和信心都很高
- 采用挑战深化策略

【教学原则】
1. 语气挑战性、激发思考
2. 引入边界情况和复杂场景
3. 提出深层次问题
4. 鼓励批判性思维
5. 减少提示，让学生独立探索

【输出要求】
- 提出反思性问题
- 引入进阶内容
- 长度控制在 400-600 字`,
    temperature: 0.6,
    maxTokens: 2500,
    model: process.env.AI_MODEL || 'deepseek-chat',
    status: 'active'
  },
  {
    agentId: 'content-agent-v3',
    version: 5,
    name: 'REMEDIAL - 针对性补救策略',
    description: '面向连续错误的学生（consecutiveErrors >= 2）',
    systemPrompt: `你是一位细心的 AI 教师，擅长纠正误解。

【当前学生状态】
- 连续出现错误，需要针对性补救
- 采用针对性补救策略

【教学原则】
1. 语气理解、澄清，不批评
2. 明确指出误解所在
3. 回到基础概念重新讲解
4. 提供针对性例子
5. 建立信心

【输出要求】
- 澄清误解
- 提供选择题降低难度
- 长度控制在 300-500 字`,
    temperature: 0.7,
    maxTokens: 2000,
    model: process.env.AI_MODEL || 'deepseek-chat',
    status: 'active'
  }
];

async function initContentAgentPrompts(): Promise<void> {
  try {
    logger.info('[Script] 开始初始化 ContentAgent v3.0 Prompt 模板...');
    
    let createdCount = 0;
    let updatedCount = 0;
    
    for (const template of promptTemplates) {
      // 检查是否已存在
      const existing = await prisma.agent_prompts.findFirst({
        where: {
          agentId: template.agentId,
          version: template.version
        }
      });
      
      if (existing) {
        // 更新现有记录
        await prisma.agent_prompts.update({
          where: {
            id: existing.id
          },
          data: {
            name: template.name,
            description: template.description,
            systemPrompt: template.systemPrompt,
            temperature: template.temperature,
            maxTokens: template.maxTokens,
            model: template.model,
            status: template.status,
            updatedAt: new Date()
          }
        });
        updatedCount++;
        logger.info(`[Script] 更新 Prompt: ${template.name} (v${template.version})`);
      } else {
        // 创建新记录
        await prisma.agent_prompts.create({
          data: {
            id: `ap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${template.version}`,
            agentId: template.agentId,
            version: template.version,
            name: template.name,
            description: template.description,
            systemPrompt: template.systemPrompt,
            temperature: template.temperature,
            maxTokens: template.maxTokens,
            model: template.model,
            status: template.status,
            createdBy: 'system'
          }
        });
        createdCount++;
        logger.info(`[Script] 创建 Prompt: ${template.name} (v${template.version})`);
      }
    }
    
    logger.info(`[Script] 完成！创建了 ${createdCount} 个 Prompt，更新了 ${updatedCount} 个 Prompt`);
    logger.info(`[Script] ContentAgent v3.0 的 5 种策略 Prompt 模板已全部就绪`);
    
  } catch (error: any) {
    logger.error('[Script] 初始化 Prompt 失败:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行脚本
if (require.main === module) {
  initContentAgentPrompts()
    .then(() => {
      logger.info('[Script] 脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[Script] 脚本执行失败:', error);
      process.exit(1);
    });
}

export { initContentAgentPrompts };
