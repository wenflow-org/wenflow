/**
 * LabelGenerator Skill - 动态标签生成
 * 
 * 根据知识类型、认知层级、目标类型生成用户友好的白话标签
 * 例如：
 * - "事实性 + 理解" -> "了解核心概念"
 * - "程序性 + 应用" -> "动手实践"
 * - "元认知 + 分析" -> "反思学习方法"
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';

export const labelGeneratorDefinition: SkillDefinition = {
  name: 'label-generator',
  version: '1.0.0',
  category: 'generation',
  description: '生成用户友好的学习标签（白话标签）',
  
  inputSchema: {
    type: 'object',
    properties: {
      knowledgeType: {
        type: 'string',
        description: '知识类型',
        required: true
      },
      cognitiveLevel: {
        type: 'string',
        description: '认知层级',
        required: true
      },
      goalType: {
        type: 'string',
        description: '目标类型'
      },
      taskTitle: {
        type: 'string',
        description: '任务标题'
      },
      domain: {
        type: 'string',
        description: '领域'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      displayLabel: {
        type: 'string',
        description: '白话标签'
      },
      shortLabel: {
        type: 'string',
        description: '短标签（用于卡片）'
      },
      icon: {
        type: 'string',
        description: '建议图标'
      },
      color: {
        type: 'string',
        description: '建议颜色'
      }
    }
  },
  
  capabilities: ['label-generation', 'user-friendly-tagging'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export interface LabelGeneratorInput {
  knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'metacognitive';
  cognitiveLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  goalType?: 'understanding' | 'practical' | 'skill' | 'certification';
  taskTitle?: string;
  domain?: string;
}

export interface LabelGeneratorOutput {
  displayLabel: string;
  shortLabel: string;
  icon: string;
  color: string;
}

const LABEL_TEMPLATE_SYSTEM_PROMPT = `你是教育标签设计师，负责将学术框架转化为用户友好的白话标签。

【知识类型 -> 白话】
- factual -> "了解"、"记住"、"认识"
- conceptual -> "理解"、"掌握概念"、"弄懂原理"
- procedural -> "实践"、"动手"、"应用"
- metacognitive -> "反思"、"规划"、"评估自己"

【认知层级 -> 白话】
- remember -> "记忆"、"了解基础"
- understand -> "理解"、"搞懂"
- apply -> "实践"、"应用"
- analyze -> "分析"、"深入探究"
- evaluate -> "评估"、"判断"
- create -> "创造"、"设计"

【组合示例】
- factual + remember -> "了解基础知识"
- conceptual + understand -> "理解核心原理"
- procedural + apply -> "动手实践"
- procedural + create -> "独立设计"
- metacognitive + evaluate -> "反思学习方法"

【输出格式】
请严格按照以下 JSON 格式输出：
{
  "displayLabel": "完整白话标签（5-10字）",
  "shortLabel": "短标签（2-4字，用于卡片）",
  "icon": "建议图标名称",
  "color": "建议颜色（CSS 颜色值）"
}

图标和颜色建议：
- factual/remember: 📖 book, #4A90E2 (蓝色 - 信息)
- conceptual/understand: 💡 lightbulb, #50C878 (绿色 - 理解)
- procedural/apply: 🔧 tool, #FF9500 (橙色 - 实践)
- procedural/create: 🎨 palette, #E74C3C (红色 - 创造)
- analyze: 🔍 search, #9B59B6 (紫色 - 分析)
- evaluate: ⭐ star, #F1C40F (黄色 - 评估)
- metacognitive: 🧠 brain, #1ABC9C (青色 - 元认知)`;

export async function labelGenerator(
  input: LabelGeneratorInput
): Promise<SkillExecutionResult<LabelGeneratorOutput>> {
  const startTime = Date.now();
  
  try {
    const { knowledgeType, cognitiveLevel, goalType, taskTitle, domain } = input;
    
    // 快速路径：只有基础字段时，直接返回预定义标签（不调用 AI）
    // 只有当需要定制化时（有 domain/taskTitle），才调用 AI
    if (!goalType && !taskTitle && !domain) {
      const fallback = generateFallbackLabel(knowledgeType, cognitiveLevel);
      return {
        success: true,
        output: fallback,
        duration: Date.now() - startTime,
        cached: true  // 标记为缓存结果
      };
    }
    
    // 有定制化需求时，才调用 AI
    const contextPrompt = `请为以下任务生成用户友好的标签：

【知识类型】${knowledgeType}
【认知层级】${cognitiveLevel}
${goalType ? `【目标类型】${goalType}` : ''}
${taskTitle ? `【任务标题】${taskTitle}` : ''}
${domain ? `【领域】${domain}` : ''}

请生成白话标签。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: LABEL_TEMPLATE_SYSTEM_PROMPT },
      { role: 'user', content: contextPrompt }
    ];
    
    const client = getOpenAIClient();
    const response = await client.chatCompletion({ messages, temperature: 0.4 });
    const content = response.choices[0]?.message.content || '';
    
    const result = parseLabelResult(content, knowledgeType, cognitiveLevel);
    
    return {
      success: true,
      output: result,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    console.error('[LabelGenerator] 生成失败:', error.message);
    
    const fallback = generateFallbackLabel(input.knowledgeType, input.cognitiveLevel);
    return {
      success: true,
      output: fallback,
      duration: Date.now() - startTime
    };
  }
}

function parseLabelResult(
  content: string, 
  knowledgeType: string, 
  cognitiveLevel: string
): LabelGeneratorOutput {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return generateFallbackLabel(knowledgeType, cognitiveLevel);
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      displayLabel: parsed.displayLabel || generateDisplayLabel(knowledgeType, cognitiveLevel),
      shortLabel: parsed.shortLabel || generateShortLabel(cognitiveLevel),
      icon: parsed.icon || getDefaultIcon(knowledgeType, cognitiveLevel),
      color: parsed.color || getDefaultColor(cognitiveLevel)
    };
  } catch {
    return generateFallbackLabel(knowledgeType, cognitiveLevel);
  }
}

function generateFallbackLabel(knowledgeType: string, cognitiveLevel: string): LabelGeneratorOutput {
  return {
    displayLabel: generateDisplayLabel(knowledgeType, cognitiveLevel),
    shortLabel: generateShortLabel(cognitiveLevel),
    icon: getDefaultIcon(knowledgeType, cognitiveLevel),
    color: getDefaultColor(cognitiveLevel)
  };
}

const DISPLAY_LABEL_MAP: Record<string, Record<string, string>> = {
  factual: {
    remember: '了解基础知识',
    understand: '理解基本概念',
    apply: '应用基础知识',
    analyze: '分析知识结构',
    evaluate: '评估信息准确性',
    create: '构建知识框架'
  },
  conceptual: {
    remember: '记住关键概念',
    understand: '理解核心原理',
    apply: '应用概念解决问题',
    analyze: '深入分析原理',
    evaluate: '评估概念适用性',
    create: '构建概念模型'
  },
  procedural: {
    remember: '记住操作步骤',
    understand: '理解方法原理',
    apply: '动手实践',
    analyze: '分析操作逻辑',
    evaluate: '评估方法效果',
    create: '设计新方法'
  },
  metacognitive: {
    remember: '了解学习策略',
    understand: '理解学习方法',
    apply: '应用学习技巧',
    analyze: '分析学习状态',
    evaluate: '反思学习效果',
    create: '规划学习路径'
  }
};

const SHORT_LABEL_MAP: Record<string, string> = {
  remember: '了解',
  understand: '理解',
  apply: '实践',
  analyze: '分析',
  evaluate: '评估',
  create: '创造'
};

const ICON_MAP: Record<string, Record<string, string>> = {
  factual: { default: '📖' },
  conceptual: { default: '💡' },
  procedural: { default: '🔧', create: '🎨' },
  metacognitive: { default: '🧠' }
};

const COLOR_MAP: Record<string, string> = {
  remember: '#4A90E2',
  understand: '#50C878',
  apply: '#FF9500',
  analyze: '#9B59B6',
  evaluate: '#F1C40F',
  create: '#E74C3C'
};

function generateDisplayLabel(knowledgeType: string, cognitiveLevel: string): string {
  const typeMap = DISPLAY_LABEL_MAP[knowledgeType];
  if (typeMap && typeMap[cognitiveLevel]) {
    return typeMap[cognitiveLevel];
  }
  return `${SHORT_LABEL_MAP[cognitiveLevel] || '学习'}相关内容`;
}

function generateShortLabel(cognitiveLevel: string): string {
  return SHORT_LABEL_MAP[cognitiveLevel] || '学习';
}

function getDefaultIcon(knowledgeType: string, cognitiveLevel: string): string {
  const typeMap = ICON_MAP[knowledgeType];
  if (typeMap) {
    if (cognitiveLevel === 'create' && typeMap.create) {
      return typeMap.create;
    }
    return typeMap.default;
  }
  return '📚';
}

function getDefaultColor(cognitiveLevel: string): string {
  return COLOR_MAP[cognitiveLevel] || '#4A90E2';
}

export default labelGenerator;