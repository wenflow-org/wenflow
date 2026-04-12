/**
 * Text Structure Analyzer Skill
 * 
 * 解析文本大纲/课程表
 */

import {
  SkillDefinition,
  TextStructureAnalyzerInput,
  TextStructureAnalyzerOutput,
  SkillExecutionResult
} from '../protocol';

/**
 * 文本结构分析 Skill 定义
 */
export const textStructureAnalyzerDefinition: SkillDefinition = {
  name: 'text-structure-analyzer',
  version: '1.0.0',
  category: 'analysis',
  description: '分析文本结构，提取大纲、章节、关键词等',
  
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '待分析的文本内容',
        required: true
      },
      detectOutline: {
        type: 'boolean',
        description: '是否检测大纲结构'
      },
      detectChapters: {
        type: 'boolean',
        description: '是否检测章节'
      },
      extractKeywords: {
        type: 'boolean',
        description: '是否提取关键词'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      outline: {
        type: 'array',
        description: '大纲结构'
      },
      chapters: {
        type: 'array',
        description: '章节列表'
      },
      keywords: {
        type: 'array',
        description: '关键词列表'
      },
      summary: {
        type: 'string',
        description: '文本摘要'
      },
      estimatedReadTime: {
        type: 'number',
        description: '预估阅读时间（分钟）'
      }
    }
  },
  
  capabilities: ['outline-detection', 'chapter-extraction', 'keyword-extraction', 'summary-generation'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * 文本结构分析 Skill 实现
 */
export async function textStructureAnalyzer(
  input: TextStructureAnalyzerInput
): Promise<SkillExecutionResult<TextStructureAnalyzerOutput>> {
  const startTime = Date.now();
  
  try {
    const { text, detectOutline = true, detectChapters = true, extractKeywords = true } = input;
    
    const output: TextStructureAnalyzerOutput = {};
    
    // 检测大纲
    if (detectOutline) {
      output.outline = detectOutlineStructure(text);
    }
    
    // 检测章节
    if (detectChapters) {
      output.chapters = detectChapterStructure(text);
    }
    
    // 提取关键词
    if (extractKeywords) {
      output.keywords = extractKeywordsFromText(text);
    }
    
    // 生成摘要（简化版：取前200字）
    output.summary = generateSummary(text);
    
    // 预估阅读时间（假设每分钟阅读300字）
    const charCount = text.replace(/\s/g, '').length;
    output.estimatedReadTime = Math.ceil(charCount / 300);

    return {
      success: true,
      output,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'TEXT_ANALYSIS_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 检测大纲结构
 */
function detectOutlineStructure(text: string): TextStructureAnalyzerOutput['outline'] {
  const outline: TextStructureAnalyzerOutput['outline'] = [];
  const lines = text.split('\n');
  
  let currentIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 检测 Markdown 标题
    const mdMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (mdMatch) {
      outline.push({
        level: mdMatch[1].length,
        title: mdMatch[2],
        startIndex: currentIndex,
        endIndex: currentIndex + line.length
      });
      currentIndex += line.length + 1;
      continue;
    }
    
    // 检测数字编号标题
    const numMatch = line.match(/^(\d+(?:\.\d+)*)[\s.、．]\s*(.+)$/);
    if (numMatch) {
      const level = numMatch[1].split('.').length;
      outline.push({
        level,
        title: numMatch[2],
        startIndex: currentIndex,
        endIndex: currentIndex + line.length
      });
      currentIndex += line.length + 1;
      continue;
    }
    
    // 检测中文编号
    const cnMatch = line.match(/^([一二三四五六七八九十]+)[、.．]\s*(.+)$/);
    if (cnMatch) {
      outline.push({
        level: 1,
        title: cnMatch[2],
        startIndex: currentIndex,
        endIndex: currentIndex + line.length
      });
      currentIndex += line.length + 1;
      continue;
    }
    
    currentIndex += line.length + 1;
  }
  
  return outline;
}

/**
 * 检测章节结构
 */
function detectChapterStructure(text: string): TextStructureAnalyzerOutput['chapters'] {
  const chapters: TextStructureAnalyzerOutput['chapters'] = [];
  const lines = text.split('\n');
  
  let currentChapter: { title: string; content: string } | null = null;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 检测章节标题
    const chapterMatch = trimmedLine.match(/^(第[一二三四五六七八九十\d]+[章节章回]|Chapter\s*\d+)[：:\s]*(.*)$/i);
    
    if (chapterMatch) {
      // 保存之前的章节
      if (currentChapter) {
        chapters.push(currentChapter);
      }
      
      currentChapter = {
        title: chapterMatch[0],
        content: ''
      };
    } else if (currentChapter) {
      currentChapter.content += line + '\n';
    }
  }
  
  // 保存最后一个章节
  if (currentChapter) {
    chapters.push(currentChapter);
  }
  
  return chapters;
}

/**
 * 提取关键词
 */
function extractKeywordsFromText(text: string): string[] {
  // 简化的关键词提取（实际项目中可以使用 TF-IDF 或 NLP 库）
  const keywords: Set<string> = new Set();
  
  // 移除标点符号
  const cleanText = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ');
  
  // 分词（简化版：按空格和常见词分割）
  const words = cleanText.split(/\s+/);
  
  // 停用词列表
  const stopWords = new Set([
    '的', '是', '在', '了', '和', '与', '或', '这', '那', '有', '为',
    '以', '及', '等', '中', '上', '下', '不', '也', '就', '都', '要',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through'
  ]);
  
  // 词频统计
  const wordFreq: Map<string, number> = new Map();
  
  for (const word of words) {
    // 过滤短词和停用词
    if (word.length < 2 || stopWords.has(word.toLowerCase())) {
      continue;
    }
    
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }
  
  // 按频率排序，取前20个
  const sortedWords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
  
  return sortedWords;
}

/**
 * 生成摘要
 */
function generateSummary(text: string): string {
  // 简化版：取前200字作为摘要
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  if (cleanText.length <= 200) {
    return cleanText;
  }
  
  // 尝试在句号处截断
  const truncated = cleanText.substring(0, 220);
  const lastPeriod = Math.max(
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('！'),
    truncated.lastIndexOf('？')
  );
  
  if (lastPeriod > 100) {
    return truncated.substring(0, lastPeriod + 1);
  }
  
  return cleanText.substring(0, 200) + '...';
}

export default textStructureAnalyzer;
