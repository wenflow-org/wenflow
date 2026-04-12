/**
 * GoalTypeIdentifier Skill - 目标类型识别
 * 
 * 使用 LLM 分析用户目标类型：
 * - understanding: 理解型（以理解概念为主）
 * - practical: 实操型（以动手实践为主）
 * - skill: 技能型（以掌握技能为主）
 * - certification: 认证型（以通过考试/认证为主）
 * 
 * 输出知识分布建议
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';

export const goalTypeIdentifierDefinition: SkillDefinition = {
  name: 'goal-type-identifier',
  version: '1.0.0',
  category: 'analysis',
  description: '分析用户学习目标类型，输出知识分布建议',
  
  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: '用户学习目标描述',
        required: true
      },
      context: {
        type: 'string',
        description: '用户背景信息（已有知识、时间约束等）'
      },
      domain: {
        type: 'string',
        description: '目标所属领域（如 programming, language, design）'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      goalType: {
        type: 'string',
        description: '目标类型：understanding/practical/skill/certification'
      },
      knowledgeDistribution: {
        type: 'object',
        description: '建议的知识类型分布比例'
      },
      cognitiveFocus: {
        type: 'object',
        description: '建议的认知层级分布比例'
      },
      confidence: {
        type: 'number',
        description: '置信度 0-1'
      },
      reasoning: {
        type: 'string',
        description: '分类理由'
      }
    }
  },
  
  capabilities: ['goal-analysis', 'knowledge-planning', 'cognitive-mapping'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export interface GoalTypeInput {
  goal: string;
  context?: string;
  domain?: string;
}

export interface GoalTypeOutput {
  goalType: 'understanding' | 'practical' | 'skill' | 'certification';
  knowledgeDistribution: {
    factual: number;
    conceptual: number;
    procedural: number;
    metacognitive: number;
  };
  cognitiveFocus: {
    remember: number;
    understand: number;
    apply: number;
    analyze: number;
    evaluate: number;
    create: number;
  };
  confidence: number;
  reasoning: string;
}

const GOAL_TYPE_SYSTEM_PROMPT = `你是学习目标分析专家，负责分析用户的学习目标类型并给出知识分布建议。

【目标类型定义】
1. understanding（理解型）: 以理解概念、原理为主，如"理解机器学习原理"、"了解量子计算"
2. practical（实操型）: 以动手实践为主，如"学会使用 Excel"、"掌握 Python 编程"
3. skill（技能型）: 以掌握可迁移技能为主，如"提升沟通能力"、"培养批判性思维"
4. certification（认证型）: 以通过考试/认证为主，如"通过 PMP 考试"、"获得 AWS 认证"

【安德森知识类型】
- factual（事实性知识）: 具体事实、数据、术语
- conceptual（概念性知识）: 分类、原理、理论、模型
- procedural（程序性知识）: 技能、算法、技术、方法
- metacognitive（元认知知识）: 学习策略、自我认知

【认知层级（布鲁姆修订版）】
- remember（记忆）: 识别、回忆
- understand（理解）: 解释、举例、分类
- apply（应用）: 执行、实施
- analyze（分析）: 区分、组织、比较
- evaluate（评价）: 检查、评判
- create（创造）: 生成、规划、生产

【输出格式】
请严格按照以下 JSON 格式输出，不要添加任何其他内容：
{
  "goalType": "类型之一",
  "knowledgeDistribution": {
    "factual": 0-100,
    "conceptual": 0-100,
    "procedural": 0-100,
    "metacognitive": 0-100
  },
  "cognitiveFocus": {
    "remember": 0-100,
    "understand": 0-100,
    "apply": 0-100,
    "analyze": 0-100,
    "evaluate": 0-100,
    "create": 0-100
  },
  "confidence": 0-1,
  "reasoning": "分类理由简述"
}

注意：knowledgeDistribution 和 cognitiveFocus 的数值总和应为 100（百分比）。`;

export async function goalTypeIdentifier(
  input: GoalTypeInput
): Promise<SkillExecutionResult<GoalTypeOutput>> {
  const startTime = Date.now();
  
  try {
    const { goal, context, domain } = input;
    
    const userPrompt = `请分析以下学习目标：

目标：${goal}
${context ? `用户背景：${context}` : ''}
${domain ? `领域：${domain}` : ''}

请识别目标类型并给出知识分布建议。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: GOAL_TYPE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ];
    
    const client = getOpenAIClient();
    const response = await client.chatCompletion({ messages, temperature: 0.3 });
    const content = response.choices[0]?.message.content || '';
    
    const result = parseGoalTypeResult(content);
    
    return {
      success: true,
      output: result,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    console.error('[GoalTypeIdentifier] 分析失败:', error.message);
    return {
      success: false,
      error: {
        code: 'GOAL_TYPE_ERROR',
        message: error.message
      },
      duration: Date.now() - startTime
    };
  }
}

function parseGoalTypeResult(content: string): GoalTypeOutput {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('未找到 JSON 输出');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    const validTypes = ['understanding', 'practical', 'skill', 'certification'];
    const goalType = validTypes.includes(parsed.goalType) ? parsed.goalType : 'practical';
    
    const knowledgeDistribution = normalizeDistribution(parsed.knowledgeDistribution || {
      factual: 25,
      conceptual: 25,
      procedural: 25,
      metacognitive: 25
    });
    
    const cognitiveFocus = normalizeDistribution(parsed.cognitiveFocus || {
      remember: 15,
      understand: 20,
      apply: 30,
      analyze: 15,
      evaluate: 10,
      create: 10
    });
    
    return {
      goalType,
      knowledgeDistribution,
      cognitiveFocus,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.7)),
      reasoning: parsed.reasoning || '基于目标关键词分析'
    };
  } catch (parseError) {
    console.warn('[GoalTypeIdentifier] 解析失败，使用默认值:', parseError);
    return {
      goalType: 'practical',
      knowledgeDistribution: { factual: 20, conceptual: 30, procedural: 40, metacognitive: 10 },
      cognitiveFocus: { remember: 10, understand: 20, apply: 35, analyze: 15, evaluate: 10, create: 10 },
      confidence: 0.5,
      reasoning: '解析失败，使用默认配置'
    };
  }
}

function normalizeDistribution<T extends Record<string, number>>(dist: T): T {
  const total = Object.values(dist).reduce((sum, v) => sum + v, 0);
  if (total === 0) return dist;
  
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(dist)) {
    normalized[key] = Math.round((value / total) * 100);
  }
  return normalized as T;
}

export default goalTypeIdentifier;