/**
 * Error Pattern Skill
 * 
 * 分析和生成常见错误模式，帮助学习者避免和改正错误
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';

/**
 * Error Pattern Skill 定义
 */
export const errorPatternDefinition: SkillDefinition = {
  name: 'error-pattern',
  version: '1.0.0',
  category: 'analysis',
  description: '分析常见错误模式，提供错误诊断和改正建议',
  
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: '学习主题',
        required: true
      },
      userCode: {
        type: 'string',
        description: '用户的代码（可选，用于诊断具体错误）'
      },
      language: {
        type: 'string',
        description: '编程语言',
        default: 'python'
      },
      userLevel: {
        type: 'string',
        description: '用户水平：beginner/intermediate/advanced',
        default: 'beginner'
      },
      errorType: {
        type: 'string',
        description: '错误类型：syntax/logic/conceptual/performance',
        default: 'all'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      commonErrors: {
        type: 'string',
        description: '常见错误列表（JSON 字符串）'
      },
      diagnosis: {
        type: 'string',
        description: '对用户代码的诊断（JSON 字符串）'
      },
      debuggingSteps: {
        type: 'string',
        description: '调试步骤（JSON 数组）'
      }
    }
  },
  
  capabilities: ['error-detection', 'error-diagnosis', 'correction-guidance'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * Error Pattern 输入
 */
export interface ErrorPatternInput {
  topic: string;
  userCode?: string;
  language?: string;
  userLevel?: 'beginner' | 'intermediate' | 'advanced';
  errorType?: 'syntax' | 'logic' | 'conceptual' | 'performance' | 'all';
}

/**
 * Error Pattern 输出
 */
export interface ErrorPatternOutput {
  commonErrors: Array<{
    error: string;
    description: string;
    example: string;
    correction: string;
    prevention: string;
  }>;
  diagnosis?: {
    hasError: boolean;
    errorType?: string;
    errorMessage?: string;
    location?: string;
    suggestion?: string;
  };
  debuggingSteps: string[];
}

/**
 * Error Pattern Skill 实现
 * 优化：合并常见错误和调试步骤为一次 AI 调用
 */
export async function errorPattern(
  input: ErrorPatternInput
): Promise<SkillExecutionResult<ErrorPatternOutput>> {
  const startTime = Date.now();
  
  try {
    const {
      topic,
      userCode,
      language = 'python',
      userLevel = 'beginner',
      errorType = 'all'
    } = input;
    
    // 合并为一次调用，同时生成常见错误和调试步骤
    const combinedResult = await generateCombinedErrorContent(topic, language, userLevel, errorType);
    
    // 如果提供了用户代码，进行诊断（单独调用，因为需要处理具体代码）
    let diagnosis: ErrorPatternOutput['diagnosis'] | undefined;
    if (userCode) {
      diagnosis = await diagnoseCode(userCode, language, topic, userLevel);
    }

    return {
      success: true,
      output: {
        commonErrors: combinedResult.commonErrors,
        diagnosis,
        debuggingSteps: combinedResult.debuggingSteps
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'ERROR_PATTERN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 合并生成常见错误和调试步骤（一次 AI 调用）
 */
async function generateCombinedErrorContent(
  topic: string,
  language: string,
  userLevel: string,
  errorType: string
): Promise<{ commonErrors: ErrorPatternOutput['commonErrors']; debuggingSteps: string[] }> {
  const client = getOpenAIClient();
  
  const errorTypeInstruction = {
    syntax: '请重点讲解语法错误。',
    logic: '请重点讲解逻辑错误。',
    conceptual: '请重点讲解概念理解错误。',
    performance: '请重点讲解性能问题。',
    all: '请涵盖语法、逻辑、概念等各类错误。'
  }[errorType];

  const prompt = `请为"${topic}"生成以下内容：

## 一、常见错误（5-8个）
学习"${topic}"时，初学者在${language}编程中常犯的错误。
每个错误包含：错误名称、错误表现、错误示例、正确写法、避免方法。

## 二、调试步骤（5-7步）
${language}编程中调试代码的基本步骤，按顺序列出。

${errorTypeInstruction}

请用 Markdown 格式，清晰分隔两个部分。`;

  const messages: ChatMessage[] = [
    { role: 'system', content: '你是一位善于分析学习者错误的编程导师，能够精准定位常见错误并提供清晰的改正建议。' },
    { role: 'user', content: prompt }
  ];
  
  const response = await client.chatCompletion({ 
    messages, 
    temperature: 0.5,
    max_tokens: 4000  // 详细错误模式分析和修复建议需要更多空间
  });
  
  const content = response.choices[0]?.message.content || '';
  
  // 解析内容
  const commonErrors = parseCommonErrors(content, language);
  const debuggingSteps = parseDebuggingSteps(content);
  
  return { commonErrors, debuggingSteps };
}

/**
 * 解析常见错误
 */
function parseCommonErrors(content: string, language: string): ErrorPatternOutput['commonErrors'] {
  const errors: ErrorPatternOutput['commonErrors'] = [];
  
  // 提取常见错误部分
  const errorSection = content.split(/##?\s*(二|调试)/i)[0] || content;
  
  // 尝试按错误条目分割
  const errorPatterns = [
    /(?:错误\s*\d*|Error\s*\d*|##|###)\s*[:：]?\s*([^\n]+)\n([\s\S]*?)(?=错误\s*\d*|Error\s*\d*|##|###|$)/gi,
    /(?:•|\-|\*)\s*([^\n]+)\n([\s\S]*?)(?=•|\-|\*|$)/g
  ];
  
  let matches: RegExpExecArray | null = null;
  const pattern = errorPatterns[0];
  
  while ((matches = pattern.exec(errorSection)) !== null) {
    const errorName = matches[1].trim();
    const errorContent = matches[2].trim();
    
    // 从内容中提取各个字段
    const example = extractCodeBlock(errorContent, language) || '无示例';
    const correction = extractCorrection(errorContent, language);
    const description = extractDescription(errorContent);
    const prevention = extractPrevention(errorContent);
    
    errors.push({
      error: errorName,
      description,
      example,
      correction,
      prevention
    });
    
    if (errors.length >= 8) break;
  }
  
  // 如果没有解析出错误，返回默认错误列表
  if (errors.length === 0) {
    return getDefaultCommonErrors(language);
  }
  
  return errors;
}

/**
 * 解析调试步骤
 */
function parseDebuggingSteps(content: string): string[] {
  // 提取调试步骤部分
  const debugSection = content.split(/##?\s*(二|调试)/i)[1] || content;
  
  // 提取步骤列表
  return debugSection.split('\n')
    .filter(line => line.match(/^[\d\-\*•]/) || line.includes('步骤'))
    .map(line => line.replace(/^[\d\-\*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 7);
}

/**
 * 提取代码块
 */
function extractCodeBlock(content: string, language: string): string {
  const codeMatch = content.match(new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'i'));
  if (codeMatch) {
    return codeMatch[1].trim();
  }
  
  // 也尝试无语言标记的代码块
  const genericMatch = content.match(/```\n([\s\S]*?)```/);
  if (genericMatch) {
    return genericMatch[1].trim();
  }
  
  return '';
}

/**
 * 提取改正建议
 */
function extractCorrection(content: string, language: string): string {
  const markers = ['正确', '改正', '修正', 'Correct', 'Fixed'];
  
  for (const marker of markers) {
    const idx = content.indexOf(marker);
    if (idx > 0) {
      const codeMatch = content.substring(idx).match(/```\w*\n([\s\S]*?)```/);
      if (codeMatch) {
        return codeMatch[1].trim();
      }
    }
  }
  
  return '参考正确示例';
}

/**
 * 提取错误描述
 */
function extractDescription(content: string): string {
  const markers = ['表现', '描述', '说明', 'Description', '表现：'];
  
  for (const marker of markers) {
    const idx = content.indexOf(marker);
    if (idx > 0) {
      const nextMarker = content.indexOf('\n', idx + marker.length);
      if (nextMarker > 0) {
        return content.substring(idx + marker.length, nextMarker).trim();
      }
    }
  }
  
  // 如果没有找到标记，返回第一段
  return content.split('\n')[0]?.substring(0, 100) || '错误描述';
}

/**
 * 提取预防建议
 */
function extractPrevention(content: string): string {
  const markers = ['避免', '预防', '防止', 'Avoid', '提示', '建议'];
  
  for (const marker of markers) {
    const idx = content.indexOf(marker);
    if (idx > 0) {
      const nextMarker = content.indexOf('\n', idx + marker.length);
      if (nextMarker > 0) {
        return content.substring(idx + marker.length, nextMarker).trim();
      }
    }
  }
  
  return '仔细检查代码，遵循最佳实践';
}

/**
 * 获取默认常见错误
 */
function getDefaultCommonErrors(language: string): ErrorPatternOutput['commonErrors'] {
  return [
    {
      error: '语法错误',
      description: '代码不符合语言语法规则',
      example: language === 'python' ? 'print("Hello"' : 'console.log("Hello";',
      correction: language === 'python' ? 'print("Hello")' : 'console.log("Hello");',
      prevention: '仔细检查括号、引号是否成对出现'
    },
    {
      error: '变量未定义',
      description: '使用了未声明或未初始化的变量',
      example: 'print(x)',
      correction: 'x = 0\nprint(x)',
      prevention: '使用变量前先声明和初始化'
    },
    {
      error: '类型错误',
      description: '对不兼容的类型进行操作',
      example: '"5" + 3',
      correction: 'int("5") + 3 或 "5" + str(3)',
      prevention: '注意数据类型，必要时进行类型转换'
    }
  ];
}

/**
 * 诊断用户代码
 */
async function diagnoseCode(
  userCode: string,
  language: string,
  topic: string,
  userLevel: string
): Promise<ErrorPatternOutput['diagnosis']> {
  const client = getOpenAIClient();
  
  const prompt = `请诊断以下${language}代码中的错误：

\`\`\`${language}\n${userCode}\n\`\`\`

这个代码是关于"${topic}"的练习。

请分析：
1. 是否有错误
2. 错误类型（语法/逻辑/概念）
3. 错误信息
4. 错误位置
5. 改正建议

如果没有错误，请说明代码是正确的。`;

  const messages: ChatMessage[] = [
    { role: 'system', content: '你是一位经验丰富的代码审查专家，善于发现代码中的各种错误并提供建设性的改进建议。' },
    { role: 'user', content: prompt }
  ];
  
  const response = await client.chatCompletion({ 
    messages, 
    temperature: 0.3,
    max_tokens: 1500  // 详细代码诊断需要更多空间
  });
  
  const content = response.choices[0]?.message.content || '';
  
  // 解析诊断结果
  return parseDiagnosis(content, userCode);
}

/**
 * 解析诊断结果
 */
function parseDiagnosis(content: string, userCode: string): ErrorPatternOutput['diagnosis'] {
  // 检查是否有错误
  const noErrorMarkers = ['没有错误', '正确', '没问题', 'No error', 'Correct'];
  const hasError = !noErrorMarkers.some(marker => content.includes(marker));
  
  // 提取错误类型
  const errorTypeMatch = content.match(/错误类型 [:：]?\s*(\w+)/i);
  const errorType = errorTypeMatch?.[1] || 'unknown';
  
  // 提取错误信息
  const errorMessageMatch = content.match(/错误信息 [:：]?\s*([^\n]+)/i);
  const errorMessage = errorMessageMatch?.[1] || '';
  
  // 提取错误位置
  const locationMatch = content.match(/(?:位置 | 行 |Line)\s*[:：]?\s*(\d+)/i);
  const location = locationMatch ? `第${locationMatch[1]}行` : '未知位置';
  
  // 提取改正建议
  const suggestionMatch = content.match(/(?:建议 | 改正|Suggestion)[:：]?\s*([^\n]+)/i);
  const suggestion = suggestionMatch?.[1] || '请参考详细解析';
  
  return {
    hasError,
    errorType: hasError ? errorType : undefined,
    errorMessage: hasError ? errorMessage : undefined,
    location: hasError ? location : undefined,
    suggestion
  };
}

export default errorPattern;
