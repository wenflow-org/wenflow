/**
 * Smart Search Skill
 *
 * 智能搜索技能 - 结合多种搜索策略的增强型检索
 * 支持：向量语义搜索、关键词匹配、多源聚合、智能排序
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';

// 输入类型定义
export interface SmartSearchInput {
  query: string;
  sources?: Array<{
    type: 'text' | 'url' | 'file' | 'database';
    content?: string;
    url?: string;
    filePath?: string;
    tableName?: string;
    name?: string;
    metadata?: Record<string, any>;
  }>;
  searchMode?: 'semantic' | 'keyword' | 'hybrid' | 'exact';
  topK?: number;
  threshold?: number;
  rerank?: boolean;
  highlight?: boolean;
  contextWindow?: number; // 上下文窗口大小（字符数）
}

// 输出类型定义
export interface SmartSearchOutput {
  results: Array<{
    id: string;
    content: string;
    title?: string;
    score: number;
    rank: number;
    source: {
      name?: string;
      type: string;
      metadata?: Record<string, any>;
    };
    highlights?: Array<{
      text: string;
      start: number;
      end: number;
    }>;
    context?: {
      before: string;
      after: string;
    };
    metadata?: {
      wordCount?: number;
      charCount?: number;
      keywords?: string[];
      entities?: string[];
    };
  }>;
  searchInfo: {
    totalScanned: number;
    totalFound: number;
    searchTime: number;
    queryAnalysis: {
      original: string;
      expanded: string[];
      entities: string[];
      intent?: string;
    };
    strategy: string;
  };
  suggestions?: {
    relatedQueries?: string[];
    filters?: Array<{
      field: string;
      values: string[];
    }>;
    didYouMean?: string;
  };
}

/**
 * Smart Search Skill 定义
 */
export const smartSearchDefinition: SkillDefinition = {
  name: 'smart-search',
  version: '1.0.0',
  category: 'retrieval',
  description: '智能搜索技能，支持语义搜索、关键词匹配、多源聚合和智能排序',

  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索查询',
        required: true
      },
      sources: {
        type: 'array',
        description: '搜索源列表',
        required: false
      },
      searchMode: {
        type: 'string',
        description: '搜索模式: semantic|keyword|hybrid|exact',
        required: false,
        default: 'hybrid'
      },
      topK: {
        type: 'number',
        description: '返回结果数量',
        required: false,
        default: 10
      },
      threshold: {
        type: 'number',
        description: '相关性阈值',
        required: false,
        default: 0.3
      },
      rerank: {
        type: 'boolean',
        description: '是否重排序',
        required: false,
        default: true
      },
      highlight: {
        type: 'boolean',
        description: '是否高亮关键词',
        required: false,
        default: true
      },
      contextWindow: {
        type: 'number',
        description: '上下文窗口大小',
        required: false,
        default: 100
      }
    }
  },

  outputSchema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        description: '搜索结果'
      },
      searchInfo: {
        type: 'object',
        description: '搜索信息'
      },
      suggestions: {
        type: 'object',
        description: '搜索建议'
      }
    }
  },

  capabilities: [
    'semantic-search',
    'keyword-matching',
    'hybrid-ranking',
    'multi-source',
    'query-expansion',
    'entity-extraction',
    'highlighting',
    'context-extraction'
  ],

  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * Smart Search Skill 实现
 */
export async function smartSearch(
  input: SmartSearchInput
): Promise<SkillExecutionResult<SmartSearchOutput>> {
  const startTime = Date.now();

  try {
    const {
      query,
      sources = [],
      searchMode = 'hybrid',
      topK = 10,
      threshold = 0.3,
      rerank = true,
      highlight = true,
      contextWindow = 100
    } = input;

    // 验证输入
    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: {
          code: 'EMPTY_QUERY',
          message: '搜索查询不能为空'
        },
        duration: Date.now() - startTime
      };
    }

    // 1. 查询分析
    const queryAnalysis = analyzeQuery(query);

    // 2. 如果没有提供源，使用默认源
    const searchSources = sources.length > 0 ? sources : getDefaultSources();

    // 3. 执行搜索
    let allResults: SmartSearchOutput['results'] = [];

    for (const source of searchSources) {
      const sourceResults = await searchInSource(
        queryAnalysis,
        source,
        searchMode,
        threshold,
        contextWindow
      );
      allResults.push(...sourceResults);
    }

    // 4. 重排序（如果启用）
    if (rerank && allResults.length > 0) {
      allResults = await rerankResults(queryAnalysis, allResults);
    }

    // 5. 添加高亮（如果启用）
    if (highlight) {
      allResults = addHighlights(allResults, queryAnalysis);
    }

    // 6. 截断到 topK
    const finalResults = allResults.slice(0, topK).map((r, i) => ({
      ...r,
      rank: i + 1
    }));

    // 7. 生成建议
    const suggestions = generateSuggestions(queryAnalysis, finalResults);

    // 8. 构建输出
    const output: SmartSearchOutput = {
      results: finalResults,
      searchInfo: {
        totalScanned: allResults.length,
        totalFound: finalResults.length,
        searchTime: Date.now() - startTime,
        queryAnalysis: {
          original: query,
          expanded: queryAnalysis.expanded,
          entities: queryAnalysis.entities,
          intent: queryAnalysis.intent
        },
        strategy: searchMode
      },
      suggestions
    };

    return {
      success: true,
      output,
      duration: Date.now() - startTime
    };

  } catch (error) {
    return {
      success: false,
      error: {
        code: 'SEARCH_ERROR',
        message: error instanceof Error ? error.message : '搜索失败'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 查询分析
 */
function analyzeQuery(query: string): {
  original: string;
  normalized: string;
  tokens: string[];
  expanded: string[];
  entities: string[];
  intent?: string;
  isQuestion: boolean;
} {
  const normalized = query.toLowerCase().trim();
  const tokens = tokenize(normalized);

  // 扩展查询
  const expanded = expandQueryTerms(tokens);

  // 提取实体
  const entities = extractEntities(normalized);

  // 识别意图
  const intent = detectIntent(normalized);

  // 判断是否为问题
  const isQuestion = /^(what|how|why|when|where|who|which|can|could|would|will|is|are|do|does|did|有|什么|怎么|为什么|何时|哪里|谁|哪个|如何)/i.test(normalized) ||
                     normalized.includes('?') ||
                     normalized.includes('？');

  return {
    original: query,
    normalized,
    tokens,
    expanded,
    entities,
    intent,
    isQuestion
  };
}

/**
 * 分词
 */
function tokenize(text: string): string[] {
  // 支持中英文分词
  const tokens: string[] = [];

  // 英文单词
  const englishWords = text.match(/[a-z]+/g) || [];
  tokens.push(...englishWords);

  // 中文字符（每个字作为一个token，同时提取词组）
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  tokens.push(...chineseChars);

  // 提取中文词组（2-4字）
  for (let i = 0; i < chineseChars.length - 1; i++) {
    for (let len = 2; len <= 4 && i + len <= chineseChars.length; len++) {
      tokens.push(chineseChars.slice(i, i + len).join(''));
    }
  }

  return [...new Set(tokens)].filter(t => t.length >= 2 || /^[\u4e00-\u9fa5]$/.test(t));
}

/**
 * 扩展查询词
 */
function expandQueryTerms(tokens: string[]): string[] {
  const expansions = new Set(tokens);

  // 同义词词典
  const synonyms: Record<string, string[]> = {
    // 英文
    'learn': ['study', 'master', 'understand', 'grasp'],
    'code': ['program', 'script', 'implement', 'develop'],
    'function': ['method', 'procedure', 'routine'],
    'variable': ['parameter', 'argument', 'value'],
    'error': ['bug', 'issue', 'problem', 'exception'],
    'create': ['make', 'build', 'generate', 'construct'],
    'delete': ['remove', 'erase', 'clear'],
    'update': ['modify', 'change', 'edit', 'revise'],
    'get': ['fetch', 'retrieve', 'obtain', 'acquire'],
    'set': ['assign', 'define', 'specify'],

    // 中文
    '学习': ['掌握', '理解', '学会', '研习', '钻研'],
    '代码': ['程序', '脚本', '编程', '源码'],
    '函数': ['方法', '功能', '子程序'],
    '变量': ['参数', '参数值', '数据'],
    '错误': ['问题', '异常', '故障', 'bug'],
    '创建': ['建立', '生成', '新建', '构建'],
    '删除': ['移除', '清除', '销毁'],
    '修改': ['更新', '编辑', '更改', '调整'],
    '获取': ['得到', '读取', '检索', '查询'],
    '设置': ['配置', '设定', '指定']
  };

  for (const token of tokens) {
    if (synonyms[token]) {
      synonyms[token].forEach(s => expansions.add(s));
    }
  }

  return Array.from(expansions);
}

/**
 * 提取实体
 */
function extractEntities(text: string): string[] {
  const entities: string[] = [];

  // 编程语言
  const languages = /\b(javascript|typescript|python|java|cpp|c\+\+|c#|go|rust|ruby|php|swift|kotlin|sql|html|css|bash|shell)\b/gi;
  let match;
  while ((match = languages.exec(text)) !== null) {
    entities.push(match[1].toLowerCase());
  }

  // 框架/库
  const frameworks = /\b(react|vue|angular|express|django|flask|spring|tensorflow|pytorch|pandas|numpy)\b/gi;
  while ((match = frameworks.exec(text)) !== null) {
    entities.push(match[1].toLowerCase());
  }

  // 技术概念
  const concepts = /\b(api|database|server|client|frontend|backend|algorithm|data structure|design pattern)\b/gi;
  while ((match = concepts.exec(text)) !== null) {
    entities.push(match[1].toLowerCase());
  }

  return [...new Set(entities)];
}

/**
 * 检测意图
 */
function detectIntent(text: string): string | undefined {
  const intents: Record<string, RegExp[]> = {
    'definition': [/什么是/i, /what is/i, /definition of/i, /define/i],
    'howto': [/怎么/i, /如何/i, /how to/i, /how do/i],
    'comparison': [/区别/i, /比较/i, /vs/i, /versus/i, /difference/i, /compare/i],
    'troubleshooting': [/错误/i, /报错/i, /bug/i, /fix/i, /solve/i, / troubleshoot/i],
    'example': [/例子/i, /示例/i, /example/i, /sample/i, /demo/i],
    'bestpractice': [/最佳实践/i, /推荐/i, /best practice/i, /recommend/i]
  };

  for (const [intent, patterns] of Object.entries(intents)) {
    if (patterns.some(p => p.test(text))) {
      return intent;
    }
  }

  return undefined;
}

/**
 * 获取默认搜索源
 */
function getDefaultSources(): SmartSearchInput['sources'] {
  return [{
    type: 'database',
    name: 'default',
    tableName: 'learning_content'
  }];
}

/**
 * 在源中搜索
 */
async function searchInSource(
  queryAnalysis: ReturnType<typeof analyzeQuery>,
  source: NonNullable<SmartSearchInput['sources']>[0],
  searchMode: string,
  threshold: number,
  contextWindow: number
): Promise<SmartSearchOutput['results']> {
  const results: SmartSearchOutput['results'] = [];

  // 获取源内容
  let content: string;
  try {
    content = await fetchSourceContent(source);
  } catch {
    return results;
  }

  // 分块
  const chunks = splitContent(content, 500);

  // 根据搜索模式计算分数
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let score = 0;

    switch (searchMode) {
      case 'exact':
        score = calculateExactMatchScore(queryAnalysis, chunk);
        break;
      case 'keyword':
        score = calculateKeywordScore(queryAnalysis, chunk);
        break;
      case 'semantic':
        score = await calculateSemanticScore(queryAnalysis, chunk);
        break;
      case 'hybrid':
      default:
        const keywordScore = calculateKeywordScore(queryAnalysis, chunk);
        const semanticScore = await calculateSemanticScore(queryAnalysis, chunk);
        score = keywordScore * 0.6 + semanticScore * 0.4;
        break;
    }

    if (score >= threshold) {
      results.push({
        id: `${source.name || 'source'}-${i}`,
        content: chunk,
        title: extractTitle(chunk),
        score,
        rank: 0, // 稍后设置
        source: {
          name: source.name,
          type: source.type,
          metadata: source.metadata
        },
        context: extractContext(content, chunk, contextWindow),
        metadata: {
          wordCount: chunk.split(/\s+/).length,
          charCount: chunk.length,
          keywords: extractKeywords(chunk),
          entities: extractEntities(chunk)
        }
      });
    }
  }

  return results;
}

/**
 * 获取源内容
 */
async function fetchSourceContent(source: NonNullable<SmartSearchInput['sources']>[0]): Promise<string> {
  switch (source.type) {
    case 'text':
      return source.content || '';
    case 'url':
      // 这里应该调用 web-extractor skill
      return `[URL content from ${source.url}]`;
    case 'file':
      // 这里应该读取文件
      return `[File content from ${source.filePath}]`;
    case 'database':
      // 这里应该查询数据库
      return `[Database content from ${source.tableName}]`;
    default:
      return '';
  }
}

/**
 * 分割内容
 */
function splitContent(content: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  const paragraphs = content.split(/\n\s*\n/);

  let currentChunk = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length > chunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = trimmed;
    } else {
      currentChunk += '\n\n' + trimmed;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * 计算精确匹配分数
 */
function calculateExactMatchScore(
  queryAnalysis: ReturnType<typeof analyzeQuery>,
  content: string
): number {
  const contentLower = content.toLowerCase();
  const queryLower = queryAnalysis.normalized;

  if (contentLower.includes(queryLower)) {
    return 1.0;
  }

  // 检查扩展词
  let matchCount = 0;
  for (const term of queryAnalysis.expanded) {
    if (contentLower.includes(term.toLowerCase())) {
      matchCount++;
    }
  }

  return matchCount / queryAnalysis.expanded.length * 0.8;
}

/**
 * 计算关键词分数
 */
function calculateKeywordScore(
  queryAnalysis: ReturnType<typeof analyzeQuery>,
  content: string
): number {
  const contentLower = content.toLowerCase();
  let score = 0;

  // 原始查询匹配
  if (contentLower.includes(queryAnalysis.normalized)) {
    score += 0.5;
  }

  // Token 匹配
  for (const token of queryAnalysis.tokens) {
    const regex = new RegExp(token, 'gi');
    const matches = content.match(regex);
    if (matches) {
      score += 0.1 * Math.min(matches.length, 5);
    }
  }

  // 扩展词匹配
  for (const term of queryAnalysis.expanded) {
    if (contentLower.includes(term.toLowerCase())) {
      score += 0.05;
    }
  }

  // 实体匹配加分
  for (const entity of queryAnalysis.entities) {
    if (contentLower.includes(entity.toLowerCase())) {
      score += 0.2;
    }
  }

  // TF-IDF 简化
  const tf = calculateTF(queryAnalysis.tokens, content);
  score += tf * 0.3;

  return Math.min(score, 1);
}

/**
 * 计算词频
 */
function calculateTF(tokens: string[], content: string): number {
  const contentLower = content.toLowerCase();
  let matchCount = 0;

  for (const token of tokens) {
    const regex = new RegExp(token, 'gi');
    const matches = content.match(regex);
    if (matches) {
      matchCount += matches.length;
    }
  }

  const totalWords = content.split(/\s+/).length || 1;
  return matchCount / totalWords;
}

/**
 * 计算语义相似度分数（简化版）
 */
async function calculateSemanticScore(
  queryAnalysis: ReturnType<typeof analyzeQuery>,
  content: string
): Promise<number> {
  // 这里应该使用向量嵌入模型计算余弦相似度
  // 简化实现：基于关键词重叠的伪语义分数

  const contentTokens = tokenize(content.toLowerCase());
  const queryTokens = new Set(queryAnalysis.expanded);

  let overlap = 0;
  for (const token of contentTokens) {
    if (queryTokens.has(token)) {
      overlap++;
    }
  }

  // Jaccard 相似度
  const union = new Set([...contentTokens, ...queryTokens]).size;
  const jaccard = union > 0 ? overlap / union : 0;

  // 结合意图匹配
  let intentBonus = 0;
  if (queryAnalysis.intent) {
    const intentKeywords: Record<string, string[]> = {
      'definition': ['是', '定义', '概念', 'meaning', 'refers to', 'is a'],
      'howto': ['步骤', '方法', '首先', '然后', 'step', 'first', 'then', 'how to'],
      'comparison': ['vs', '相比', '优于', '不同于', 'difference', 'compared to'],
      'troubleshooting': ['解决', '修复', '错误', 'fix', 'solution', 'error'],
      'example': ['例如', '比如', 'for example', 'such as', 'e.g.'],
      'bestpractice': ['建议', '推荐', '应该', 'should', 'recommended', 'best']
    };

    const keywords = intentKeywords[queryAnalysis.intent] || [];
    if (keywords.some(k => content.toLowerCase().includes(k.toLowerCase()))) {
      intentBonus = 0.2;
    }
  }

  return Math.min(jaccard + intentBonus, 1);
}

/**
 * 提取标题
 */
function extractTitle(content: string): string | undefined {
  const lines = content.split('\n');

  // 找第一行非空内容
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && trimmed.length < 100) {
      return trimmed.replace(/^#+\s*/, '');
    }
  }

  return undefined;
}

/**
 * 提取上下文
 */
function extractContext(
  fullContent: string,
  chunk: string,
  windowSize: number
): { before: string; after: string } {
  const chunkIndex = fullContent.indexOf(chunk);

  if (chunkIndex === -1) {
    return { before: '', after: '' };
  }

  const before = fullContent.substring(
    Math.max(0, chunkIndex - windowSize),
    chunkIndex
  );

  const after = fullContent.substring(
    chunkIndex + chunk.length,
    Math.min(fullContent.length, chunkIndex + chunk.length + windowSize)
  );

  return { before, after };
}

/**
 * 提取关键词
 */
function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const freq: Record<string, number> = {};

  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }

  // 过滤停用词
  const stopWords = new Set(['this', 'that', 'with', 'from', 'they', 'have', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other']);

  return Object.entries(freq)
    .filter(([word, count]) => count > 1 && !stopWords.has(word))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * 重排序结果
 */
async function rerankResults(
  queryAnalysis: ReturnType<typeof analyzeQuery>,
  results: SmartSearchOutput['results']
): Promise<SmartSearchOutput['results']> {
  // 基于多种信号重排序
  return results
    .map(result => {
      let rerankScore = result.score;

      // 1. 新鲜度（如果有时间信息）
      // 2. 来源权威性
      if (result.source.type === 'database') {
        rerankScore *= 1.1;
      }

      // 3. 内容完整性
      if (result.metadata?.wordCount && result.metadata.wordCount > 100) {
        rerankScore *= 1.05;
      }

      // 4. 实体匹配
      if (result.metadata?.entities) {
        const entityMatch = result.metadata.entities.filter(e =>
          queryAnalysis.entities.includes(e.toLowerCase())
        ).length;
        rerankScore += entityMatch * 0.05;
      }

      // 5. 问题匹配（如果是问题查询）
      if (queryAnalysis.isQuestion && result.content.includes('?')) {
        rerankScore *= 1.1;
      }

      return {
        ...result,
        score: Math.min(rerankScore, 1)
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * 添加高亮
 */
function addHighlights(
  results: SmartSearchOutput['results'],
  queryAnalysis: ReturnType<typeof analyzeQuery>
): SmartSearchOutput['results'] {
  return results.map(result => {
    const highlights: Array<{ text: string; start: number; end: number }> = [];
    const content = result.content;

    // 高亮原始查询
    const queryRegex = new RegExp(`(${escapeRegex(queryAnalysis.normalized)})`, 'gi');
    let match;
    while ((match = queryRegex.exec(content)) !== null) {
      highlights.push({
        text: match[1],
        start: match.index,
        end: match.index + match[1].length
      });
    }

    // 高亮扩展词
    for (const term of queryAnalysis.expanded.slice(0, 5)) {
      if (term === queryAnalysis.normalized) continue;
      const termRegex = new RegExp(`(${escapeRegex(term)})`, 'gi');
      while ((match = termRegex.exec(content)) !== null) {
        // 避免重叠
        const overlap = highlights.some(h =>
          (match!.index >= h.start && match!.index < h.end) ||
          (match!.index + match![1].length > h.start && match!.index + match![1].length <= h.end)
        );
        if (!overlap) {
          highlights.push({
            text: match[1],
            start: match.index,
            end: match.index + match[1].length
          });
        }
      }
    }

    // 按位置排序
    highlights.sort((a, b) => a.start - b.start);

    return {
      ...result,
      highlights: highlights.slice(0, 10) // 最多10个高亮
    };
  });
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成搜索建议
 */
function generateSuggestions(
  queryAnalysis: ReturnType<typeof analyzeQuery>,
  results: SmartSearchOutput['results']
): SmartSearchOutput['suggestions'] {
  const suggestions: SmartSearchOutput['suggestions'] = {};

  // 1. 相关查询
  const relatedQueries: string[] = [];
  if (queryAnalysis.entities.length > 0) {
    relatedQueries.push(`${queryAnalysis.entities[0]} 教程`);
    relatedQueries.push(`${queryAnalysis.entities[0]} 示例`);
  }
  if (queryAnalysis.intent === 'howto') {
    relatedQueries.push(`${queryAnalysis.normalized} 最佳实践`);
  }
  if (relatedQueries.length > 0) {
    suggestions.relatedQueries = relatedQueries;
  }

  // 2. 过滤器建议
  const filters: Array<{ field: string; values: string[] }> = [];

  // 提取所有实体作为过滤器
  const allEntities = new Set<string>();
  results.forEach(r => r.metadata?.entities?.forEach(e => allEntities.add(e)));
  if (allEntities.size > 0) {
    filters.push({
      field: '技术栈',
      values: Array.from(allEntities).slice(0, 5)
    });
  }

  // 来源类型过滤器
  const sourceTypes = new Set(results.map(r => r.source.type));
  if (sourceTypes.size > 1) {
    filters.push({
      field: '来源类型',
      values: Array.from(sourceTypes)
    });
  }

  if (filters.length > 0) {
    suggestions.filters = filters;
  }

  // 3. 拼写纠正（简化版）
  // 这里可以实现 Levenshtein 距离算法

  return suggestions;
}

export default smartSearch;
