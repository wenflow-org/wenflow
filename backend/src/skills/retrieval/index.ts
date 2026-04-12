/**
 * Retrieval Skill
 * 
 * 从教材中检索相关内容
 */

import {
  SkillDefinition,
  RetrievalInput,
  RetrievalOutput,
  SkillExecutionResult
} from '../protocol';

/**
 * 检索 Skill 定义
 */
export const retrievalDefinition: SkillDefinition = {
  name: 'retrieval',
  version: '1.0.0',
  category: 'retrieval',
  description: '从提供的资料中检索相关内容',
  
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索查询',
        required: true
      },
      sources: {
        type: 'array',
        description: '检索源'
      },
      topK: {
        type: 'number',
        description: '返回结果数量'
      },
      threshold: {
        type: 'number',
        description: '相关性阈值'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        description: '检索结果'
      },
      totalFound: {
        type: 'number',
        description: '找到的总数'
      },
      queryExpansion: {
        type: 'array',
        description: '查询扩展词'
      }
    }
  },
  
  capabilities: ['semantic-search', 'keyword-matching', 'content-retrieval'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * 检索 Skill 实现
 */
export async function retrieval(
  input: RetrievalInput
): Promise<SkillExecutionResult<RetrievalOutput>> {
  const startTime = Date.now();
  
  try {
    const {
      query,
      sources = [],
      topK = 5,
      threshold = 0.3
    } = input;
    
    // 扩展查询
    const expandedQueries = expandQuery(query);
    
    // 检索结果
    const allResults: RetrievalOutput['results'] = [];
    
    for (const source of sources) {
      const results = searchInSource(query, expandedQueries, source);
      allResults.push(...results);
    }
    
    // 按分数排序
    allResults.sort((a, b) => b.score - a.score);
    
    // 过滤低分结果
    const filteredResults = allResults.filter(r => r.score >= threshold);
    
    // 取前 topK 个
    const topResults = filteredResults.slice(0, topK);

    return {
      success: true,
      output: {
        results: topResults,
        totalFound: filteredResults.length,
        queryExpansion: expandedQueries
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'RETRIEVAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 扩展查询
 */
function expandQuery(query: string): string[] {
  const expansions: string[] = [];
  
  // 分词
  const words = query.split(/[\s,，、]+/).filter(w => w.length > 0);
  
  // 同义词扩展（简化版）
  const synonyms: Record<string, string[]> = {
    '学习': ['掌握', '理解', '学会'],
    '方法': ['方式', '途径', '技巧'],
    '问题': ['疑问', '难题', '困惑'],
    '代码': ['程序', '脚本', '实现'],
    '函数': ['方法', '功能', 'function'],
    '变量': ['参数', '数据', 'variable'],
  };
  
  for (const word of words) {
    if (synonyms[word]) {
      expansions.push(...synonyms[word]);
    }
  }
  
  // 添加原始词
  expansions.push(...words);
  
  return [...new Set(expansions)];
}

/**
 * 在源中搜索
 */
function searchInSource(
  query: string,
  expandedQueries: string[],
  source: { type: string; content: string; name?: string }
): RetrievalOutput['results'] {
  const results: RetrievalOutput['results'] = [];
  const content = source.content;
  
  // 分段处理
  const chunks = splitIntoChunks(content, 500);
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const score = calculateRelevanceScore(query, expandedQueries, chunk);
    
    if (score > 0) {
      results.push({
        content: chunk,
        score,
        source: source.name,
        metadata: {
          chunkIndex: i,
          sourceType: source.type
        }
      });
    }
  }
  
  return results;
}

/**
 * 将内容分割成块
 */
function splitIntoChunks(content: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  const paragraphs = content.split(/\n\n+/);
  
  let currentChunk = '';
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > chunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = para;
    } else {
      currentChunk += '\n\n' + para;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * 计算相关性分数
 */
function calculateRelevanceScore(
  query: string,
  expandedQueries: string[],
  content: string
): number {
  const contentLower = content.toLowerCase();
  const queryLower = query.toLowerCase();
  
  // 精确匹配得分
  let score = 0;
  
  // 原始查询精确匹配
  if (contentLower.includes(queryLower)) {
    score += 0.5;
  }
  
  // 扩展词匹配
  for (const expQuery of expandedQueries) {
    if (contentLower.includes(expQuery.toLowerCase())) {
      score += 0.1;
    }
  }
  
  // TF-IDF 简化版
  const queryTerms = queryLower.split(/\s+/);
  let matchCount = 0;
  
  for (const term of queryTerms) {
    const regex = new RegExp(term, 'gi');
    const matches = content.match(regex);
    if (matches) {
      matchCount += matches.length;
    }
  }
  
  // 归一化 TF
  const tf = matchCount / (content.split(/\s+/).length || 1);
  score += tf * 0.3;
  
  return Math.min(score, 1);
}

export default retrieval;
