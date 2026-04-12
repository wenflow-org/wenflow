/**
 * Code Explainer Skill
 * 
 * 逐行解释代码，帮助初学者理解代码逻辑
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';

/**
 * Code Explainer Skill 定义
 */
export const codeExplainerDefinition: SkillDefinition = {
  name: 'code-explainer',
  version: '1.0.0',
  category: 'analysis',
  description: '逐行解释代码，帮助初学者理解代码逻辑和语法',
  
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: '需要解释的代码',
        required: true
      },
      language: {
        type: 'string',
        description: '编程语言：python/javascript/java 等',
        default: 'python'
      },
      userLevel: {
        type: 'string',
        description: '用户水平：beginner/intermediate/advanced',
        default: 'beginner'
      },
      explanationStyle: {
        type: 'string',
        description: '解释风格：line-by-line/block/overview',
        default: 'line-by-line'
      },
      focusAreas: {
        type: 'string',
        description: '重点关注的方面（逗号分隔）',
        default: 'syntax,logic'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      overview: {
        type: 'string',
        description: '代码整体概述'
      },
      lineByLineExplanation: {
        type: 'string',
        description: '逐行解释（JSON 字符串）'
      },
      keyConcepts: {
        type: 'string',
        description: '关键概念（JSON 数组）'
      },
      commonMistakes: {
        type: 'string',
        description: '常见错误（JSON 数组）'
      },
      suggestions: {
        type: 'string',
        description: '改进建议（JSON 数组）'
      }
    }
  },
  
  capabilities: ['code-explanation', 'concept-clarification', 'error-prevention'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * Code Explainer 输入
 */
export interface CodeExplainerInput {
  code: string;
  language?: string;
  userLevel?: 'beginner' | 'intermediate' | 'advanced';
  explanationStyle?: 'line-by-line' | 'block' | 'overview';
  focusAreas?: string[];
}

/**
 * Code Explainer 输出
 */
export interface CodeExplainerOutput {
  overview: string;
  lineByLineExplanation: Array<{
    lineNumber: number;
    code: string;
    explanation: string;
    keyConcepts: string[];
  }>;
  keyConcepts: string[];
  commonMistakes: Array<{
    mistake: string;
    correction: string;
  }>;
  suggestions: string[];
}

/**
 * 系统提示模板
 */
const SYSTEM_PROMPTS: Record<string, string> = {
  'line-by-line': `你是一位耐心的编程导师，擅长逐行解释代码。
请对代码进行逐行解释，每行解释包含：
1. 这行代码的作用
2. 涉及的语法或概念
3. 为什么这样写
4. 可能的替代写法

请用通俗易懂的语言，适合初学者理解。`,

  'block': `你是一位编程导师，擅长按代码块解释逻辑。
请将代码按功能分块解释，每块包含：
1. 这个代码块的功能
2. 关键语法和概念
3. 与其他代码块的关系`,

  'overview': `你是一位编程导师，擅长整体概述代码。
请概述这段代码：
1. 整体功能和目标
2. 主要使用的技术和方法
3. 代码结构和流程`
};

/**
 * Code Explainer Skill 实现
 */
export async function codeExplainer(
  input: CodeExplainerInput
): Promise<SkillExecutionResult<CodeExplainerOutput>> {
  const startTime = Date.now();
  
  try {
    const {
      code,
      language = 'python',
      userLevel = 'beginner',
      explanationStyle = 'line-by-line',
      focusAreas = ['syntax', 'logic']
    } = input;
    
    // 根据用户水平调整解释深度
    const levelInstruction = {
      beginner: '使用非常通俗易懂的语言，避免专业术语，多用类比。假设用户是零基础。',
      intermediate: '适度使用专业术语，但需要解释。可以提及最佳实践。',
      advanced: '可以使用专业术语，深入讨论原理和优化方案。'
    }[userLevel];
    
    // 构建系统提示
    const systemPrompt = [
      SYSTEM_PROMPTS[explanationStyle] || SYSTEM_PROMPTS['line-by-line'],
      levelInstruction,
      `这是${language}代码。`,
      focusAreas.includes('syntax') ? '请重点解释语法特点。' : '',
      focusAreas.includes('logic') ? '请重点解释逻辑流程。' : '',
      focusAreas.includes('best-practices') ? '请指出是否符合最佳实践，并给出改进建议。' : '',
      focusAreas.includes('performance') ? '请分析性能特点，并给出优化建议。' : ''
    ].filter(Boolean).join('\n\n');
    
    // 构建用户消息
    const userMessage = `请解释以下${language}代码：\n\n\`\`\`${language}\n${code}\n\`\`\``;
    
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];
    
    // 调用 AI
    const client = getOpenAIClient();
    const response = await client.chatCompletion({ 
      messages,
      temperature: 0.5,
      max_tokens: 2048
    });
    
    const explanation = response.choices[0]?.message.content || '';
    
    // 解析解释内容
    const parsed = parseExplanation(explanation, code, language);
    
    // 生成关键概念列表
    const keyConcepts = extractKeyConcepts(explanation);
    
    // 生成常见错误
    const commonMistakes = await generateCommonMistakes(code, language, userLevel);
    
    // 生成改进建议
    const suggestions = await generateSuggestions(code, language, userLevel, focusAreas);

    return {
      success: true,
      output: {
        overview: parsed.overview,
        lineByLineExplanation: parsed.lineByLine,
        keyConcepts,
        commonMistakes,
        suggestions
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'CODE_EXPLAINER_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 解析解释内容
 */
function parseExplanation(
  explanation: string,
  code: string,
  language: string
): { overview: string; lineByLine: CodeExplainerOutput['lineByLineExplanation'] } {
  const lines = code.split('\n');
  const explanationLines = explanation.split('\n');
  
  // 提取概述（通常在开头）
  let overview = '';
  const overviewMarkers = ['概述', '总的来说', '整体来看', 'Overview', 'In summary'];
  for (const line of explanationLines) {
    if (overviewMarkers.some(marker => line.includes(marker))) {
      overview = line.replace(/^(概述 | 总的来说 | 整体来看 | Overview|In summary)[:：]?\s*/, '');
      break;
    }
  }
  
  // 如果没有找到概述，用前两段作为概述
  if (!overview) {
    overview = explanationLines.slice(0, 2).join('\n').trim();
  }
  
  // 逐行解释（简化处理：将解释按行号或代码片段匹配）
  const lineByLine: CodeExplainerOutput['lineByLineExplanation'] = [];
  
  // 尝试匹配解释中的行号
  const lineRegex = /(?:第？\s*(\d+)\s*行|Line\s*(\d+))[:：]?\s*(.+)/gi;
  let match;
  const lineExplanations = new Map<number, string>();
  
  while ((match = lineRegex.exec(explanation)) !== null) {
    const lineNum = parseInt(match[1] || match[2]) - 1; // 转为 0 基索引
    const expl = match[3].trim();
    lineExplanations.set(lineNum, expl);
  }
  
  // 为每行代码生成解释
  for (let i = 0; i < lines.length; i++) {
    const codeLine = lines[i];
    const explanation = lineExplanations.get(i) || `这行代码的作用需要结合上下文理解`;
    
    lineByLine.push({
      lineNumber: i + 1,
      code: codeLine,
      explanation,
      keyConcepts: extractLineKeyConcepts(codeLine, language)
    });
  }
  
  return { overview, lineByLine };
}

/**
 * 提取行级关键概念
 */
function extractLineKeyConcepts(codeLine: string, language: string): string[] {
  const concepts: string[] = [];
  
  // Python 常见概念
  if (language === 'python') {
    if (codeLine.includes('def ')) concepts.push('函数定义');
    if (codeLine.includes('class ')) concepts.push('类定义');
    if (codeLine.includes('if ') || codeLine.includes('elif ') || codeLine.includes('else')) concepts.push('条件语句');
    if (codeLine.includes('for ')) concepts.push('for 循环');
    if (codeLine.includes('while ')) concepts.push('while 循环');
    if (codeLine.includes('return ')) concepts.push('返回值');
    if (codeLine.includes('import ')) concepts.push('导入模块');
    if (codeLine.includes('print(')) concepts.push('输出函数');
    if (codeLine.includes('[') && codeLine.includes(']')) concepts.push('列表');
    if (codeLine.includes('{') && codeLine.includes('}')) concepts.push('字典/集合');
    if (codeLine.includes('(') && codeLine.includes(')')) concepts.push('函数调用');
  }
  
  return concepts;
}

/**
 * 提取关键概念
 */
function extractKeyConcepts(explanation: string): string[] {
  const conceptKeywords = [
    '变量', '函数', '参数', '返回值', '循环', '条件', '列表', '字典',
    '字符串', '整数', '浮点数', '布尔值', '类', '对象', '方法',
    '导入', '模块', '异常', '迭代', '递归'
  ];
  
  const concepts: string[] = [];
  
  for (const keyword of conceptKeywords) {
    if (explanation.includes(keyword) && !concepts.includes(keyword)) {
      concepts.push(keyword);
    }
  }
  
  return concepts.slice(0, 10);
}

/**
 * 生成常见错误
 * 注意：此功能已移至 errorPattern skill，此处返回空数组避免重复调用
 */
async function generateCommonMistakes(
  code: string,
  language: string,
  userLevel: string
): Promise<CodeExplainerOutput['commonMistakes']> {
  // 移除重复的 AI 调用，返回空数组
  // 错误模式分析已由 errorPattern skill 统一处理
  return [];
}

/**
 * 生成改进建议
 * 注意：此功能已移至 errorPattern skill，此处返回空数组避免重复调用
 */
async function generateSuggestions(
  code: string,
  language: string,
  userLevel: string,
  focusAreas: string[]
): Promise<string[]> {
  // 移除重复的 AI 调用，返回空数组
  // 改进建议已由 errorPattern skill 统一处理
  return [];
}

export default codeExplainer;
